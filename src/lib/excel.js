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

// Sin filtrar (a diferencia de las de arriba, que son solo para el Excel de
// ganancia): para el historial por referencia hace falta ver TODO lo que
// pasó, incluidas las ventas/cambios/movimientos anulados — se marcan como
// tal, pero no se esconden, igual que en el resto de la app.
async function todasLasVentasYCambios() {
  const snap = await getDocs(collection(db, 'ventas'));
  return snap.docs.map((d) => d.data());
}
async function todosLosMovimientosManuales() {
  const snap = await getDocs(collection(db, 'entradasSalidas'));
  return snap.docs.map((d) => d.data());
}
async function todosLosAjustesInventario() {
  const snap = await getDocs(collection(db, 'ajustesInventario'));
  return snap.docs.map((d) => d.data());
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

const COLUMNAS_HISTORIAL = ['Fecha', 'Hora', 'Tipo', 'Cantidad', 'Detalle', 'Usuario', 'Anulado'];

// "10:05 a. m." / "01:40 p. m." -> minutos desde medianoche, solo para poder
// ORDENAR cronológicamente (el texto se sigue mostrando tal cual se guardó).
function minutosDeHora(horaStr) {
  const m = (horaStr || '').match(/(\d{1,2}):(\d{2})\s*([ap])/i);
  if (!m) return -1;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return h * 60 + parseInt(m[2], 10);
}

// Nombre de hoja de Excel válido: máx. 31 caracteres, sin \ / ? * [ ] : , y
// sin repetirse (si dos referencias quedan igual después de recortar, se le
// agrega un "(2)", "(3)"... al final).
function nombreHojaValido(nombre, usados) {
  let limpio = (nombre || 'Referencia').replace(/[\\/?*[\]:]/g, '-').trim().slice(0, 31) || 'Referencia';
  let final = limpio;
  let n = 2;
  while (usados.has(final)) {
    const sufijo = ` (${n})`;
    final = limpio.slice(0, 31 - sufijo.length) + sufijo;
    n++;
  }
  usados.add(final);
  return final;
}

function anuladoTexto(anulada, motivo) {
  return anulada ? `Sí — ${motivo || 'sin motivo registrado'}` : 'No';
}

// Genera y descarga un Excel con UNA PESTAÑA POR REFERENCIA, con todo su
// historial de movimientos: ventas y cambios, compras recibidas, entradas y
// salidas manuales, y ajustes de inventario (precio, costo o stock). Se
// incluye todo, incluso lo anulado (marcado como tal) — nada se esconde,
// igual que en el resto de la app.
export async function generarExcelHistorialItems() {
  const [ventasYCambios, compras, movimientos, ajustes, inventario] = await Promise.all([
    todasLasVentasYCambios(),
    todasLasCompras(),
    todosLosMovimientosManuales(),
    todosLosAjustesInventario(),
    inventarioActual(),
  ]);

  // {itemId: [fila, fila, ...]}
  const filasPorId = {};
  function filasDe(id) {
    filasPorId[id] = filasPorId[id] || [];
    return filasPorId[id];
  }

  ventasYCambios.forEach((v) => {
    if (v.tipo === 'venta') {
      (v.items || []).forEach((i) => {
        filasDe(i.id).push({
          Fecha: v.fecha,
          Hora: v.hora,
          Tipo: 'Venta',
          Cantidad: -i.qty,
          Detalle: `Venta N.º ${v.num}`,
          Usuario: v.usuarioNombre,
          Anulado: anuladoTexto(v.anulada, v.motivoAnulacion),
        });
      });
    } else if (v.tipo === 'cambio') {
      (v.devuelve || []).forEach((i) => {
        filasDe(i.id).push({
          Fecha: v.fecha,
          Hora: v.hora,
          Tipo: 'Cambio (entrada)',
          Cantidad: i.qty,
          Detalle: `Cambio N.º ${v.num} — el cliente la devuelve`,
          Usuario: v.usuarioNombre,
          Anulado: anuladoTexto(v.anulada, v.motivoAnulacion),
        });
      });
      (v.lleva || []).forEach((i) => {
        filasDe(i.id).push({
          Fecha: v.fecha,
          Hora: v.hora,
          Tipo: 'Cambio (salida)',
          Cantidad: -i.qty,
          Detalle: `Cambio N.º ${v.num} — el cliente se la lleva`,
          Usuario: v.usuarioNombre,
          Anulado: anuladoTexto(v.anulada, v.motivoAnulacion),
        });
      });
    }
  });

  // Solo lo YA CONFIRMADO movió stock de verdad (lo pendiente todavía no).
  compras
    .filter((c) => c.estado === 'confirmada')
    .forEach((c) => {
      (c.items || []).forEach((i) => {
        if (!i.cantidadRecibida) return;
        filasDe(i.id).push({
          Fecha: c.confirmadoFecha || c.fecha,
          Hora: '',
          Tipo: 'Compra recibida',
          Cantidad: i.cantidadRecibida,
          Detalle:
            `Pedido del ${c.fecha}${c.proveedor ? ' a ' + c.proveedor : ''}` +
            (i.nota ? ` (${i.nota})` : '') +
            (i.cantidadRecibida !== i.cantidadPedida ? ` — pedidas ${i.cantidadPedida}` : ''),
          Usuario: c.confirmadoPor || c.usuarioNombre,
          Anulado: 'No',
        });
      });
    });

  movimientos.forEach((m) => {
    filasDe(m.itemId).push({
      Fecha: m.fecha,
      Hora: m.hora,
      Tipo: m.tipo === 'entrada' ? 'Entrada manual' : 'Salida manual',
      Cantidad: m.tipo === 'entrada' ? m.cantidad : -m.cantidad,
      Detalle: `${m.categoria}${m.detalle ? ' · ' + m.detalle : ''}`,
      Usuario: m.usuarioNombre,
      Anulado: anuladoTexto(m.anulada, m.motivoAnulacion),
    });
  });

  // Los ajustes de inventario no guardan el id de la referencia, solo el
  // nombre — por eso se cruzan por nombre (ver Inventario.jsx).
  const idsPorNombre = {};
  inventario.forEach((it) => {
    idsPorNombre[it.name] = idsPorNombre[it.name] || [];
    idsPorNombre[it.name].push(it.id);
  });
  ajustes.forEach((a) => {
    (a.cambios || []).forEach((c) => {
      (idsPorNombre[c.nombre] || []).forEach((id) => {
        if (c.campo === 'Stock') {
          filasDe(id).push({
            Fecha: a.fecha,
            Hora: a.hora,
            Tipo: 'Ajuste de stock',
            Cantidad: c.nuevo - c.anterior,
            Detalle: `${c.anterior} → ${c.nuevo} (${a.motivo})`,
            Usuario: a.usuarioNombre,
            Anulado: 'No',
          });
        } else {
          filasDe(id).push({
            Fecha: a.fecha,
            Hora: a.hora,
            Tipo: c.campo === 'Precio' ? 'Ajuste de precio' : 'Ajuste de costo',
            Cantidad: '',
            Detalle: `${fmt(c.anterior)} → ${fmt(c.nuevo)} (${a.motivo})`,
            Usuario: a.usuarioNombre,
            Anulado: 'No',
          });
        }
      });
    });
  });

  // "Con nombre" primero (orden alfabético) y después "por precio" (orden
  // ascendente) — el mismo orden que se usa en el resto de la app.
  const itemsOrdenados = [...inventario].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'nombre' ? -1 : 1;
    if (a.tipo === 'nombre') return a.name.localeCompare(b.name, 'es');
    return (a.price || 0) - (b.price || 0);
  });

  const wb = XLSX.utils.book_new();
  const nombresUsados = new Set();
  itemsOrdenados.forEach((it) => {
    const filas = (filasPorId[it.id] || []).sort((a, b) => {
      if (a.Fecha !== b.Fecha) return a.Fecha < b.Fecha ? -1 : 1;
      return minutosDeHora(a.Hora) - minutosDeHora(b.Hora);
    });
    const filasFinales =
      filas.length > 0 ? filas : [{ Fecha: '', Hora: '', Tipo: 'Sin movimientos registrados', Cantidad: '', Detalle: '', Usuario: '', Anulado: '' }];
    const ws = XLSX.utils.json_to_sheet(filasFinales, { header: COLUMNAS_HISTORIAL });
    ws['!cols'] = [{ wch: 11 }, { wch: 13 }, { wch: 18 }, { wch: 10 }, { wch: 46 }, { wch: 14 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, ws, nombreHojaValido(it.name, nombresUsados));
  });

  const fechaArchivo = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `EveJeans_historial_por_referencia_${fechaArchivo}.xlsx`);
}
