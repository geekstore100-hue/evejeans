import {
  doc,
  collection,
  writeBatch,
  increment,
  updateDoc,
  deleteDoc,
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

// Identifica cada LÍNEA del pedido (no la referencia) — hace falta porque una
// misma referencia "por precio" (ej. "$60.000") puede aparecer más de una vez
// en el mismo pedido, con cantidades y notas distintas (ej. 10 de chaquetas y
// 20 de pantalones, ambas a $60.000). El "id" sigue siendo el de la referencia
// en inventario (para el costo/stock); "lineaId" es único por línea.
function nuevaLineaId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
export { nuevaLineaId };

// Devuelve el identificador de línea de un item, ya sea de un pedido nuevo
// (siempre trae lineaId) o de uno viejo creado antes de que existiera este
// campo (ahí se usa el "id" de la referencia, como se hacía antes).
export function claveLinea(item) {
  return item.lineaId || item.id;
}

// Paso 1 — Nelson (o Fausto, encargado de compras) hace el pedido con el proveedor.
// Fija el costo de cada referencia de una vez (eso no depende de si ya llegó o no),
// pero todavía NO mueve el stock: el stock solo sube cuando alguien confirma que
// físicamente llegó y contó lo que decía la caja.
// items: [{id, lineaId, name, cantidadPedida, costoUnitario, nota}]
// proveedor es opcional (la pantalla simple de Fausto ya no lo pregunta) —
// cuando no se sabe o no se preguntó, queda como null.
export async function crearPedidoCompra({ items, proveedor, origen, nota, usuario }) {
  if (!items || items.length === 0) throw new Error('No hay ninguna referencia en el pedido.');

  const batch = writeBatch(db);
  // El costo de compra se actualiza ya, aunque la mercancía no haya llegado —
  // es el precio que se acordó con el proveedor. Si la misma referencia
  // aparece en más de una línea (ver arriba), Firestore no permite escribir
  // el mismo documento dos veces en un solo batch — por eso se agrupa por id
  // primero, y solo se escribe una vez cada uno (con el último costo escrito).
  const costoPorId = {};
  // También se recuerda la última nota escrita para cada referencia — así la
  // próxima vez que se compre lo mismo, el campo de nota ya viene lleno con
  // ese mismo texto en vez de en blanco, y no toca volver a escribirlo desde
  // cero (que es justo lo que generaba variaciones tipo "Chaquetas jean" vs
  // "Chaqueta de jean": el mismo item con la nota escrita un poco distinto
  // cada vez).
  const notaPorId = {};
  items.forEach((i) => {
    costoPorId[i.id] = i.costoUnitario;
    if (i.nota && i.nota.trim()) notaPorId[i.id] = i.nota.trim();
  });
  Object.entries(costoPorId).forEach(([id, costoUnitario]) => {
    const cambios = { costoCompra: costoUnitario };
    if (notaPorId[id]) cambios.ultimaNota = notaPorId[id];
    batch.update(doc(db, 'inventario', id), cambios);
  });

  const itemsConTotal = items.map((i) => ({
    id: i.id,
    lineaId: i.lineaId || nuevaLineaId(),
    name: i.name,
    cantidadPedida: i.cantidadPedida,
    cantidadRecibida: null,
    costoUnitario: i.costoUnitario,
    total: i.cantidadPedida * i.costoUnitario,
    // Nota por referencia (la usa la pantalla simple de Fausto) — Firestore no
    // acepta "undefined", por eso el "|| null" en vez de dejarla tal cual.
    nota: i.nota || null,
  }));
  const totalGeneral = itemsConTotal.reduce((s, i) => s + i.total, 0);

  const compraRef = doc(collection(db, 'compras'));
  batch.set(compraRef, {
    fecha: hoyStr(),
    hora: ahoraStr(),
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    proveedor: proveedor && proveedor.trim() ? proveedor.trim() : null,
    nota: nota || null,
    // "|| null": la pantalla de Fausto ya no pregunta el origen del dinero, así
    // que este campo puede llegar vacío — Firestore no acepta "undefined".
    origen: origen || null,
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
// itemsConfirmados: [{lineaId, cantidadRecibida, stockActual}]  (stockActual viene del inventario en vivo)
export async function confirmarRecepcion(compraId, compra, itemsConfirmados, usuario) {
  const ref = doc(db, 'compras', compraId);
  const mapaConfirmado = {};
  itemsConfirmados.forEach((i) => (mapaConfirmado[i.lineaId] = i));

  const itemsFinal = compra.items.map((i) => ({
    ...i,
    cantidadRecibida: mapaConfirmado[claveLinea(i)]?.cantidadRecibida ?? 0,
  }));

  // Se suma por REFERENCIA (id), no por línea — porque puede haber más de una
  // línea de la misma referencia (ver crearPedidoCompra), y Firestore no deja
  // escribir el mismo documento dos veces en un solo batch.
  const recibidoPorId = {};
  itemsFinal.forEach((i) => {
    if (i.cantidadRecibida > 0) {
      recibidoPorId[i.id] = (recibidoPorId[i.id] || 0) + i.cantidadRecibida;
    }
  });

  // increment() en vez de sumar sobre stockActual (que puede quedar desactualizado
  // si hay algo pendiente de subir sin internet) — así el stock siempre queda
  // correcto sin importar cuándo se sincronice cada cosa.
  const batch = writeBatch(db);
  Object.entries(recibidoPorId).forEach(([id, cantidad]) => {
    batch.update(doc(db, 'inventario', id), { stock: increment(cantidad) });
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

// Solo Nelson (o Fausto, sus propios pedidos): cuando de verdad llegó menos (o
// más) de lo acordado con el proveedor, se corrige el pedido para que se
// pueda confirmar contra el número real. Conserva lineaId y nota de cada
// línea — itemsAjustados debe traer todas las líneas del pedido (incluso las
// que no cambiaron), cada una con al menos {id, lineaId, name, cantidadPedida,
// costoUnitario, nota}.
export async function ajustarPedido(compraId, itemsAjustados) {
  const nuevosItems = itemsAjustados.map((i) => ({
    id: i.id,
    lineaId: i.lineaId || nuevaLineaId(),
    name: i.name,
    cantidadPedida: i.cantidadPedida,
    cantidadRecibida: null,
    costoUnitario: i.costoUnitario,
    total: i.cantidadPedida * i.costoUnitario,
    nota: i.nota || null,
  }));
  const totalGeneral = nuevosItems.reduce((s, i) => s + i.total, 0);
  await updateDoc(doc(db, 'compras', compraId), { items: nuevosItems, totalGeneral });
}

// Elimina un pedido que sigue PENDIENTE — nunca llegó a subir el stock de
// nada (eso solo pasa al confirmar), así que no hay nada que revertir en el
// inventario. Sirve para cuando se registró por error, o para empezar de
// cero en vez de corregirlo si quedó muy mal armado. Nelson puede borrar
// cualquier pedido pendiente; Fausto solo los suyos (lo exigen las reglas de
// Firestore, no solo esta función).
export async function eliminarPedido(compraId) {
  await deleteDoc(doc(db, 'compras', compraId));
}

export async function comprasRecientes(limite = 25) {
  const snap = await getDocs(collection(db, 'compras'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
    .slice(0, limite);
}

export { hoyStr, ahoraStr };
