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

const COLUMNAS_HISTORIAL = ['Fecha', 'Hora', 'Tipo', 'Cantidad', 'Saldo', 'Detalle', 'Usuario', 'Anulado'];

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
// salidas manuales, y ajustes de inventario (precio, costo o stock) — cada
// fila con el "Saldo" (cuánto quedaba en stock después de ESE movimiento),
// para que al final coincida con lo que hoy muestra Ventas. Se incluye todo,
// incluso lo anulado (marcado como tal, y con su reversión aparte, porque
// anular sí repone el stock de verdad) — nada se esconde, igual que en el
// resto de la app.
export async function generarExcelHistorialItems() {
  const [ventasYCambios, compras, movimientos, ajustes, inventario] = await Promise.all([
    todasLasVentasYCambios(),
    todasLasCompras(),
    todosLosMovimientosManuales(),
    todosLosAjustesInventario(),
    inventarioActual(),
  ]);

  // {itemId: [evento, evento, ...]} — "evento" es un objeto de trabajo interno
  // (con campos que NO van al Excel, como si mueve stock o no); la fila final
  // que sí se imprime se arma después, ya con el Saldo calculado.
  const eventosPorId = {};
  function eventosDe(id) {
    eventosPorId[id] = eventosPorId[id] || [];
    return eventosPorId[id];
  }
  function agregar(id, evento) {
    eventosDe(id).push({ cantidad: null, esAjusteStock: false, ...evento });
  }

  ventasYCambios.forEach((v) => {
    if (v.tipo === 'venta') {
      (v.items || []).forEach((i) => {
        agregar(i.id, {
          fecha: v.fecha,
          hora: v.hora,
          tipo: 'Venta',
          cantidad: -i.qty,
          detalle: `Venta N.º ${v.num}`,
          usuario: v.usuarioNombre,
          anulado: !!v.anulada,
          motivoAnulacion: v.motivoAnulacion,
        });
        // Anular una venta SÍ repone el stock de verdad (ver anularVenta en
        // ventas.js) — se dejan las dos filas: lo que pasó, y la reversión.
        if (v.anulada) {
          agregar(i.id, {
            fecha: v.fecha,
            hora: v.hora,
            tipo: 'Anulación de venta',
            cantidad: i.qty,
            detalle: `Repone lo vendido en la Venta N.º ${v.num} — motivo: ${v.motivoAnulacion || 'sin motivo registrado'}`,
            usuario: v.anuladaPor || v.usuarioNombre,
          });
        }
      });
    } else if (v.tipo === 'cambio') {
      (v.devuelve || []).forEach((i) => {
        agregar(i.id, {
          fecha: v.fecha,
          hora: v.hora,
          tipo: 'Cambio (entrada)',
          cantidad: i.qty,
          detalle: `Cambio N.º ${v.num} — el cliente la devuelve`,
          usuario: v.usuarioNombre,
          anulado: !!v.anulada,
          motivoAnulacion: v.motivoAnulacion,
        });
        if (v.anulada) {
          agregar(i.id, {
            fecha: v.fecha,
            hora: v.hora,
            tipo: 'Anulación de cambio',
            cantidad: -i.qty,
            detalle: `Deshace la devolución del Cambio N.º ${v.num} — motivo: ${v.motivoAnulacion || 'sin motivo registrado'}`,
            usuario: v.anuladaPor || v.usuarioNombre,
          });
        }
      });
      (v.lleva || []).forEach((i) => {
        agregar(i.id, {
          fecha: v.fecha,
          hora: v.hora,
          tipo: 'Cambio (salida)',
          cantidad: -i.qty,
          detalle: `Cambio N.º ${v.num} — el cliente se la lleva`,
          usuario: v.usuarioNombre,
          anulado: !!v.anulada,
          motivoAnulacion: v.motivoAnulacion,
        });
        if (v.anulada) {
          agregar(i.id, {
            fecha: v.fecha,
            hora: v.hora,
            tipo: 'Anulación de cambio',
            cantidad: i.qty,
            detalle: `Repone lo que se llevó el Cambio N.º ${v.num} — motivo: ${v.motivoAnulacion || 'sin motivo registrado'}`,
            usuario: v.anuladaPor || v.usuarioNombre,
          });
        }
      });
    }
  });

  // Solo lo YA CONFIRMADO movió stock de verdad (lo pendiente todavía no).
  compras
    .filter((c) => c.estado === 'confirmada')
    .forEach((c) => {
      (c.items || []).forEach((i) => {
        if (!i.cantidadRecibida) return;
        agregar(i.id, {
          fecha: c.confirmadoFecha || c.fecha,
          hora: '',
          tipo: 'Compra recibida',
          cantidad: i.cantidadRecibida,
          detalle:
            `Pedido del ${c.fecha}${c.proveedor ? ' a ' + c.proveedor : ''}` +
            (i.nota ? ` (${i.nota})` : '') +
            (i.cantidadRecibida !== i.cantidadPedida ? ` — pedidas ${i.cantidadPedida}` : ''),
          usuario: c.confirmadoPor || c.usuarioNombre,
        });
      });
    });

  movimientos.forEach((m) => {
    agregar(m.itemId, {
      fecha: m.fecha,
      hora: m.hora,
      tipo: m.tipo === 'entrada' ? 'Entrada manual' : 'Salida manual',
      cantidad: m.tipo === 'entrada' ? m.cantidad : -m.cantidad,
      detalle: `${m.categoria}${m.detalle ? ' · ' + m.detalle : ''}`,
      usuario: m.usuarioNombre,
      anulado: !!m.anulada,
      motivoAnulacion: m.motivoAnulacion,
    });
    // Anular un movimiento también repone (o vuelve a descontar) el stock de
    // verdad (ver anularMovimiento en entradasSalidas.js).
    if (m.anulada) {
      agregar(m.itemId, {
        fecha: m.fecha,
        hora: m.hora,
        tipo: 'Anulación de movimiento',
        cantidad: m.tipo === 'entrada' ? -m.cantidad : m.cantidad,
        detalle: `Deshace el movimiento N.º ${m.num} — motivo: ${m.motivoAnulacion || 'sin motivo registrado'}`,
        usuario: m.anuladaPor || m.usuarioNombre,
      });
    }
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
          // El ajuste de stock deja el número EXACTO (no un delta) — se usa
          // tal cual como el nuevo saldo, para que autocorrija cualquier
          // desfase que se haya podido acumular antes de este punto.
          agregar(id, {
            fecha: a.fecha,
            hora: a.hora,
            tipo: 'Ajuste de stock',
            cantidad: c.nuevo - c.anterior,
            esAjusteStock: true,
            stockAbsoluto: c.nuevo,
            detalle: `${c.anterior} → ${c.nuevo} (${a.motivo})`,
            usuario: a.usuarioNombre,
          });
        } else {
          agregar(id, {
            fecha: a.fecha,
            hora: a.hora,
            tipo: c.campo === 'Precio' ? 'Ajuste de precio' : 'Ajuste de costo',
            detalle: `${fmt(c.anterior)} → ${fmt(c.nuevo)} (${a.motivo})`,
            usuario: a.usuarioNombre,
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
    // Todo nace en 0 (catálogo inicial y referencias nuevas siempre arrancan
    // con stock 0), así que sumando cada movimiento en orden se debe llegar
    // exactamente al stock que hoy muestra Ventas.
    const eventos = (eventosPorId[it.id] || []).sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
      return minutosDeHora(a.hora) - minutosDeHora(b.hora);
    });

    let saldo = 0;
    const filas = eventos.map((e) => {
      saldo = e.esAjusteStock ? e.stockAbsoluto : saldo + (e.cantidad || 0);
      return {
        Fecha: e.fecha,
        Hora: e.hora,
        Tipo: e.tipo,
        Cantidad: e.cantidad === null ? '' : e.cantidad,
        Saldo: saldo,
        Detalle: e.detalle,
        Usuario: e.usuario,
        Anulado: e.anulado !== undefined ? anuladoTexto(e.anulado, e.motivoAnulacion) : 'No',
      };
    });

    if (filas.length === 0) {
      filas.push({
        Fecha: '',
        Hora: '',
        Tipo: 'Sin movimientos registrados',
        Cantidad: '',
        Saldo: it.stock || 0,
        Detalle: '',
        Usuario: '',
        Anulado: '',
      });
    } else if (saldo !== (it.stock || 0)) {
      filas.push({
        Fecha: '',
        Hora: '',
        Tipo: '⚠ Diferencia con el sistema',
        Cantidad: '',
        Saldo: it.stock || 0,
        Detalle: `El saldo de este historial (${saldo}) no coincide con el stock actual (${it.stock || 0}). Lo más probable es que haya sido por una venta que ocurrió antes de registrar el conteo/ajuste inicial de esta referencia.`,
        Usuario: '',
        Anulado: '',
      });
    }

    const ws = XLSX.utils.json_to_sheet(filas, { header: COLUMNAS_HISTORIAL });
    ws['!cols'] = [{ wch: 11 }, { wch: 13 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 46 }, { wch: 14 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, ws, nombreHojaValido(it.name, nombresUsados));
  });

  const fechaArchivo = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `EveJeans_historial_por_referencia_${fechaArchivo}.xlsx`);
}
