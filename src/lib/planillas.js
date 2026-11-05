import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  documentId,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { resumenDia } from './cierre';

// "Planilla" = el efectivo a entregar de un día ya cerrado (el mismo número que
// sale en el ticket impreso de Cierre del día), guardado una sola vez para no
// tener que recalcularlo cada vez. Reemplaza la firma en papel (original y
// copia) con un respaldo digital: se declara sola (no hay que escribir nada a
// mano) y alguien la recibe y la confirma — igual de estricto que una venta,
// nunca se puede editar después.
//
// Días normales: la planilla se crea "pendiente" apenas alguien abre la
// pantalla de recibir efectivo (revisando hacia atrás), con el monto que ya
// calculó el Cierre de ese día. Nadie escribe el monto a mano.
//
// El día de HOY es especial: normalmente no se recoge en el mismo día, así que
// no se crea planilla de hoy en automático (el número seguiría subiendo con
// cada venta). Solo en diciembre, cuando sí se recoge la misma noche, se usa
// confirmarPlanillaHoy() para calcularla en el momento justo de recibirla.

const DIAS_HACIA_ATRAS = 90;

export function idSaldo(fecha) {
  return `${fecha}_saldo`;
}

// Cómo se nombra una planilla en pantalla: "2026-10-29", o "2026-10-29
// (saldo)" para lo que se vendió después de haberla recogido el mismo día.
export function etiquetaPlanilla(p) {
  return p.esSaldo ? `${p.fecha} (saldo)` : p.fecha;
}

function planillaNueva(fecha, efectivoAEntregar) {
  return {
    fecha,
    efectivoAEntregar,
    estado: 'pendiente', // pendiente | recibido
    // "Habilitada": la vendedora avisó que ya tiene ese efectivo listo para
    // entregar (ver habilitarTodoPendiente). No es lo mismo que "recibido" —
    // solo dice que está lista para que la recojan.
    habilitada: false,
    habilitadaPorId: null,
    habilitadaPorNombre: null,
    habilitadaFecha: null,
    habilitadaHora: null,
    recibido: null,
    difEntrega: null,
    entregoNombre: null,
    recibidoPorId: null,
    recibidoPorNombre: null,
    recibidoFecha: null,
    notaRecibo: null,
    creadoEn: serverTimestamp(),
  };
} // suficiente para cualquier atraso normal, sin revisar meses y meses cada vez

function fechaAStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hoyStr() {
  return fechaAStr(new Date());
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

// Revisa los últimos DIAS_HACIA_ATRAS días (sin contar hoy) y crea la planilla
// de los que todavía no la tengan y sí tuvieron efectivo que entregar. Se puede
// llamar todas las veces que se quiera: los días que ya tienen planilla no se
// vuelven a tocar ni a recalcular (por eso es seguro y rápido después de la
// primera vez).
export async function asegurarPlanillasPendientes() {
  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(ayer.getDate() - 1);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - DIAS_HACIA_ATRAS);

  if (desde > ayer) return; // por si DIAS_HACIA_ATRAS quedara en 0

  const desdeStr = fechaAStr(desde);
  const ayerStr = fechaAStr(ayer);

  // Una sola consulta para saber cuáles de esos días ya tienen planilla,
  // en vez de revisar día por día.
  // ("\uf8ff" al final: así también entran los "saldos" de esos días, cuyo
  // id es "AAAA-MM-DD_saldo" — ver más abajo.)
  const q = query(
    collection(db, 'planillas'),
    where(documentId(), '>=', desdeStr),
    where(documentId(), '<=', ayerStr + '\uf8ff')
  );
  const snap = await getDocs(q);
  const yaExisten = new Set(snap.docs.map((d) => d.id));

  // Días que se recogieron EL MISMO DÍA (botón "efectivo de HOY mismo"): se
  // recogió lo vendido hasta ese momento, pero la tienda siguió vendiendo. Lo
  // que entró después quedaba sin registrar en ningún lado — por eso ahora,
  // ya terminado ese día, se calcula el día completo y, si hay más efectivo
  // del que se recogió, se crea una planilla aparte "saldo" por la
  // diferencia, pendiente de recoger como cualquier otro día. Solo se revisan
  // las últimas 2 semanas (el saldo aparece desde el día siguiente).
  const hace14 = new Date(hoy);
  hace14.setDate(hace14.getDate() - 14);
  const desdeSaldos = fechaAStr(hace14);
  const recogidosMismoDia = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (p) =>
        p.id === p.fecha &&
        p.estado === 'recibido' &&
        p.recibidoFecha === p.fecha &&
        p.fecha >= desdeSaldos &&
        !yaExisten.has(idSaldo(p.fecha))
    );
  await Promise.all(
    recogidosMismoDia.map(async (p) => {
      const resumen = await resumenDia(p.fecha);
      const saldo = (resumen.efectivoAEntregar || 0) - (p.efectivoAEntregar || 0);
      if (saldo > 0) {
        await setDoc(doc(db, 'planillas', idSaldo(p.fecha)), {
          ...planillaNueva(p.fecha, saldo),
          esSaldo: true,
          recogidoAntes: p.efectivoAEntregar || 0,
        });
      }
    })
  );

  const faltantes = [];
  for (let d = new Date(desde); d <= ayer; d.setDate(d.getDate() + 1)) {
    const fecha = fechaAStr(d);
    if (!yaExisten.has(fecha)) faltantes.push(fecha);
  }
  if (faltantes.length === 0) return;

  // Se calculan todos los días que falten al tiempo (en paralelo) en vez de uno
  // por uno — la primera vez que se abre esta pantalla puede haber varios días
  // sin revisar, y calcularlos de a uno hace que la carga se sienta muy lenta.
  await Promise.all(
    faltantes.map(async (fecha) => {
      const resumen = await resumenDia(fecha);
      const efectivoAEntregar = resumen.efectivoAEntregar || 0;
      // Si ese día no hubo nada de efectivo (por ejemplo un día cerrado), no se
      // crea planilla — no hay nada que recoger. Vuelve a revisarse la próxima
      // vez, pero eso no cuesta nada (una consulta vacía).
      if (efectivoAEntregar > 0) {
        await setDoc(doc(db, 'planillas', fecha), planillaNueva(fecha, efectivoAEntregar));
      }
    })
  );
}

