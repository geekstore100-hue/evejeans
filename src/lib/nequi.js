import { collection, doc, query, where, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// Control de qué número de Nequi ha estado activo y desde cuándo — Nelson
// cambia de número cada cierto tiempo, y quiere saber cuánta plata ha entrado
// a cada uno. Cada documento es un PERÍODO: {numero, desde, hasta}. El activo
// (el de ahora mismo) tiene hasta = null. Al agregar uno nuevo, se cierra
// automáticamente el anterior (su "hasta" queda en el día antes de que
// empiece el nuevo), para que los períodos nunca se crucen ni dupliquen plata.

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function diaAntes(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export async function numerosNequi() {
  const snap = await getDocs(collection(db, 'nequiNumeros'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.desde < b.desde ? 1 : -1));
}

export async function numeroActivo() {
  const q = query(collection(db, 'nequiNumeros'), where('hasta', '==', null));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.desde < b.desde ? 1 : -1));
  return docs[0];
}

// desde: opcional — por defecto hoy. Se puede escribir una fecha anterior
// (por ejemplo, al configurar esto por primera vez con un número que ya
// llevaba tiempo recibiendo, para que ese historial también cuente).
export async function agregarNumeroNequi(numero, usuario, desde) {
  const limpio = (numero || '').trim();
  if (!limpio) throw new Error('Escribe el número de Nequi.');
  const fechaDesde = desde || hoyStr();

  const actual = await numeroActivo();
  if (actual && actual.numero === limpio) {
    throw new Error('Ese ya es el número activo.');
  }

  const batch = writeBatch(db);
  if (actual) {
    // Si por algún motivo el nuevo "desde" no queda después del inicio del
    // anterior, se cierra ahí mismo (rango de un solo día) en vez de generar
    // una fecha inválida.
    const cierre = diaAntes(fechaDesde);
    batch.update(doc(db, 'nequiNumeros', actual.id), {
      hasta: cierre < actual.desde ? actual.desde : cierre,
    });
  }

  const ref = doc(collection(db, 'nequiNumeros'));
  batch.set(ref, {
    numero: limpio,
    desde: fechaDesde,
    hasta: null,
    creadoPorId: usuario.id,
    creadoPorNombre: usuario.nombreDefault,
    creadoEn: serverTimestamp(),
  });
  await batch.commit();
}

// Mismo cálculo que usa el Cierre del día para "Nequi" (ventas + diferencias
// de cambios pagadas por Nequi), pero sumado sobre un rango de fechas en vez
// de un solo día.
async function totalNequiEnRango(desde, hasta) {
  const q = query(
    collection(db, 'ventas'),
    where('fecha', '>=', desde),
    where('fecha', '<=', hasta),
    where('anulada', '==', false)
  );
  const snap = await getDocs(q);
  let total = 0;
  snap.docs.forEach((d) => {
    const v = d.data();
    if (v.tipo === 'venta') {
      total += (v.pagos || {}).Nequi || 0;
    } else if (v.tipo === 'cambio') {
      if (v.diferencia > 0 && v.pago === 'Nequi') total += v.diferencia;
    }
  });
  return total;
}

export async function resumenNumerosNequi() {
  const numeros = await numerosNequi(); // más reciente primero
  const hoy = hoyStr();
  const resultados = [];
  for (const n of numeros) {
    const hasta = n.hasta || hoy;
    const total = await totalNequiEnRango(n.desde, hasta);
    resultados.push({ ...n, total, activo: n.hasta === null });
  }
  return resultados;
}

export { hoyStr };
