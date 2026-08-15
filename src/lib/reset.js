import {
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';

// Pone el stock de todas las referencias en 0, sin tocar nombre/precio/tipo.
// Después de esto se carga el conteo físico real, referencia por referencia.
export async function reiniciarStockACero() {
  const snap = await getDocs(collection(db, 'inventario'));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(doc(db, 'inventario', d.id), { stock: 0 }));
  await batch.commit();
}

// Borra todas las ventas de prueba. Firestore borra de a 500 por lote como máximo.
export async function borrarTodasLasVentas() {
  const snap = await getDocs(collection(db, 'ventas'));
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const lote = docs.slice(i, i + 400);
    const batch = writeBatch(db);
    lote.forEach((d) => batch.delete(doc(db, 'ventas', d.id)));
    await batch.commit();
  }
  return docs.length;
}

// El consecutivo vuelve a 0, así la primera venta real queda con el N.º 1.
export async function reiniciarConsecutivo() {
  await setDoc(doc(db, 'contadores', 'ventas'), { ultimo: 0 });
}

// Hace las tres cosas de una sola vez: el botón de "arrancar en serio".
export async function reiniciarParaProduccion() {
  const nVentasBorradas = await borrarTodasLasVentas();
  await reiniciarStockACero();
  await reiniciarConsecutivo();
  return { nVentasBorradas };
}
