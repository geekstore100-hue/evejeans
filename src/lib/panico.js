import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { guardarSinBloquear } from './offlineWrite';

// El "botón de pánico": un solo documento que la sesión del computador de la
// tienda (la cuenta compartida de las vendedoras) está escuchando todo el tiempo
// mientras la app está abierta. En cuanto activo pasa a true, esa sesión se cierra
// sola, normalmente en cuestión de segundos — sin esperar a que venza el token de
// acceso (que si no fuera por esto, podría tardar hasta una hora en dejar de
// servir) — y no la deja volver a entrar mientras siga activo.
//
// La sesión de Nelson NO se cierra con esto (eso se filtra en App.jsx): como él
// normalmente entra desde su celular u otro computador, no desde el de la tienda,
// puede activar y desactivar el bloqueo desde su propia cuenta sin quedar trabado
// él mismo.
const REF = doc(db, 'config', 'panico');

export function escucharPanico(callback) {
  return onSnapshot(REF, (snap) => {
    callback(snap.exists() && snap.data().activo === true);
  });
}

// Solo Nelson puede activarlo o desactivarlo (las reglas de Firestore ya lo exigen:
// la colección "config" solo se puede escribir siendo Nelson).
export async function activarPanico(usuario) {
  await guardarSinBloquear(
    setDoc(REF, {
      activo: true,
      activadoPor: usuario.nombreDefault,
      activadoEn: serverTimestamp(),
    }),
    { contexto: 'activar bloqueo de emergencia' }
  );
}

export async function desactivarPanico(usuario) {
  await guardarSinBloquear(
    setDoc(
      REF,
      {
        activo: false,
        desactivadoPor: usuario.nombreDefault,
        desactivadoEn: serverTimestamp(),
      },
      { merge: true }
    ),
    { contexto: 'desactivar bloqueo de emergencia' }
  );
}
