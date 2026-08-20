import {
  collection,
  doc,
  setDoc,
  getDoc,
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

export async function resumenDia(fecha, config, opciones = {}) {
  const { restarComisionDeEfectivo = true } = opciones;
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

  // Compras de mercancía del día: también salen de algún medio, igual que los gastos.
  const qCompras = query(collection(db, 'compras'), where('fecha', '==', fecha));
  const snapCompras = await getDocs(qCompras);
  const comprasLista = [];
  const comprasMedio = {};
  let comprasTot = 0;
  snapCompras.docs.forEach((d) => {
    const c = d.data();
    comprasLista.push({ id: d.id, ...c });
    comprasTot += c.totalGeneral;
    const medio = ORIGEN_A_MEDIO[c.origen];
    if (medio) {
      comprasMedio[medio] = (comprasMedio[medio] || 0) + c.totalGeneral;
      netoPorMedio[medio] = (netoPorMedio[medio] || 0) - c.totalGeneral;
    }
  });
  comprasLista.sort((a, b) => (a.hora < b.hora ? -1 : 1));

  const comision = config ? await comisionDeHoy(config, fecha) : null;
  const comisionMonto = comision && comision.aplica ? comision.total : 0;

  // La comisión se toma en efectivo, pero solo se saca físicamente de la caja al
  // cierre del día — durante el día ese dinero todavía está ahí. Por eso el chequeo
  // en vivo (Vender) no la resta, y el cierre del día sí.
  if (restarComisionDeEfectivo) {
    netoPorMedio['Efectivo'] = (netoPorMedio['Efectivo'] || 0) - comisionMonto;
  }

  // "Gastos del día" que se ve en pantalla: lo ya registrado + la comisión automática.
  const gastosTot = gastosTotReal + comisionMonto;

  const efectivoAEntregar = netoPorMedio['Efectivo'] || 0;

  // Lo que entró en total ese día, sumando todos los medios de pago — ventas más lo
  // que se cobró de diferencia en cambios, sin restar todavía gastos ni comisión.
  const totalVendido = MEDIOS.reduce((s, m) => s + (porPago[m] || 0), 0);

  return {
    porPago,
    totalVendido,
    gastosMedio,
    comprasMedio,
    comprasLista,
    comprasTot,
    netoPorMedio,
    descuentos,
    gastosTot,
    gastosLista,
    comision,
    comisionMonto,
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

// Observaciones libres del día (una nota por fecha, se puede corregir). Un solo
// documento por fecha — la usa cualquiera autenticado, no es un dato financiero.
export async function leerObservacion(fecha) {
  const snap = await getDoc(doc(db, 'observacionesCierre', fecha));
  return snap.exists() ? snap.data().texto || '' : '';
}

export async function guardarObservacion(fecha, texto, usuario) {
  await setDoc(doc(db, 'observacionesCierre', fecha), {
    fecha,
    texto,
    actualizadoPor: usuario.nombreDefault,
    actualizadoEn: serverTimestamp(),
  });
}

export { hoyStr, ahoraStr, MEDIOS };