export async function planillasPendientes() {
  const q = query(collection(db, 'planillas'), where('estado', '==', 'pendiente'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

// La vendedora avisa que YA tiene lista para entregar toda la plata que esté
// pendiente en este momento (todos los días juntos de una vez, no uno por
// uno) — Fausto (o Nelson) la sigue viendo en "pendiente" hasta que la reciba
// de verdad, pero ahora queda marcada como "habilitada" para que se sepa que
// ya está lista y no solo calculada.
export async function habilitarTodoPendiente(usuario) {
  const pendientes = await planillasPendientes();
  const faltantes = pendientes.filter((p) => !p.habilitada);
  if (faltantes.length === 0) return { cantidad: 0 };

  const fecha = hoyStr();
  const hora = ahoraStr();
  const batch = writeBatch(db);
  faltantes.forEach((p) => {
    batch.update(doc(db, 'planillas', p.id || p.fecha), {
      habilitada: true,
      habilitadaPorId: usuario.id,
      habilitadaPorNombre: usuario.nombreDefault,
      habilitadaFecha: fecha,
      habilitadaHora: hora,
    });
  });
  await batch.commit();
  return { cantidad: faltantes.length };
}

// Resumen de lo habilitado-pero-todavía-no-recibido, para el aviso en Ventas
// y en la pantalla de Fausto. null si no hay nada avisado en este momento.
export async function entregaHabilitadaInfo() {
  return resumenHabilitadas(await planillasPendientes());
}

// Lo mismo, pero a partir de una lista que ya se tiene (por ejemplo la que
// llega en vivo con suscribirPlanillasPendientes).
export function resumenHabilitadas(pendientes) {
  const habilitadas = pendientes.filter((p) => p.habilitada);
  if (habilitadas.length === 0) return null;
  const total = habilitadas.reduce((s, p) => s + (p.efectivoAEntregar || 0), 0);
  // El aviso más reciente, por si se avisó más de una vez, para mostrar quién
  // y a qué hora.
  const masReciente = habilitadas.reduce((a, b) => ((a.habilitadaHora || '') >= (b.habilitadaHora || '') ? a : b));
  return {
    cantidad: habilitadas.length,
    total,
    porNombre: masReciente.habilitadaPorNombre,
    hora: masReciente.habilitadaHora,
  };
}

export async function planillasRecibidas(limite = 20) {
  const q = query(collection(db, 'planillas'), where('estado', '==', 'recibido'));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fecha > a.fecha ? 1 : -1))
    .slice(0, limite);
}

// Recibir un día que ya estaba pendiente (el caso normal).
export async function confirmarPlanilla(planilla, { recibido, entregoNombre, nota }, usuario) {
  const difEntrega = recibido - planilla.efectivoAEntregar;
  await updateDoc(doc(db, 'planillas', planilla.id || planilla.fecha), {
    estado: 'recibido',
    recibido,
    difEntrega,
    entregoNombre: entregoNombre || null,
    recibidoPorId: usuario.id,
    recibidoPorNombre: usuario.nombreDefault,
    recibidoFecha: hoyStr(),
    notaRecibo: nota || null,
  });
  return { difEntrega };
}

// Caso especial (típicamente diciembre): recoger el efectivo del mismo día,
// calculándolo justo en ese momento en vez de esperar a que sea "de ayer".
export async function confirmarPlanillaHoy({ recibido, entregoNombre, nota }, usuario) {
  const fecha = hoyStr();
  const ref = doc(db, 'planillas', fecha);
  const snap = await getDoc(ref);
  let efectivoAEntregar;
  if (snap.exists()) {
    if (snap.data().estado === 'recibido') {
      throw new Error('El efectivo de hoy ya quedó registrado como recibido.');
    }
    efectivoAEntregar = snap.data().efectivoAEntregar;
  } else {
    const resumen = await resumenDia(fecha);
    efectivoAEntregar = resumen.efectivoAEntregar || 0;
    await setDoc(ref, planillaNueva(fecha, efectivoAEntregar));
  }
  const difEntrega = recibido - efectivoAEntregar;
  await updateDoc(ref, {
    estado: 'recibido',
    recibido,
    difEntrega,
    entregoNombre: entregoNombre || null,
    recibidoPorId: usuario.id,
    recibidoPorNombre: usuario.nombreDefault,
    recibidoFecha: fecha,
    notaRecibo: nota || null,
  });
  return { difEntrega, efectivoAEntregar };
}

// ---------- Recoger el efectivo del MISMO día: lo aprueba Nelson ----------
// Fausto ya no puede recoger el efectivo de hoy por su cuenta (así fue como el
// 29 de octubre quedó recogido a mitad del día). Él cuenta y PIDE; a Nelson le
// sale el aviso en su app y lo aprueba o lo rechaza. Solo al aprobar queda
// registrado como recibido. La solicitud queda guardada en
// "entregasMismoDia" como constancia.
export async function pedirEntregaHoy({ recibido, entregoNombre, nota }, usuario) {
  const fecha = hoyStr();
  const actual = await getDoc(doc(db, 'planillas', fecha));
  if (actual.exists() && actual.data().estado === 'recibido') {
    throw new Error('El efectivo de hoy ya quedó registrado como recibido.');
  }
  const resumen = await resumenDia(fecha);
  const efectivoCalculado = resumen.efectivoAEntregar || 0;
  if (efectivoCalculado <= 0) throw new Error('Hoy todavía no hay efectivo para entregar.');
  await addDoc(collection(db, 'entregasMismoDia'), {
    fecha,
    efectivoCalculado,
    recibido,
    entregoNombre: entregoNombre || null,
    nota: nota || null,
    pedidoPorId: usuario.id,
    pedidoPorNombre: usuario.nombreDefault,
    pedidoHora: ahoraStr(),
    estado: 'pedida', // pedida | aprobada | rechazada | cancelada
    resueltaPorNombre: null,
    resueltaHora: null,
    motivo: null,
    creadoEn: serverTimestamp(),
  });
  return { efectivoCalculado };
}

export async function aprobarEntregaHoy(sol, usuario) {
  const ref = doc(db, 'planillas', sol.fecha);
  const snap = await getDoc(ref);
  let efectivoAEntregar = sol.efectivoCalculado;
  if (snap.exists()) {
    if (snap.data().estado === 'recibido') throw new Error('Ese día ya quedó registrado como recibido.');
    efectivoAEntregar = snap.data().efectivoAEntregar;
  } else {
    await setDoc(ref, planillaNueva(sol.fecha, efectivoAEntregar));
  }
  const difEntrega = sol.recibido - efectivoAEntregar;
  await updateDoc(ref, {
    estado: 'recibido',
    recibido: sol.recibido,
    difEntrega,
    entregoNombre: sol.entregoNombre || null,
    recibidoPorId: sol.pedidoPorId,
    recibidoPorNombre: sol.pedidoPorNombre,
    recibidoFecha: sol.fecha,
    notaRecibo: [sol.nota, `recogido el mismo día, aprobado por ${usuario.nombreDefault}`].filter(Boolean).join(' · '),
  });
  await updateDoc(doc(db, 'entregasMismoDia', sol.id), {
    estado: 'aprobada',
    resueltaPorNombre: usuario.nombreDefault,
    resueltaHora: ahoraStr(),
  });
  return { difEntrega };
}

export async function rechazarEntregaHoy(sol, motivo, usuario) {
  await updateDoc(doc(db, 'entregasMismoDia', sol.id), {
    estado: 'rechazada',
    resueltaPorNombre: usuario.nombreDefault,
    resueltaHora: ahoraStr(),
    motivo: motivo || null,
  });
}

export async function cancelarSolicitudHoy(sol) {
  await updateDoc(doc(db, 'entregasMismoDia', sol.id), { estado: 'cancelada' });
}

function solicitudesDe(snap) {
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0));
}
// Las que esperan a Nelson (para su aviso).
export function suscribirSolicitudesPedidas(callback, onError) {
  return onSnapshot(
    query(collection(db, 'entregasMismoDia'), where('estado', '==', 'pedida')),
    (snap) => callback(solicitudesDe(snap)),
    (err) => {
      console.error('Error escuchando solicitudes de entrega:', err);
      if (onError) onError(err);
    }
  );
}
// Las de un día (para que Fausto vea cómo va la suya).
export function suscribirSolicitudesDelDia(fecha, callback, onError) {
  return onSnapshot(
    query(collection(db, 'entregasMismoDia'), where('fecha', '==', fecha)),
    (snap) => callback(solicitudesDe(snap)),
    (err) => {
      console.error('Error escuchando solicitudes del día:', err);
      if (onError) onError(err);
    }
  );
}

