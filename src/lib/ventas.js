import {
  doc,
  collection,
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

export async function registrarVenta({ usuario, items, descuento, motivoDescuento, pagos }) {
  if (!items || items.length === 0) throw new Error('No hay prendas en la venta.');

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = Math.max(0, subtotal - (descuento || 0));

  const contadorRef = doc(db, 'contadores', 'ventas');
  const ventaRef = doc(collection(db, 'ventas'));
  const refsInventario = items.map((i) => doc(db, 'inventario', i.id));

  const resultado = await runTransaction(db, async (tx) => {
    const contadorSnap = await tx.get(contadorRef);
    if (!contadorSnap.exists()) {
      throw new Error('El sistema no está inicializado todavía (falta el contador). Avisa a Nelson.');
    }
    const snapsInventario = [];
    for (const ref of refsInventario) {
      snapsInventario.push(await tx.get(ref));
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

    const num = (contadorSnap.data().ultimo || 0) + 1;

    tx.update(contadorRef, { ultimo: num });
    // El costo de compra queda "congelado" con el valor de hoy — si mañana cambia,
    // esta venta ya no se ve afectada, igual que ya pasa con el precio de venta.
    const itemsConCosto = items.map((i, idx) => ({
      ...i,
      costoCompra: snapsInventario[idx].data().costoCompra || 0,
    }));
    snapsInventario.forEach((snap, idx) => {
      const nuevoStock = (snap.data().stock || 0) - items[idx].qty;
      tx.update(refsInventario[idx], { stock: nuevoStock });
    });

    const pagoLabel = Object.keys(pagos).length === 1 ? Object.keys(pagos)[0] : 'Combinado';

    tx.set(ventaRef, {
      num,
      fecha: hoyStr(),
      hora: ahoraStr(),
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

    return { num, total, fecha: hoyStr(), hora: ahoraStr() };
  });

  return resultado;
}

export async function ventasDeHoy() {
  const q = query(collection(db, 'ventas'), where('fecha', '==', hoyStr()));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0));
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
