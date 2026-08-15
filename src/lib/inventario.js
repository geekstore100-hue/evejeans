import {
  collection,
  onSnapshot,
  doc,
  writeBatch,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { CATALOGO_BASE } from './catalogoBase';

// Escucha el inventario en tiempo real. Devuelve la función para dejar de escuchar.
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

// Se usa una sola vez, desde Administración, para cargar el catálogo con stock en 0.
// El conteo físico real se carga después, editando cada referencia a mano en Firestore
// (o desde el panel de administración cuando lo construyamos).
export async function sembrarCatalogoInicial() {
  const batch = writeBatch(db);
  CATALOGO_BASE.forEach((item) => {
    const ref = doc(db, 'inventario', item.id);
    batch.set(ref, {
      name: item.name,
      price: item.price,
      tipo: item.tipo,
      stock: 0,
      oculto: false,
    });
  });
  await batch.commit();

  // El contador de ventas nace en 0 si todavía no existe.
  const contadorRef = doc(db, 'contadores', 'ventas');
  const contadorSnap = await getDoc(contadorRef);
  if (!contadorSnap.exists()) {
    await setDoc(contadorRef, { ultimo: 0 });
  }
}
