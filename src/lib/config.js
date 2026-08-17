import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export const CONFIG_DEFAULT = {
  comisionMinimo: 6,
  comisionValor: 1000,
  comisionPorRef: {}, // {itemId: valorDistinto}
};

export function suscribirConfig(callback) {
  return onSnapshot(doc(db, 'config', 'general'), (snap) => {
    callback(snap.exists() ? { ...CONFIG_DEFAULT, ...snap.data() } : CONFIG_DEFAULT);
  });
}

export async function guardarConfig(nueva) {
  await setDoc(doc(db, 'config', 'general'), nueva, { merge: true });
}
