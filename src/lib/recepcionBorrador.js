// Borrador del conteo en curso al confirmar la recepción de un pedido,
// guardado en este dispositivo (localStorage) mientras no se confirme — así,
// si llega una venta a mitad del conteo y toca cambiar de pestaña (o hasta si
// se recarga la página), al volver a "Confirmar" ese mismo pedido se
// recuperan los números que ya se habían escrito, sin tener que volver a
// contar ni a teclear todo desde cero. También sirve para recordarle a quien
// está vendiendo que dejó una confirmación a medias (ver hayBorradorEnCurso).

const PREFIJO = 'evejeans_recepcion_borrador_';

function claveBorrador(pedidoId) {
  return `${PREFIJO}${pedidoId}`;
}

export function leerBorrador(pedidoId) {
  try {
    const crudo = localStorage.getItem(claveBorrador(pedidoId));
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;
  }
}

// Solo guarda de verdad si ya escribió algo — así, con solo abrir "Confirmar"
// sin tocar nada, no queda un borrador vacío que dispare el recordatorio en
// Ventas sin que haya ningún conteo real a medias.
export function guardarBorrador(pedidoId, cantidades) {
  try {
    const tieneAlgo = Object.values(cantidades || {}).some((v) => v !== '');
    if (tieneAlgo) {
      localStorage.setItem(claveBorrador(pedidoId), JSON.stringify(cantidades));
    } else {
      localStorage.removeItem(claveBorrador(pedidoId));
    }
  } catch {
    // Si falla (almacenamiento lleno o bloqueado) no pasa nada grave — el
    // conteo sigue funcionando, solo que sin recordar el borrador.
  }
}

export function borrarBorrador(pedidoId) {
  try {
    localStorage.removeItem(claveBorrador(pedidoId));
  } catch {
    // no pasa nada
  }
}

// ¿Hay alguna confirmación de recepción a medias en este dispositivo? Se usa
// para avisar en Ventas, por si a alguien le tocó cambiar de pestaña a mitad
// del conteo y se le puede olvidar volver a terminarlo.
export function hayBorradorEnCurso() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (clave && clave.startsWith(PREFIJO)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
