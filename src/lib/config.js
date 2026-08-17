import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export const CONFIG_DEFAULT = {
  comisionMinimo: 6,
  comisionValor: 1000,
  comisionPorRef: {},
};

export function suscribirConfig(callback, onError) {
  return onSnapshot(
    doc(db, 'config', 'general'),
    (snap) => {
      callback(snap.exists() ? { ...CONFIG_DEFAULT, ...snap.data() } : CONFIG_DEFAULT);
    },
    (err) => {
      console.error('Error leyendo configuración:', err);
      if (onError) onError(err);
    }
  );
}

export async function guardarConfig(nueva) {
  await setDoc(doc(db, 'config', 'general'), nueva, { merge: true });
}
