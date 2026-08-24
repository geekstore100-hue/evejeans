import {
  doc,
  collection,
  writeBatch,
  increment,
  updateDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';
import { guardarSinBloquear } from './offlineWrite';

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

// Paso 1 — Nelson hace el pedido con el proveedor.
// Fija el costo de cada referencia de una vez (eso no depende de si ya llegó o no),
// pero todavía NO mueve el stock: el stock solo sube cuando alguien confirma que
// físicamente llegó y contó lo que decía la caja.
// items: [{id, name, cantidadPedida, costoUnitario}]
export async function crearPedidoCompra({ items, proveedor, origen, nota }) {
  if (!items || items.length === 0) throw new Error('No hay ninguna referencia en el pedido.');
  if (!proveedor || !proveedor.trim()) throw new Error('Falta el proveedor.');

  const batch = writeBatch(db);
  // El costo de compra se actualiza ya, aunque la mercancía no haya llegado —
  // es el precio que se acordó con el proveedor.
  items.forEach((i) => {
    batch.update(doc(db, 'inventario', i.id), { costoCompra: i.costoUnitario });
  });

  const itemsConTotal = items.map((i) => ({
    id: i.id,
    name: i.name,
    cantidadPedida: i.cantidadPedida,
    cantidadRecibida: null,
    costoUnitario: i.costoUnitario,
    total: i.cantidadPedida * i.costoUnitario,
  }));
  const totalGeneral = itemsConTotal.reduce((s, i) => s + i.total, 0);

  const compraRef = doc(collection(db, 'compras'));
  batch.set(compraRef, {
    fecha: hoyStr(),
    hora: ahoraStr(),
    usuarioNombre: 'Nelson',
    proveedor: proveedor.trim(),
    nota: nota || null,
    origen,
    items: itemsConTotal,
    totalGeneral,
    estado: 'pendiente', // pendiente | confirmada
    confirmadoPor: null,
    confirmadoFecha: null,
    creadoEn: serverTimestamp(),
  });

  await guardarSinBloquear(batch.commit(), { contexto: 'pedido de compra' });
  return { id: compraRef.id, totalGeneral };
}

// Paso 2 — quien recibe la mercancía (vendedora o Nelson) cuenta lo que llegó de verdad
// y lo confirma. Ahí sí sube el stock, con la cantidad REAL contada (no la pedida).
// itemsConfirmados: [{id, cantidadRecibida, stockActual}]  (stockActual viene del inventario en vivo)
export async function confirmarRecepcion(compraId, compra, itemsConfirmados, usuario) {
  const ref = doc(db, 'compras', compraId);
  const mapaConfirmado = {};
  itemsConfirmados.forEach((i) => (mapaConfirmado[i.id] = i));

  const itemsFinal = compra.items.map((i) => ({
    ...i,
    cantidadRecibida: mapaConfirmado[i.id]?.cantidadRecibida ?? 0,
  }));

  // increment() en vez de sumar sobre stockActual (que puede quedar desactualizado
  // si hay algo pendiente de subir sin internet) — así el stock siempre queda
  // correcto sin importar cuándo se sincronice cada cosa.
  const batch = writeBatch(db);
  itemsFinal.forEach((i) => {
    const info = mapaConfirmado[i.id];
    if (info && info.cantidadRecibida > 0) {
      batch.update(doc(db, 'inventario', i.id), { stock: increment(info.cantidadRecibida) });
    }
  });

  batch.update(ref, {
    items: itemsFinal,
    estado: 'confirmada',
    confirmadoPor: usuario.nombreDefault,
    confirmadoFecha: hoyStr(),
  });

  await guardarSinBloquear(batch.commit(), { contexto: `recepción compra ${compraId}` });

  const conDiferencia = itemsFinal.filter((i) => i.cantidadRecibida !== i.cantidadPedida);
  return { conDiferencia };
}

export async function pedidosPendientes() {
  const q = query(collection(db, 'compras'), where('estado', '==', 'pendiente'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.hora < b.hora ? -1 : 1));
}

// Solo Nelson: cuando de verdad llegó menos (o más) de lo acordado con el proveedor,
// se corrige el pedido para que la vendedora pueda confirmarlo contra el número real.
export async function ajustarPedido(compraId, itemsAjustados) {
  const nuevosItems = itemsAjustados.map((i) => ({
    id: i.id,
    name: i.name,
    cantidadPedida: i.cantidadPedida,
    cantidadRecibida: null,
    costoUnitario: i.costoUnitario,
    total: i.cantidadPedida * i.costoUnitario,
  }));
  const totalGeneral = nuevosItems.reduce((s, i) => s + i.total, 0);
  await updateDoc(doc(db, 'compras', compraId), { items: nuevosItems, totalGeneral });
}

export async function comprasRecientes(limite = 25) {
  const snap = await getDocs(collection(db, 'compras'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
    .slice(0, limite);
}

export { hoyStr, ahoraStr };
