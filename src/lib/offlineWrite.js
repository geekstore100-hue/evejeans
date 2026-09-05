// Guarda (un writeBatch, un setDoc, un updateDoc — cualquier cosa que devuelva una
// promesa) sin dejar la pantalla "pegada" si no hay internet.
//
// Firestore solo resuelve la promesa de commit() cuando el SERVIDOR confirma el
// guardado — si no hay internet, esa promesa se queda esperando indefinidamente,
// aunque el dato ya haya quedado guardado a salvo en el disco del computador (eso
// pasa de inmediato, no depende de la conexión). Sin este límite, la pantalla de
// "Guardando…" se quedaría así congelada mientras no vuelva la señal.
//
// Por eso acá se le pone un tiempo máximo de espera:
// - Si hay internet, el servidor normalmente confirma en menos de un segundo, así
//   que esto no cambia nada del comportamiento de siempre.
// - Si no hay internet, después de esperar ese tiempo se sigue de largo igual —
//   el guardado local ya está hecho — y la confirmación real sigue corriendo por
//   detrás sola; en cuanto vuelva la señal, sube.
// - Pero si el guardado falla DE VERDAD antes de que se cumpla ese tiempo (no por
//   lentitud, sino porque Firestore lo rechazó — por ejemplo un permiso, o un dato
//   inválido), antes esto quedaba solo en la consola del navegador y la pantalla
//   igual mostraba "¡Listo!" como si se hubiera guardado — dando a entender que
//   quedó registrado cuando en realidad no. Por eso ahora, en ese caso concreto,
//   se relanza el error para que la pantalla que llamó a esto se entere (todas ya
//   tienen su propio "no se pudo guardar" preparado) y avise de verdad, en vez de
//   mostrar una confirmación falsa.
export async function guardarSinBloquear(promesa, { limiteMs = 4000, contexto = '' } = {}) {
  const resultado = await Promise.race([
    promesa.then(() => ({ estado: 'confirmado' })).catch((err) => ({ estado: 'error', err })),
    new Promise((resolve) => setTimeout(() => resolve({ estado: 'pendiente' }), limiteMs)),
  ]);

  if (resultado.estado === 'error') {
    console.error(`No se pudo guardar en Firebase${contexto ? ' (' + contexto + ')' : ''}:`, resultado.err);
    throw resultado.err;
  }

  if (resultado.estado === 'pendiente') {
    // Sigue subiendo por detrás (offline o muy lento) — si de aquí a que suba
    // de verdad llega a fallar, ya no hay ninguna pantalla esperando para
    // avisar, así que por lo menos queda registrado en la consola.
    promesa.catch((err) => {
      console.error(`No se pudo sincronizar con Firebase${contexto ? ' (' + contexto + ')' : ''}:`, err);
    });
    return 'pendiente';
  }

  return 'confirmado';
}
