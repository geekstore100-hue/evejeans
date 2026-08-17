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
  let descuentos = 0;
  const prendasPorNombre = {}; // {nombre: cantidad neta}
  const cambiosLista = [];

  snapVentas.docs.forEach((d) => {
    const v = d.data();
    if (v.tipo === 'venta') {
      descuentos += v.descuento || 0;
      (v.items || []).forEach((i) => {
        prendasPorNombre[i.name] = (prendasPorNombre[i.name] || 0) + i.qty;
      });
      Object.entries(v.pagos || {}).forEach(([m, monto]) => {
        porPago[m] = (porPago[m] || 0) + monto;
      });
    } else if (v.tipo === 'cambio') {
      cambiosLista.push({ id: d.id, ...v });
      (v.lleva || []).forEach((i) => {
        prendasPorNombre[i.name] = (prendasPorNombre[i.name] || 0) + i.qty;
      });
      (v.devuelve || []).forEach((i) => {
        prendasPorNombre[i.name] = (prendasPorNombre[i.name] || 0) - i.qty;
      });
      if (v.diferencia > 0 && v.pago) {
        porPago[v.pago] = (porPago[v.pago] || 0) + v.diferencia;
      }
    }
  });
  cambiosLista.sort((a, b) => (a.hora < b.hora ? -1 : 1));

  const prendas = Object.entries(prendasPorNombre)
    .filter(([, qty]) => qty !== 0)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);

  const qGastos = query(collection(db, 'gastos'), where('fecha', '==', fecha), where('anulado', '==', false));
  const snapGastos = await getDocs(qGastos);
  const gastosMedio = {};
  const gastosLista = [];
  let gastosTotReal = 0; // solo lo que ya quedó registrado como gasto real
  snapGastos.docs.forEach((d) => {
    const g = d.data();
    gastosLista.push({ id: d.id, ...g });
    gastosTotReal += g.monto;
    const medio = ORIGEN_A_MEDIO[g.origen];
    if (medio) gastosMedio[medio] = (gastosMedio[medio] || 0) + g.monto;
  });
  gastosLista.sort((a, b) => (a.hora < b.hora ? -1 : 1));

  const netoPorMedio = {};
  MEDIOS.forEach((m) => {
    netoPorMedio[m] = (porPago[m] || 0) - (gastosMedio[m] || 0);
  });

  const comision = config ? await comisionDeHoy(config) : null;
  const comisionYaPagada = gastosLista
    .filter((g) => g.categoria === 'Comisión')
    .reduce((s, g) => s + g.monto, 0);
  const comisionPendiente = comision ? Math.max(0, comision.total - comisionYaPagada) : 0;

  // Total que se muestra como "Gastos del día": lo ya registrado + la comisión causada
  // que todavía no se ha pagado (para que la planilla refleje el gasto real del día).
  const gastosTot = gastosTotReal + comisionPendiente;

  const efectivoAEntregar = netoPorMedio['Efectivo'] || 0;

  return {
    porPago,
    gastosMedio,
    netoPorMedio,
    descuentos,
    gastosTot,
    gastosLista,
    comision,
    comisionYaPagada,
    comisionPendiente,
    prendas,
    cambiosLista,
    efectivoAEntregar,
  };
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
