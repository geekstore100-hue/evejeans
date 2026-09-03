import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  documentId,
  getDocs,
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

const DIAS_HACIA_ATRAS = 90; // suficiente para cualquier atraso normal, sin revisar meses y meses cada vez

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
  const q = query(
    collection(db, 'planillas'),
    where(documentId(), '>=', desdeStr),
    where(documentId(), '<=', ayerStr)
  );
  const snap = await getDocs(q);
  const yaExisten = new Set(snap.docs.map((d) => d.id));

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
        await setDoc(doc(db, 'planillas', fecha), {
          fecha,
          efectivoAEntregar,
          estado: 'pendiente', // pendiente | recibido
          // "Habilitada": la vendedora avisó que ya tiene ese efectivo listo
          // para entregar (ver habilitarTodoPendiente). No es lo mismo que
          // "recibido" — solo dice que está lista para que la recojan.
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
        });
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
    batch.update(doc(db, 'planillas', p.fecha), {
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
  const pendientes = await planillasPendientes();
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
  await updateDoc(doc(db, 'planillas', planilla.fecha), {
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
    await setDoc(ref, {
      fecha,
      efectivoAEntregar,
      estado: 'pendiente',
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
    });
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

export async function calcularEfectivoHoy() {
  const resumen = await resumenDia(hoyStr());
  return resumen.efectivoAEntregar || 0;
}

export { hoyStr };
