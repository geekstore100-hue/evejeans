import { doc, collection, runTransaction, serverTimestamp } from 'firebase/firestore';
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

export async function registrarCambio({ usuario, devuelve, lleva, pagoDif }) {
  if (!devuelve.length) throw new Error('Falta lo que el cliente devuelve.');
  if (!lleva.length) throw new Error('Falta lo que el cliente se lleva.');

  const valDev = devuelve.reduce((s, i) => s + i.price * i.qty, 0);
  const valLlv = lleva.reduce((s, i) => s + i.price * i.qty, 0);
  const diferencia = valLlv - valDev;

  const contadorRef = doc(db, 'contadores', 'ventas');
  const cambioRef = doc(collection(db, 'ventas'));
  const refsDevuelve = devuelve.map((i) => doc(db, 'inventario', i.id));
  const refsLleva = lleva.map((i) => doc(db, 'inventario', i.id));

  const resultado = await runTransaction(db, async (tx) => {
    const contadorSnap = await tx.get(contadorRef);
    if (!contadorSnap.exists()) {
      throw new Error('El sistema no está inicializado todavía (falta el contador). Avisa a Nelson.');
    }
    const snapsDevuelve = [];
    for (const ref of refsDevuelve) snapsDevuelve.push(await tx.get(ref));
    const snapsLleva = [];
    for (const ref of refsLleva) snapsLleva.push(await tx.get(ref));

    snapsLleva.forEach((snap, idx) => {
      if (!snap.exists()) throw new Error(`La prenda "${lleva[idx].name}" ya no existe.`);
      const stockActual = snap.data().stock || 0;
      if (stockActual < lleva[idx].qty) {
        throw new Error(`No hay suficiente stock de "${lleva[idx].name}" (quedan ${stockActual}).`);
      }
    });
    snapsDevuelve.forEach((snap, idx) => {
      if (!snap.exists()) throw new Error(`La prenda "${devuelve[idx].name}" ya no existe.`);
    });

    const num = (contadorSnap.data().ultimo || 0) + 1;

    tx.update(contadorRef, { ultimo: num });
    snapsDevuelve.forEach((snap, idx) => {
      const nuevo = (snap.data().stock || 0) + devuelve[idx].qty;
      tx.update(refsDevuelve[idx], { stock: nuevo });
    });
    snapsLleva.forEach((snap, idx) => {
      const nuevo = (snap.data().stock || 0) - lleva[idx].qty;
      tx.update(refsLleva[idx], { stock: nuevo });
    });

    tx.set(cambioRef, {
      num,
      fecha: hoyStr(),
      hora: ahoraStr(),
      tipo: 'cambio',
      usuarioId: usuario.id,
      usuarioNombre: usuario.nombreDefault,
      devuelve,
      lleva,
      valDev,
      valLlv,
      diferencia,
      pago: diferencia > 0 ? pagoDif : null,
      total: Math.max(0, diferencia),
      anulada: false,
      creadoEn: serverTimestamp(),
    });

    return { num, valDev, valLlv, diferencia };
  });

  return resultado;
}
