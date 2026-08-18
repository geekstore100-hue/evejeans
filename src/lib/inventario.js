import {
  collection,
  onSnapshot,
  doc,
  writeBatch,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { CATALOGO_BASE } from './catalogoBase';

// Para la bitácora: historial de ajustes de precio/stock (nombre, motivo, valor anterior/nuevo).
export async function ajustesRecientes(limite = 15) {
  const snap = await getDocs(collection(db, 'ajustesInventario'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
    .slice(0, limite);
}

export function suscribirInventario(callback, onError) {
  const ref = collection(db, 'inventario');
  return onSnapshot(
    ref,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(items);
    },
    (err) => {
      console.error('Error leyendo inventario:', err);
      if (onError) onError(err);
    }
  );
}

export async function sembrarCatalogoInicial() {
  const batch = writeBatch(db);
  CATALOGO_BASE.forEach((item) => {
    const ref = doc(db, 'inventario', item.id);
    batch.set(ref, {
      name: item.name,
      price: item.price,
      tipo: item.tipo,
      stock: 0,
      costoCompra: 0,
      oculto: false,
    });
  });
  await batch.commit();

  const contadorRef = doc(db, 'contadores', 'ventas');
  const contadorSnap = await getDoc(contadorRef);
  if (!contadorSnap.exists()) {
    await setDoc(contadorRef, { ultimo: 0 });
  }
}
