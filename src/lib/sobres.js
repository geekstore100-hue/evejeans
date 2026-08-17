import { collection, doc, updateDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export async function listarPendientes() {
  const q = query(collection(db, 'cierres'), where('entregado', '==', false));
  const snap = await getDocs(q);
  const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return lista.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

export async function listarEntregados(limite = 20) {
  const q = query(collection(db, 'cierres'), where('entregado', '==', true));
  const snap = await getDocs(q);
  const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return lista.sort((a, b) => (a.fecha > b.fecha ? -1 : 1)).slice(0, limite);
}

// Solo Nelson puede hacer esto (lo hace cumplir la regla de Firestore, no esta función).
export async function entregarSobre(cierreId, { recibido, entregadoPor, nota }, cierreOriginal) {
  const difCustodia = recibido - cierreOriginal.contado;
  await updateDoc(doc(db, 'cierres', cierreId), {
    entregado: true,
    recibido,
    difCustodia,
    entregadoPor,
    entregadoFecha: hoyStr(),
    notaEntrega: nota || null,
  });
  return { difCustodia };
}
