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
