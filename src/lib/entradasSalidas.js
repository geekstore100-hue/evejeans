import {
  doc,
  collection,
  writeBatch,
  increment,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { guardarSinBloquear } from './offlineWrite';

// Categorías fijas para que el motivo quede consistente (y se pueda filtrar/leer
// de un vistazo), con un campo de detalle aparte para lo que haga falta aclarar.
export const SALIDA_CATEGORIAS = [
  'Defecto o daño',
  'Perdido o robado',
  'Devolución a proveedor',
  'Uso interno o regalo',
  'Corrección de conteo',
  'Otro',
];
export const ENTRADA_CATEGORIAS = ['Corrección de conteo', 'Encontrado', 'Otro'];

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

// Igual que ventas/cambios/gastos: sin runTransaction, para que funcione sin
// internet. El stock se mueve con increment() (nunca con un número absoluto), así
// que da igual en qué orden terminen subiendo los movimientos pendientes — el
// resultado final siempre es matemáticamente correcto.
export async function registrarMovimiento({ usuario, tipo, itemId, itemNombre, cantidad, categoria, detalle }) {
  if (tipo !== 'entrada' && tipo !== 'salida') throw new Error('Tipo de movimiento inválido.');
  if (!itemId) throw new Error('Falta elegir la referencia.');
  if (!cantidad || cantidad <= 0) throw new Error('La cantidad debe ser mayor que cero.');
  if (!categoria) throw new Error('Falta elegir el motivo.');

  const itemRef = doc(db, 'inventario', itemId);
  if (tipo === 'salida') {
    // Revisión "amistosa" con el último dato que tiene el computador — si está
    // desactualizado por estar offline, la regla de Firestore (stock >= 0) es la
    // que de verdad protege que nunca quede en negativo.
    const itemSnap = await getDoc(itemRef);
    const stockActual = itemSnap.exists() ? itemSnap.data().stock || 0 : 0;
    if (stockActual < cantidad) {
      throw new Error(`No hay suficiente stock de "${itemNombre}" (quedan ${stockActual}).`);
    }
  }

  const contadorRef = doc(db, 'contadores', 'entradasSalidas');
  const movRef = doc(collection(db, 'entradasSalidas'));
  const contadorSnap = await getDoc(contadorRef);
  const num = (contadorSnap.exists() ? contadorSnap.data().ultimo || 0 : 0) + 1;

  const fecha = hoyStr();
  const hora = ahoraStr();

  const batch = writeBatch(db);
  if (contadorSnap.exists()) batch.update(contadorRef, { ultimo: increment(1) });
  else batch.set(contadorRef, { ultimo: num });
  batch.update(itemRef, { stock: increment(tipo === 'entrada' ? cantidad : -cantidad) });
  batch.set(movRef, {
    num,
    fecha,
    hora,
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    itemId,
    itemNombre,
    tipo,
    cantidad,
    categoria,
    detalle: detalle || null,
    anulada: false,
    creadoEn: serverTimestamp(),
  });
  await guardarSinBloquear(batch.commit(), { contexto: `${tipo} de mercancía #${num}` });

  return { num, fecha, hora };
}

// Solo Nelson (las reglas de Firestore ya lo exigen). Revierte el movimiento de
// stock que hizo el registro original y lo marca como anulado — nunca se borra,
// queda el registro. Usa una transacción (en vez del patrón "sin bloquear" que usan
// las ventas del día a día) porque anular es una acción de administración, no algo
// urgente que deba funcionar sin internet en plena venta.
export async function anularMovimiento(m, motivo, usuario) {
  const ref = doc(db, 'entradasSalidas', m.id);
  const itemRef = doc(db, 'inventario', m.itemId);
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    const stockActual = itemSnap.data()?.stock || 0;
    const nuevo =
      m.tipo === 'entrada' ? Math.max(0, stockActual - m.cantidad) : stockActual + m.cantidad;
    tx.update(itemRef, { stock: nuevo });
    tx.update(ref, {
      anulada: true,
      motivoAnulacion: motivo,
      anuladaPor: usuario.nombreDefault,
    });
  });
}

export async function movimientosPorFecha(fecha) {
  const q = query(collection(db, 'entradasSalidas'), where('fecha', '==', fecha));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.hora < b.hora ? -1 : 1));
}

export { hoyStr, ahoraStr };
