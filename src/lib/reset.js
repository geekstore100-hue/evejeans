import {
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export async function reiniciarStockACero() {
  const snap = await getDocs(collection(db, 'inventario'));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(doc(db, 'inventario', d.id), { stock: 0 }));
  await batch.commit();
}

// YA NO se puede borrar las ventas de prueba desde acá: las reglas de Firestore lo
// impiden a propósito ("ventas": allow delete: if false — ni siquiera Nelson). Es
// justo lo que protege que una venta real, una vez creada, no se pueda borrar por
// error ni con un bug. Por eso esa parte del reinicio se hace, una sola vez, a mano
// desde Firebase Console: Firestore Database -> colección "ventas" -> los tres
// puntos junto al nombre -> "Eliminar colección".

// Los contadores tampoco se pueden simplemente "poner en 0" con un update — las
// reglas solo dejan sumarle 1 de a uno (para que el consecutivo nunca se pueda
// pisar). Por eso se borra el documento y se vuelve a crear: eso sí lo puede hacer
// Nelson. Hay DOS contadores: el de ventas/cambios ("ventas") y el de los
// comprobantes de nómina en Gastos ("pagos") — los dos quedan con números de
// prueba si no se reinician los dos.
async function reiniciarContador(nombre) {
  const ref = doc(db, 'contadores', nombre);
  await deleteDoc(ref);
  await setDoc(ref, { ultimo: 0 });
}
export async function reiniciarConsecutivo() {
  await reiniciarContador('ventas');
  await reiniciarContador('pagos');
}

// Reinicia lo que SÍ se puede reiniciar desde la app: el stock de todo el
// inventario y los dos consecutivos (ventas/cambios, y pagos de nómina). El
// borrado de las ventas y gastos de prueba es aparte, a mano, en Firebase Console
// (ver arriba) — antes o después, no importa el orden entre las cosas.
export async function reiniciarParaProduccion() {
  await reiniciarStockACero();
  await reiniciarConsecutivo();
}
