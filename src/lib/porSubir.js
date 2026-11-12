import { doc, getDocFromServer, waitForPendingWrites } from 'firebase/firestore';
import { db, auth } from './firebase';

// Registro de lo que se guardó SIN INTERNET y todavía no ha llegado al
// servidor (ventas, cambios, gastos, movimientos de mercancía…).
//
// Por qué existe: sin internet la app deja seguir (dice "Venta registrada") y
// Firebase sube la venta sola cuando vuelve la señal. Pero si al subir el
// servidor la RECHAZA, Firebase la borra del computador sin avisar: la venta
// desaparecía del historial y la plata quedaba en la caja sin registro. Ahora
// cada cosa guardada sin internet queda anotada aquí (en este computador)
// hasta que el servidor la confirme; si la rechaza, queda marcada para que la
// pantalla avise en grande y se pueda volver a registrar.
//
// Cada anotación: { clave, coleccion, id, que, detalle, fecha, hora, estado: 'esperando'|'rechazada', motivo }

const CLAVE = 'evejeans_por_subir';
const EVENTO = 'evejeans-por-subir';

export function leerPorSubir() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) || '[]') || [];
  } catch {
    return [];
  }
}
function guardar(lista) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch {
    // sin almacenamiento: no se puede llevar el registro, pero no se bloquea nada
  }
  window.dispatchEvent(new Event(EVENTO));
}

export function anotarPorSubir(reg) {
  const lista = leerPorSubir().filter((x) => x.clave !== reg.clave);
  // La cuenta con la que se guardó: lo pendiente de una cuenta solo sube
  // mientras esa misma cuenta esté abierta en este computador.
  lista.push({ ...reg, cuenta: auth.currentUser?.uid || null, estado: 'esperando' });
  guardar(lista);
}
export function quitarPorSubir(clave) {
  guardar(leerPorSubir().filter((x) => x.clave !== clave));
}
export function marcarRechazada(clave, motivo) {
  guardar(leerPorSubir().map((x) => (x.clave === clave ? { ...x, estado: 'rechazada', motivo } : x)));
}

// Para las pantallas: se avisa cada vez que cambia la lista.
export function escucharPorSubir(callback) {
  const avisar = () => callback(leerPorSubir());
  avisar();
  window.addEventListener(EVENTO, avisar);
  window.addEventListener('storage', avisar); // otra pestaña del mismo computador
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener('storage', avisar);
  };
}

export function explicarRechazo(err) {
  const t = `${err?.code || ''} ${err?.message || err || ''}`;
  if (/permission|insufficient/i.test(t)) return 'El servidor no la aceptó (no tenía permiso para guardarla así).';
  return 'El servidor no la aceptó: ' + (err?.message || err);
}

// Revisión al abrir la app o al volver el internet: cuando ya no queda nada
// por subir, se pregunta al servidor por cada anotación. Si existe, se quita;
// si no existe, es que se rechazó (por ejemplo, si se recargó la página
// mientras no había internet y por eso nadie se enteró del rechazo).
let revisando = false;
export async function revisarPorSubir() {
  if (revisando || typeof navigator !== 'undefined' && navigator.onLine === false) return;
  // Solo lo de la cuenta abierta ahora: lo de otra cuenta (por ejemplo, la de
  // vendedoras cuando entra Nelson en el mismo computador) sigue esperando su
  // turno en la cola de esa cuenta, y no se puede dar por perdido.
  const cuenta = auth.currentUser?.uid || null;
  const esperando = leerPorSubir().filter((x) => x.estado === 'esperando' && x.cuenta === cuenta);
  if (!esperando.length) return;
  revisando = true;
  try {
    await Promise.race([waitForPendingWrites(db), new Promise((_, no) => setTimeout(() => no(new Error('tiempo')), 30000))]);
    for (const reg of esperando) {
      try {
        const snap = await getDocFromServer(doc(db, reg.coleccion, reg.id));
        const llego = snap.exists() && (!reg.verificar || snap.data()[reg.verificar.campo] === reg.verificar.valor);
        if (llego) quitarPorSubir(reg.clave);
        else marcarRechazada(reg.clave, 'Nunca llegó al servidor.');
      } catch {
        // sin conexión de verdad todavía: se vuelve a revisar después
      }
    }
  } catch {
    // sigue habiendo cosas por subir: se revisa la próxima vez
  } finally {
    revisando = false;
  }
}
