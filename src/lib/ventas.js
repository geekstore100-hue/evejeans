import {
  doc,
  collection,
  runTransaction,
  writeBatch,
  increment,
  getDoc,
  getDocs,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { guardarSinBloquear } from './offlineWrite';

export function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

// No usa runTransaction a propósito: las transacciones necesitan internet en el
// momento mismo y no se pueden dejar guardadas para subir después — con eso no se
// podría facturar sin conexión. En su lugar se usa un writeBatch (sí se guarda sin
// internet y sube solo cuando vuelve) junto con increment(), que le dice a Firebase
// "réstale esto a lo que sea que tenga guardado" en vez de "el número es X, ponlo en
// Y" — así el stock siempre queda matemáticamente correcto sin importar cuántas
// ventas queden pendientes de subir ni en qué orden lleguen. Lo único que se pierde
// frente a la transacción es la revisión de stock "en el mismo instante" contra el
// servidor; el chequeo de stock sigue existiendo, pero mirando el último dato que
// tiene el computador (en vivo si hay internet, guardado si no lo hay).
export async function registrarVenta({ usuario, items, descuento, motivoDescuento, pagos }) {
  if (!items || items.length === 0) throw new Error('No hay prendas en la venta.');

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = Math.max(0, subtotal - (descuento || 0));

  const contadorRef = doc(db, 'contadores', 'ventas');
  const ventaRef = doc(collection(db, 'ventas'));
  const refsInventario = items.map((i) => doc(db, 'inventario', i.id));

  const contadorSnap = await getDoc(contadorRef);
  if (!contadorSnap.exists()) {
    throw new Error('El sistema no está inicializado todavía (falta el contador). Avisa a Nelson.');
  }
  const snapsInventario = [];
  for (const ref of refsInventario) {
    snapsInventario.push(await getDoc(ref));
  }

  snapsInventario.forEach((snap, idx) => {
    if (!snap.exists()) {
      throw new Error(`La prenda "${items[idx].name}" ya no existe en el inventario.`);
    }
    const stockActual = snap.data().stock || 0;
    if (stockActual < items[idx].qty) {
      throw new Error(`No hay suficiente stock de "${items[idx].name}" (quedan ${stockActual}).`);
    }
  });

  // Número que se muestra en el ticket — se calcula con el último dato que tiene el
  // computador. El conteo real (el que queda guardado) se lleva con increment(1),
  // así que aunque dos ventas offline calculen el mismo número para mostrar, el
  // contador de verdad nunca se pierde ni se pisa cuando ambas suban.
  const num = (contadorSnap.data().ultimo || 0) + 1;

  // El costo de compra queda "congelado" con el valor de hoy — si mañana cambia,
  // esta venta ya no se ve afectada, igual que ya pasa con el precio de venta.
  const itemsConCosto = items.map((i, idx) => ({
    ...i,
    costoCompra: snapsInventario[idx].data().costoCompra || 0,
  }));

  const pagoLabel = Object.keys(pagos).length === 1 ? Object.keys(pagos)[0] : 'Combinado';
  const fecha = hoyStr();
  const hora = ahoraStr();

  const batch = writeBatch(db);
  batch.update(contadorRef, { ultimo: increment(1) });
  refsInventario.forEach((ref, idx) => {
    batch.update(ref, { stock: increment(-items[idx].qty) });
  });
  batch.set(ventaRef, {
    num,
    fecha,
    hora,
    tipo: 'venta',
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    items: itemsConCosto,
    subtotal,
    descuento: descuento || 0,
    motivoDescuento: motivoDescuento || null,
    total,
    pagos,
    pagoLabel,
    anulada: false,
    creadoEn: serverTimestamp(),
  });
  await guardarSinBloquear(batch.commit(), { contexto: `venta #${num}` });

  return { num, total, fecha, hora };
}

export async function ventasPorFecha(fecha) {
  const q = query(collection(db, 'ventas'), where('fecha', '==', fecha));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0));
}

export async function ventasDeHoy() {
  return ventasPorFecha(hoyStr());
}

// Solo Nelson (las reglas de Firestore ya lo exigen). Revierte el stock que se movió
// y marca la venta o el cambio como anulado — nunca se borra, queda el registro.
export async function anularVenta(v, motivo, usuario) {
  const ref = doc(db, 'ventas', v.id);
  await runTransaction(db, async (tx) => {
    if (v.tipo === 'venta') {
      const refsInv = v.items.map((i) => doc(db, 'inventario', i.id));
      const snaps = [];
      for (const r of refsInv) snaps.push(await tx.get(r));
      snaps.forEach((snap, idx) => {
        const nuevo = (snap.data()?.stock || 0) + v.items[idx].qty;
        tx.update(refsInv[idx], { stock: nuevo });
      });
    } else if (v.tipo === 'cambio') {
      const refsDev = v.devuelve.map((i) => doc(db, 'inventario', i.id));
      const refsLlv = v.lleva.map((i) => doc(db, 'inventario', i.id));
      const snapsDev = [];
      for (const r of refsDev) snapsDev.push(await tx.get(r));
      const snapsLlv = [];
      for (const r of refsLlv) snapsLlv.push(await tx.get(r));
      snapsDev.forEach((snap, idx) => {
        tx.update(refsDev[idx], { stock: Math.max(0, (snap.data()?.stock || 0) - v.devuelve[idx].qty) });
      });
      snapsLlv.forEach((snap, idx) => {
        tx.update(refsLlv[idx], { stock: (snap.data()?.stock || 0) + v.lleva[idx].qty });
      });
    }
    tx.update(ref, {
      anulada: true,
      motivoAnulacion: motivo,
      anuladaPor: usuario.nombreDefault,
    });
  });
}