export async function calcularEfectivoHoy() {
  const resumen = await resumenDia(hoyStr());
  return resumen.efectivoAEntregar || 0;
}

// ---------- Versiones "en vivo" ----------
// Se quedan escuchando: cuando la vendedora avisa, o cuando Fausto (o Nelson)
// confirma que recibió, la pantalla del otro se actualiza sola — sin tener
// que recargar la página ni salir y volver a entrar. Devuelven una función
// para dejar de escuchar (se llama al salir de la pantalla).
function planillasDe(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
}

export function suscribirPlanillasPendientes(callback, onError) {
  const q = query(collection(db, 'planillas'), where('estado', '==', 'pendiente'));
  return onSnapshot(
    q,
    (snap) => callback(planillasDe(snap).sort((a, b) => (a.fecha < b.fecha ? -1 : 1))),
    (err) => {
      console.error('Error escuchando planillas pendientes:', err);
      if (onError) onError(err);
    }
  );
}

export function suscribirPlanillasRecibidas(callback, onError, limite = 20) {
  const q = query(collection(db, 'planillas'), where('estado', '==', 'recibido'));
  return onSnapshot(
    q,
    (snap) => callback(planillasDe(snap).sort((a, b) => (b.fecha > a.fecha ? 1 : -1)).slice(0, limite)),
    (err) => {
      console.error('Error escuchando planillas recibidas:', err);
      if (onError) onError(err);
    }
  );
}

export { hoyStr };
