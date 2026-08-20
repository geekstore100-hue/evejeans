import * as XLSX from 'xlsx';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

async function todasLasVentas() {
  const snap = await getDocs(
    query(collection(db, 'ventas'), where('tipo', '==', 'venta'), where('anulada', '==', false))
  );
  return snap.docs.map((d) => d.data());
}
async function todosLosGastos() {
  const snap = await getDocs(query(collection(db, 'gastos'), where('anulado', '==', false)));
  return snap.docs.map((d) => d.data());
}
async function todasLasCompras() {
  const snap = await getDocs(collection(db, 'compras'));
  return snap.docs.map((d) => d.data());
}
async function inventarioActual() {
  const snap = await getDocs(collection(db, 'inventario'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Genera y descarga un Excel con el mismo espíritu del que ya usabas: día a día,
// ganancia mensual, e inventario actual — pero alimentado en vivo por Firebase,
// no llenado a mano. Nace de lo que ya está registrado, nunca hay que transcribir nada.
export async function generarExcel(config) {
  const [ventas, gastos, compras, inventario] = await Promise.all([
    todasLasVentas(),
    todosLosGastos(),
    todasLasCompras(),
    inventarioActual(),
  ]);

  const costoPorId = {};
  inventario.forEach((it) => (costoPorId[it.id] = it.costoCompra || 0));

  // ---------- Día a día ----------
  // La comisión ya no se estima con una fórmula: ahora es un gasto más que registran
  // ellas mismas (categoría "Comisión"), así que sale de "gastos" como cualquier otro.
  const porDia = {};
  function diaDe(fecha) {
    porDia[fecha] = porDia[fecha] || { ingresos: 0, descuentos: 0, prendas: 0, gastos: 0, comision: 0, compras: 0 };
    return porDia[fecha];
  }
  ventas.forEach((v) => {
    const d = diaDe(v.fecha);
    d.ingresos += v.total;
    d.descuentos += v.descuento || 0;
    (v.items || []).forEach((i) => {
      d.prendas += i.qty;
    });
  });
  gastos.forEach((g) => {
    const d = diaDe(g.fecha);
    if (g.categoria === 'Comisión') d.comision += g.monto;
    else d.gastos += g.monto;
  });
  compras.forEach((c) => {
    diaDe(c.fecha).compras += c.totalGeneral;
  });

  const filasDias = Object.entries(porDia)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([fecha, d]) => ({
      Fecha: fecha,
      Ingresos: d.ingresos,
      Descuentos: d.descuentos,
      'Prendas vendidas': d.prendas,
      Gastos: d.gastos,
      Comisión: d.comision,
      Compras: d.compras,
    }));

  // ---------- Ganancia mensual ----------
  const porMes = {};
  function mesDe(mes) {
    porMes[mes] = porMes[mes] || { ingresos: 0, costo: 0, gastos: 0, comision: 0 };
    return porMes[mes];
  }
  ventas.forEach((v) => {
    const m = mesDe(v.fecha.slice(0, 7));
    m.ingresos += v.total;
    (v.items || []).forEach((i) => {
      const costoUsado = i.costoCompra !== undefined ? i.costoCompra : costoPorId[i.id] || 0;
      m.costo += costoUsado * i.qty;
    });
  });
  gastos.forEach((g) => {
    if (g.categoria === 'Socios') return; // reparto, no gasto del negocio
    const m = mesDe(g.fecha.slice(0, 7));
    if (g.categoria === 'Comisión') m.comision += g.monto;
    else m.gastos += g.monto;
  });

  const filasMeses = Object.entries(porMes)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([mes, d]) => {
      const gananciaBruta = d.ingresos - d.costo;
      const gananciaNeta = gananciaBruta - d.gastos - d.comision;
      return {
        Mes: mes,
        Ingresos: d.ingresos,
        'Costo mercancía vendida': d.costo,
        'Ganancia Bruta': gananciaBruta,
        'Gastos administrativos': d.gastos,
        Comisión: d.comision,
        'Ganancia Neta': gananciaNeta,
      };
    });

  // ---------- Inventario actual ----------
  const filasInventario = inventario
    .filter((it) => !it.oculto)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((it) => ({
      Referencia: it.name,
      'Precio de venta': it.price,
      'Costo de compra': it.costoCompra || 0,
      Stock: it.stock || 0,
      'Valor a precio de venta': (it.stock || 0) * (it.price || 0),
      'Valor a costo': (it.stock || 0) * (it.costoCompra || 0),
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasDias), 'Dia a dia');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasMeses), 'Ganancia mensual');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasInventario), 'Inventario');

  const fechaArchivo = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `EveJeans_${fechaArchivo}.xlsx`);
}
