// Ayuda para los campos donde se escribe un valor en pesos (ej. "Precio de
// compra"): el número real que se guarda son solo los dígitos, sin formato
// (igual que antes), pero mientras se está escribiendo se MUESTRA con "$" y
// el punto de los miles — así se ve "$50.000" en vez de "50000", y es más
// fácil notar si falta o sobra un cero.

// Deja solo los números de lo que se escribió (borra "$", puntos, letras...)
// — esto es lo que de verdad queda guardado en el estado del formulario.
export function soloDigitos(texto) {
  // Acepta tanto texto (lo que escribe la persona) como un número ya
  // guardado (algunas pantallas guardan el costo como número, no como
  // texto) — por eso el String(...) antes de limpiar.
  return String(texto ?? '').replace(/\D/g, '');
}

// A partir de esos dígitos, arma el texto formateado para MOSTRAR en el
// campo. Si está vacío, se deja vacío (para que siga viéndose el placeholder).
export function formatoPesos(valorDigitos) {
  const limpio = soloDigitos(valorDigitos);
  if (!limpio) return '';
  return '$' + parseInt(limpio, 10).toLocaleString('es-CO');
}
