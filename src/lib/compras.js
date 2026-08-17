import {
  doc,
  collection,
  writeBatch,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

// items: [{id, name, qty, costoUnitario, stockActual}]
// Solo Nelson usa esto (así lo permiten las reglas de Firestore): sube el stock
// y actualiza el costo de compra de cada referencia en el mismo paso.
export async function registrarCompra({ items, proveedor, origen, nota }) {
  if (!items || items.length === 0) throw new Error('No hay ninguna referencia en la compra.');

  const itemsConTotal = items.map((i) => ({
    id: i.id,
    name: i.name,
    qty: i.qty,
    costoUnitario: i.costoUnitario,
    total: i.qty * i.costoUnitario,
  }));
  const totalGeneral = itemsConTotal.reduce((s, i) => s + i.total, 0);

  const batch = writeBatch(db);
  items.forEach((i) => {
    batch.update(doc(db, 'inventario', i.id), {
      stock: (i.stockActual || 0) + i.qty,
      costoCompra: i.costoUnitario,
    });
  });
  const compraRef = doc(collection(db, 'compras'));
  batch.set(compraRef, {
    fecha: hoyStr(),
    hora: ahoraStr(),
    usuarioNombre: 'Nelson',
    proveedor: proveedor || null,
    nota: nota || null,
    origen,
    items: itemsConTotal,
    totalGeneral,
    creadoEn: serverTimestamp(),
  });
  await batch.commit();

  return { totalGeneral, num: compraRef.id };
}

export async function comprasDeHoy() {
  const q = query(collection(db, 'compras'), where('fecha', '==', hoyStr()));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.hora < b.hora ? -1 : 1));
}

export async function comprasRecientes(limite = 20) {
  const snap = await getDocs(collection(db, 'compras'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
    .slice(0, limite);
}

export { hoyStr, ahoraStr };
