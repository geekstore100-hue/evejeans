import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export const CONFIG_DEFAULT = {
  comisionMinimo: 6,
  comisionValor: 1000,
  comisionPorRef: {},
  conteoActivado: true,
  // Referencias que Nelson eligió a mano para el PRÓXIMO conteo de inicio de
  // semana (en vez de las 2 al azar de siempre). Se usa una sola vez: al
  // guardar ese conteo se vacía otra vez, y la semana siguiente vuelve a ser
  // al azar a menos que él elija de nuevo.
  conteoReferenciasElegidas: [],
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
