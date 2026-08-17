import {
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export async function reiniciarStockACero() {
  const snap = await getDocs(collection(db, 'inventario'));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(doc(db, 'inventario', d.id), { stock: 0 }));
  await batch.commit();
}

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

export async function reiniciarConsecutivo() {
  await setDoc(doc(db, 'contadores', 'ventas'), { ultimo: 0 });
}

export async function reiniciarParaProduccion() {
  const nVentasBorradas = await borrarTodasLasVentas();
  await reiniciarStockACero();
  await reiniciarConsecutivo();
  return { nVentasBorradas };
}
