import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function inicioDeSemana() {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function inicioDeMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Calcula Ingresos, Costo de mercancía vendida, Ganancia Bruta, Gastos (sin socios,
// con la comisión automática incluida), Ganancia Neta, y los retiros de socios aparte
// (no restan de la Ganancia Neta, solo se muestran informativamente).
export async function calcularGanancia(desde, hasta, config) {
  const qVentas = query(
    collection(db, 'ventas'),
    where('fecha', '>=', desde),
    where('fecha', '<=', hasta),
    where('tipo', '==', 'venta'),
    where('anulada', '==', false)
  );
  const snapVentas = await getDocs(qVentas);

  const snapInv = await getDocs(collection(db, 'inventario'));
  const costoPorId = {};
  const nombrePorId = {};
  snapInv.docs.forEach((d) => {
    costoPorId[d.id] = d.data().costoCompra || 0;
    nombrePorId[d.id] = d.data().name;
  });

  let ingresos = 0;
  let costoMercancia = 0;
  let unidadesVendidas = 0;
  let descuentos = 0;

  snapVentas.docs.forEach((d) => {
    const v = d.data();
    ingresos += v.total;
    descuentos += v.descuento || 0;
    (v.items || []).forEach((i) => {
      unidadesVendidas += i.qty;
      // Preferimos el costo que quedó guardado en la venta misma (el que tenía ese día).
      // Si es una venta vieja de antes de este arreglo, no tiene ese dato — ahí, como
      // respaldo, se usa el costo actual (puede no ser exacto para esas ventas puntuales).
      const costoUsado = i.costoCompra !== undefined ? i.costoCompra : (costoPorId[i.id] || 0);
      costoMercancia += costoUsado * i.qty;
    });
  });

  const gananciaBruta = ingresos - costoMercancia;

  // La comisión ya no se calcula aparte: ahora las vendedoras la registran ellas mismas
  // como un gasto más (categoría "Comisión"), así que ya viene incluida aquí abajo.
  const qGastos = query(
    collection(db, 'gastos'),
    where('fecha', '>=', desde),
    where('fecha', '<=', hasta),
    where('anulado', '==', false)
  );
  const snapGastos = await getDocs(qGastos);
  let gastosAdmin = 0;
  let retirosSocios = 0;
  const gastosPorCategoria = {};
  snapGastos.docs.forEach((d) => {
    const g = d.data();
    if (g.categoria === 'Socios') {
      retirosSocios += g.monto;
    } else {
      gastosAdmin += g.monto;
      gastosPorCategoria[g.categoria] = (gastosPorCategoria[g.categoria] || 0) + g.monto;
    }
  });

  const gananciaNeta = gananciaBruta - gastosAdmin;

  return {
    ingresos,
    descuentos,
    unidadesVendidas,
    costoMercancia,
    gananciaBruta,
    gastosAdmin,
    gastosPorCategoria,
    gananciaNeta,
    retirosSocios,
  };
}

// Valor de mercancía en vivo: no depende de ningún período, es una foto de ahora mismo.
export async function valorDeMercancia() {
  const snap = await getDocs(collection(db, 'inventario'));
  let valorVenta = 0;
  let valorCosto = 0;
  let totalPrendas = 0;
  const porItem = [];
  snap.docs.forEach((d) => {
    const it = d.data();
    if (it.oculto) return;
    const stock = it.stock || 0;
    valorVenta += stock * (it.price || 0);
    valorCosto += stock * (it.costoCompra || 0);
    totalPrendas += stock;
    if (stock > 0) porItem.push({ name: it.name, stock, valorVenta: stock * (it.price || 0) });
  });
  porItem.sort((a, b) => b.valorVenta - a.valorVenta);
  return { valorVenta, valorCosto, totalPrendas, porItem };
}

export { hoyStr };
