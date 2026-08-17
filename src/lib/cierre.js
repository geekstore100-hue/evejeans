import {
  collection,
  doc,
  setDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { comisionDeHoy } from './gastos';

const MEDIOS = ['Efectivo', 'Datáfono', 'Nequi', 'Addi', 'PTM', 'Sistecrédito'];

const ORIGEN_A_MEDIO = {
  'Efectivo de la caja': 'Efectivo',
  'Nequi del local': 'Nequi',
  'Datáfono del local': 'Datáfono',
};

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export async function resumenDia(fecha, config) {
  const qVentas = query(collection(db, 'ventas'), where('fecha', '==', fecha), where('anulada', '==', false));
  const snapVentas = await getDocs(qVentas);

  const porPago = {};
  MEDIOS.forEach((m) => (porPago[m] = 0));
  let nVentas = 0;
  let nCambios = 0;
  let unidades = 0;
  let descuentos = 0;

  snapVentas.docs.forEach((d) => {
    const v = d.data();
    if (v.tipo === 'venta') {
      nVentas++;
      unidades += (v.items || []).reduce((s, i) => s + i.qty, 0);
      descuentos += v.descuento || 0;
      Object.entries(v.pagos || {}).forEach(([m, monto]) => {
        porPago[m] = (porPago[m] || 0) + monto;
      });
    } else if (v.tipo === 'cambio') {
      nCambios++;
      if (v.diferencia > 0 && v.pago) {
        porPago[v.pago] = (porPago[v.pago] || 0) + v.diferencia;
      }
    }
  });

  const qGastos = query(collection(db, 'gastos'), where('fecha', '==', fecha), where('anulado', '==', false));
  const snapGastos = await getDocs(qGastos);
  const gastosMedio = {};
  let gastosTot = 0;
  snapGastos.docs.forEach((d) => {
    const g = d.data();
    gastosTot += g.monto;
    const medio = ORIGEN_A_MEDIO[g.origen];
    if (medio) gastosMedio[medio] = (gastosMedio[medio] || 0) + g.monto;
  });

  const netoPorMedio = {};
  MEDIOS.forEach((m) => {
    netoPorMedio[m] = (porPago[m] || 0) - (gastosMedio[m] || 0);
  });

  const comision = config ? await comisionDeHoy(config) : null;

  const totalGeneral = Object.values(netoPorMedio).reduce((a, b) => a + b, 0);

  return { porPago, gastosMedio, netoPorMedio, nVentas, nCambios, unidades, descuentos, gastosTot, comision, totalGeneral };
}

export async function yaCerrado(fecha) {
  const q = query(collection(db, 'cierres'), where('fecha', '==', fecha));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function registrarCierre({ usuario, esperado, contado, obs, resumen }) {
  const fecha = hoyStr();
  const cierreRef = doc(collection(db, 'cierres'));
  const diferencia = contado - esperado;
  await setDoc(cierreRef, {
    fecha,
    hora: ahoraStr(),
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    esperado,
    contado,
    diferencia,
    obs: obs || null,
    resumen,
    entregado: false,
    creadoEn: serverTimestamp(),
  });
  return { fecha, diferencia };
}

export { hoyStr, ahoraStr, MEDIOS };
