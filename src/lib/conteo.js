import { collection, doc, setDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { esFestivo, semanaDe } from './festivos';

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

// ¿Le toca conteo a Blanca (turno entre semana) hoy? Solo el primer día hábil
// (lunes, o el siguiente si el lunes es festivo) de cada semana, una sola vez.
export async function tocaConteo(usuario, config) {
  if (!config || config.conteoActivado === false) return false;
  if (!usuario || usuario.id !== 'blanca') return false;
  const hoy = hoyStr();
  if (esFestivo(hoy)) return false;
  const dow = new Date(hoy + 'T00:00:00').getDay();
  if (dow === 0 || dow === 6) return false;

  const semana = semanaDe(hoy);
  const q = query(collection(db, 'conteos'), where('semana', '==', semana));
  const snap = await getDocs(q);
  return snap.empty;
}

// PRNG sencillo y determinista, sembrado con un texto — así, para que "el
// azar" salga igual toda la semana (que le pida siempre las mismas 2
// referencias mientras no las cuente, sin importar cuántas veces entre y
// salga o le dé "Ahora no"), sin tener que guardar nada aparte en la base de
// datos: alcanza con sembrarlo con la semana.
function semillaNumerica(texto) {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function rng() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// Elige "cantidad" referencias al azar, pero siempre las MISMAS mientras la
// semilla (la semana) no cambie. Ordena por id antes de mezclar para que el
// resultado no dependa del orden en que llegaron los documentos de Firestore.
export function elegirMuestraSemana(disponibles, cantidad, semilla) {
  const rng = semillaNumerica(semilla);
  const copia = [...disponibles].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, cantidad);
}

export async function registrarConteo({ usuario, referencias }) {
  const semana = semanaDe(hoyStr());
  const ref = doc(collection(db, 'conteos'));
  await setDoc(ref, {
    semana,
    fecha: hoyStr(),
    hora: ahoraStr(),
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    referencias,
    creadoEn: serverTimestamp(),
  });
}

export async function conteosRecientes(limite = 10) {
  const snap = await getDocs(collection(db, 'conteos'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
    .slice(0, limite);
}
