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
// - Si el guardado llega a fallar de verdad más adelante (por ejemplo porque el
//   stock ya no alcanzaba cuando por fin subió — el caso raro de dos ventas
//   pisándose sin internet que ya hablamos que no es un escenario usual acá),
//   queda registrado en la consola del navegador para poder revisarlo.
export async function guardarSinBloquear(promesa, { limiteMs = 4000, contexto = '' } = {}) {
  promesa.catch((err) => {
    console.error(`No se pudo sincronizar con Firebase${contexto ? ' (' + contexto + ')' : ''}:`, err);
  });
  return Promise.race([
    promesa.then(() => 'confirmado').catch(() => 'error'),
    new Promise((resolve) => setTimeout(() => resolve('pendiente'), limiteMs)),
  ]);
}
