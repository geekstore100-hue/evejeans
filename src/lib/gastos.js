import {
  doc,
  collection,
  setDoc,
  updateDoc,
  writeBatch,
  increment,
  getDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';
import { guardarSinBloquear } from './offlineWrite';

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
    await guardarSinBloquear(setDoc(gastoRef, { ...base, consecutivoPago: null }), {
      contexto: 'gasto',
    });
    return { id: gastoRef.id, consecutivoPago: null, fecha, hora };
  }

  // Sin runTransaction, igual que en ventas.js: así funciona sin internet. El
  // consecutivo real se lleva con increment(), el número que se muestra en el
  // comprobante se calcula con el último dato que tiene el computador.
  const contadorRef = doc(db, 'contadores', 'pagos');
  const snap = await getDoc(contadorRef);
  const ultimo = snap.exists() ? snap.data().ultimo || 0 : 0;
  const num = ultimo + 1;

  const batch = writeBatch(db);
  if (snap.exists()) batch.update(contadorRef, { ultimo: increment(1) });
  else batch.set(contadorRef, { ultimo: num });
  batch.set(gastoRef, { ...base, consecutivoPago: num });
  await guardarSinBloquear(batch.commit(), { contexto: `pago #${num}` });

  return { id: gastoRef.id, consecutivoPago: num, fecha, hora, ...base };
}

export async function anularGasto(id, motivo, usuario) {
  await updateDoc(doc(db, 'gastos', id), {
    anulado: true,
    motivoAnulacion: motivo,
    anuladoPor: usuario.nombreDefault,
  });
}

export async function comisionDeHoy(config, fecha) {
  fecha = fecha || hoyStr();
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

// Para la bitácora: todos los gastos (incluidos los anulados), no solo los de hoy.
export async function gastosRecientes(limite = 30) {
  const snap = await getDocs(collection(db, 'gastos'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
    .slice(0, limite);
}
