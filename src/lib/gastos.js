import {
  doc,
  collection,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export function esNomina(categoria) {
  return categoria === 'Sueldo' || categoria === 'Comisión';
}

export async function registrarGasto({ usuario, categoria, quien, periodo, monto, desc, origen }) {
  const nomina = esNomina(categoria);
  const fecha = hoyStr();
  const hora = ahoraStr();
  const gastoRef = doc(collection(db, 'gastos'));

  const base = {
    fecha,
    hora,
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    categoria,
    quien: nomina ? quien : null,
    periodo: nomina ? periodo : null,
    monto,
    desc: desc || null,
    origen,
    anulado: false,
    creadoEn: serverTimestamp(),
  };

  if (!nomina) {
    await setDoc(gastoRef, { ...base, consecutivoPago: null });
    return { id: gastoRef.id, consecutivoPago: null, fecha, hora };
  }

  const contadorRef = doc(db, 'contadores', 'pagos');
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(contadorRef);
    const ultimo = snap.exists() ? snap.data().ultimo || 0 : 0;
    const num = ultimo + 1;
    if (snap.exists()) tx.update(contadorRef, { ultimo: num });
    else tx.set(contadorRef, { ultimo: num });
    tx.set(gastoRef, { ...base, consecutivoPago: num });
    return { id: gastoRef.id, consecutivoPago: num, fecha, hora, ...base };
  });
}

export async function anularGasto(id, motivo, usuario) {
  await updateDoc(doc(db, 'gastos', id), {
    anulado: true,
    motivoAnulacion: motivo,
    anuladoPor: usuario.nombreDefault,
  });
}

export async function comisionDeHoy(config) {
  const fecha = hoyStr();
  const q = query(
    collection(db, 'ventas'),
    where('fecha', '==', fecha),
    where('tipo', '==', 'venta'),
    where('anulada', '==', false)
  );
  const snap = await getDocs(q);
  let prendas = 0;
  let total = 0;
  snap.docs.forEach((d) => {
    const v = d.data();
    (v.items || []).forEach((i) => {
      prendas += i.qty;
      const valorRef =
        config.comisionPorRef && config.comisionPorRef[i.id] !== undefined
          ? config.comisionPorRef[i.id]
          : config.comisionValor;
      total += valorRef * i.qty;
    });
  });
  const aplica = prendas >= config.comisionMinimo;
  return { prendas, aplica, total: aplica ? total : 0 };
}

export async function gastosDeHoy() {
  const fecha = hoyStr();
  const q = query(collection(db, 'gastos'), where('fecha', '==', fecha));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
