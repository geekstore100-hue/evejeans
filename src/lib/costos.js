// Costo de compra de cada prenda vendida.
//
// Cada venta guarda ("congela") el costo que tenía la referencia en el
// inventario en ese momento. Pero las primeras ventas del sistema se hicieron
// cuando el inventario todavía tenía el costo en $0 (aún no se había
// registrado ninguna factura de esa referencia), así que esas ventas quedaron
// con costo $0 — y eso hacía ver la ganancia más alta de lo que fue, y
// promedios de costo absurdos (por ejemplo "Sef a $46.000" mezclando ventas de
// $0 con ventas de $71.000).
//
// Regla: si la venta tiene costo guardado mayor que 0, ese es. Si no, se usa
// el costo de la factura de compra de esa referencia más cercana a la fecha de
// la venta (la última antes; si no hay, la primera después), y si tampoco hay
// facturas, el costo actual del inventario.

// compras: documentos de "compras" ({ fecha, items: [{ id, costoUnitario }] }).
export function armarHistorialCostos(compras) {
  const h = {};
  (compras || []).forEach((c) => {
    (c.items || []).forEach((i) => {
      if (!i.id || !(i.costoUnitario > 0)) return;
      (h[i.id] = h[i.id] || []).push({ fecha: c.fecha, costo: i.costoUnitario });
    });
  });
  Object.values(h).forEach((l) => l.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)));
  return h;
}

// Devuelve { costo, estimado, sinCosto }.
export function costoDe(item, fecha, historial, costoActualPorId) {
  if (item.costoCompra > 0) return { costo: item.costoCompra, estimado: false, sinCosto: false };
  const l = historial?.[item.id];
  if (l && l.length) {
    let elegido = l[0];
    l.forEach((x) => {
      if (x.fecha <= fecha) elegido = x;
    });
    return { costo: elegido.costo, estimado: true, sinCosto: false };
  }
  const actual = costoActualPorId?.[item.id] || 0;
  if (actual > 0) return { costo: actual, estimado: true, sinCosto: false };
  return { costo: 0, estimado: true, sinCosto: true };
}
