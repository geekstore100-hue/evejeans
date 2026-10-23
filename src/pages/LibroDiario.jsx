import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  hoyStr,
  sumarDias,
  parseFecha,
  fechaStr,
  fechaLarga,
  fechaConDia,
  fmt,
  horaAMinutos,
  suscribirVentasRango,
  suscribirGastosRango,
  suscribirComprasRango,
  suscribirMovimientosRango,
  suscribirEntregasRango,
} from '../lib/reportes';

// Libro diario (solo Nelson): todo lo que pasó en la tienda, en orden de
// hora — ventas, cambios, gastos, compras, entregas de efectivo y entradas o
// salidas de mercancía — con filtros, totales, Excel e impresión. En vivo.

const TIPOS = ['Venta', 'Cambio', 'Gasto', 'Compra', 'Entrega de dinero', 'Mercancía'];
const FIN_DEL_DIA = 24 * 60; // las entregas no guardan hora: van al final del día

function rangos(hoy) {
  const d = parseFecha(hoy);
  return {
    hoy: { nombre: 'Hoy', desde: hoy, hasta: hoy },
    ayer: { nombre: 'Ayer', desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) },
    semana: { nombre: 'Esta semana', desde: sumarDias(hoy, -((d.getDay() + 6) % 7)), hasta: hoy },
    mes: { nombre: 'Este mes', desde: fechaStr(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: hoy },
  };
}

function lineas(items) {
  return (items || []).map((i) => `${i.name} ×${i.qty}`).join(', ');
}
function detallePago(v) {
  const p = Object.entries(v.pagos || {}).filter(([, x]) => x > 0);
  if (p.length <= 1) return v.pagoLabel || p[0]?.[0] || '';
  return p.map(([m, x]) => `${m} ${fmt(x)}`).join(' + ');
}

function armarFilas({ ventas, gastos, compras, movimientos, entregas }) {
  const F = [];
  ventas.forEach((v) => {
    if (v.tipo === 'cambio') {
      const dif = v.diferencia || 0;
      F.push({
        id: 'c' + v.id,
        fecha: v.fecha,
        hora: v.hora,
        tipo: 'Cambio',
        det:
          `${v.num ? `N.º ${v.num} · ` : ''}Devuelve ${lineas(v.devuelve)} · se lleva ${lineas(v.lleva)}` +
          (dif > 0 ? ` · paga la diferencia${v.pago ? ` en ${v.pago}` : ''}` : dif < 0 ? ` · ${fmt(-dif)} a favor del cliente` : ' · parejo'),
        quien: v.usuarioNombre,
        entra: dif > 0 ? dif : 0,
        anulada: !!v.anulada,
      });
    } else {
      F.push({
        id: 'v' + v.id,
        fecha: v.fecha,
        hora: v.hora,
        tipo: 'Venta',
        det: `N.º ${v.num} · ${lineas(v.items)}${v.descuento ? ` · desc. ${fmt(v.descuento)}` : ''} · ${detallePago(v)}`,
        quien: v.usuarioNombre,
        entra: v.total || 0,
        anulada: !!v.anulada,
      });
    }
  });
  gastos.forEach((g) =>
    F.push({
      id: 'g' + g.id,
      fecha: g.fecha,
      hora: g.hora,
      tipo: 'Gasto',
      det: [g.categoria, g.quien, g.periodo, g.desc, g.origen].filter(Boolean).join(' · '),
      quien: g.usuarioNombre,
      sale: g.monto || 0,
      anulada: !!g.anulado,
    })
  );
  compras.forEach((c) =>
    F.push({
      id: 'k' + c.id,
      fecha: c.fecha,
      hora: c.hora,
      tipo: 'Compra',
      det:
        `${c.facturaNum ? `Factura ${c.facturaNum} · ` : ''}` +
        (c.items || []).map((i) => `${i.cantidadRecibida ?? i.cantidadPedida} ${i.nota || ''}${i.nota ? ' ' : ''}(ref ${i.name}) a ${fmt(i.costoUnitario)}`).join(', ') +
        (c.proveedor ? ` · ${c.proveedor}` : '') +
        (c.estado === 'pendiente' ? ' · sin recibir' : ''),
      quien: c.usuarioNombre,
      sale: c.totalGeneral || 0,
    })
  );
  entregas.forEach((e) => {
    if (e.estado !== 'recibido') return;
    const dif = e.difEntrega || 0;
    F.push({
      id: 'e' + e.id,
      fecha: e.recibidoFecha,
      hora: '',
      tipo: 'Entrega de dinero',
      det:
        `Efectivo del ${fechaLarga(e.fecha || e.id)} · ${e.entregoNombre || '—'} → ${e.recibidoPorNombre || '—'}` +
        (dif < 0 ? ` · faltaron ${fmt(-dif)}` : dif > 0 ? ` · sobraron ${fmt(dif)}` : ' · cuadró') +
        (e.notaRecibo ? ` · ${e.notaRecibo}` : ''),
      quien: e.recibidoPorNombre,
      traslado: e.recibido || 0,
    });
  });
  movimientos.forEach((m) =>
    F.push({
      id: 'm' + m.id,
      fecha: m.fecha,
      hora: m.hora,
      tipo: 'Mercancía',
      det: [m.tipo === 'salida' ? 'Salida' : 'Entrada', `${m.itemNombre} ×${m.cantidad}`, m.categoria, m.detalle].filter(Boolean).join(' · '),
      quien: m.usuarioNombre,
      anulada: !!m.anulada,
    })
  );
  F.forEach((r) => {
    r.min = r.hora ? horaAMinutos(r.hora) : FIN_DEL_DIA;
  });
  return F.sort((a, b) => (a.fecha === b.fecha ? a.min - b.min : a.fecha < b.fecha ? -1 : 1));
}

function esc(t) {
  return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export default function LibroDiario() {
  const [hoy, setHoy] = useState(hoyStr());
  const [rango, setRango] = useState('hoy');
  const [otras, setOtras] = useState({ desde: sumarDias(hoyStr(), -6), hasta: hoyStr() });
  const [tipos, setTipos] = useState(() => Object.fromEntries(TIPOS.map((t) => [t, true])));
  const [datos, setDatos] = useState({ ventas: null, gastos: [], compras: [], movimientos: [], entregas: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setInterval(() => setHoy(hoyStr()), 60000);
    return () => clearInterval(t);
  }, []);

  const R = rango === 'otras' ? { nombre: 'Otras fechas', ...otras } : rangos(hoy)[rango];
  const valido = R.desde && R.hasta && R.desde <= R.hasta;

  useEffect(() => {
    if (!valido) return;
    setDatos({ ventas: null, gastos: [], compras: [], movimientos: [], entregas: [] });
    const err = (e) => setError('No se pudo cargar: ' + e.message);
    const poner = (k) => (lista) => setDatos((d) => ({ ...d, [k]: lista }));
    const quitar = [
      suscribirVentasRango(R.desde, R.hasta, poner('ventas'), err),
      suscribirGastosRango(R.desde, R.hasta, poner('gastos'), err),
      suscribirComprasRango(R.desde, R.hasta, poner('compras'), err),
      suscribirMovimientosRango(R.desde, R.hasta, poner('movimientos'), err),
      suscribirEntregasRango(R.desde, R.hasta, poner('entregas'), err),
    ];
    return () => quitar.forEach((q) => q());
  }, [R.desde, R.hasta, valido]);

  const todas = useMemo(() => (datos.ventas ? armarFilas(datos) : []), [datos]);
  const conteo = {};
  todas.forEach((r) => {
    conteo[r.tipo] = (conteo[r.tipo] || 0) + 1;
  });
  const filas = todas.filter((r) => tipos[r.tipo]);
  let entra = 0;
  let sale = 0;
  let traslado = 0;
  filas.forEach((r) => {
    if (r.anulada) return;
    entra += r.entra || 0;
    sale += r.sale || 0;
    traslado += r.traslado || 0;
  });
  const unDia = R.desde === R.hasta;
  const textoRango = unDia ? `el ${fechaConDia(R.desde)}` : `del ${fechaLarga(R.desde)} al ${fechaLarga(R.hasta)}`;

  function descargarExcel() {
    const aFila = (r) => ({
      Fecha: r.fecha,
      Hora: r.hora || '',
      Tipo: r.tipo,
      Detalle: r.det,
      Quién: r.quien || '',
      Entra: r.anulada ? 0 : r.entra || 0,
      Sale: r.anulada ? 0 : r.sale || 0,
      'Entregado a Fausto': r.anulada ? 0 : r.traslado || 0,
      Anulado: r.anulada ? 'Sí' : '',
    });
    const libro = XLSX.utils.book_new();
    const hoja = (lista) => {
      const h = XLSX.utils.json_to_sheet(lista.map(aFila));
      h['!cols'] = [{ wch: 11 }, { wch: 10 }, { wch: 17 }, { wch: 70 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 8 }];
      return h;
    };
    XLSX.utils.book_append_sheet(libro, hoja(filas), 'Todo');
    TIPOS.filter((t) => tipos[t] && conteo[t]).forEach((t) => {
      XLSX.utils.book_append_sheet(libro, hoja(filas.filter((r) => r.tipo === t)), t.slice(0, 31));
    });
    XLSX.writeFile(libro, unDia ? `libro-diario-${R.desde}.xlsx` : `libro-diario-${R.desde}-a-${R.hasta}.xlsx`);
  }

  function imprimir() {
    const area = document.getElementById('print-area');
    if (!area) return;
    let h = `<div class="pt-center pt-big">LIBRO DIARIO</div><div class="pt-center pt-small">Eve Jeans · ${esc(textoRango)}</div>`;
    let fechaAnt = null;
    filas.forEach((r) => {
      if (r.fecha !== fechaAnt) {
        h += `<div class="pt-rule"></div><div><b>${esc(fechaConDia(r.fecha).toUpperCase())}</b></div>`;
        fechaAnt = r.fecha;
      }
      const valor = r.entra ? `+${fmt(r.entra)}` : r.sale ? `−${fmt(r.sale)}` : r.traslado ? `↔${fmt(r.traslado)}` : '';
      h += `<div class="pt-line"><span>${esc(r.hora || '—')} ${esc(r.tipo)}${r.anulada ? ' (ANULADO)' : ''}</span><span>${r.anulada ? '' : valor}</span></div>`;
      h += `<div class="pt-small">&nbsp;&nbsp;${esc(r.det)}${r.quien ? ' · ' + esc(r.quien) : ''}</div>`;
    });
    if (!filas.length) h += '<div class="pt-rule"></div><div class="pt-small">No hay movimientos.</div>';
    h += `<div class="pt-rule"></div>
      <div class="pt-line"><span>Movimientos</span><span>${filas.length}</span></div>
      <div class="pt-line pt-total"><span>Entró</span><span>${fmt(entra)}</span></div>
      <div class="pt-line pt-total"><span>Salió</span><span>${fmt(sale)}</span></div>
      <div class="pt-line"><span>Entregado a Fausto</span><span>${fmt(traslado)}</span></div>
      <div class="pt-center pt-small" style="margin-top:8px">.</div>`;
    area.className = 'cierre-print';
    area.innerHTML = h;
    window.print();
  }

  return (
    <div className="rp">
      <div className="rp-filtros">
        {Object.entries(rangos(hoy)).map(([k, x]) => (
          <button key={k} className={`rp-chip ${k === rango ? 'on' : ''}`} aria-pressed={k === rango} onClick={() => setRango(k)}>
            {x.nombre}
          </button>
        ))}
        <button className={`rp-chip ${rango === 'otras' ? 'on' : ''}`} aria-pressed={rango === 'otras'} onClick={() => setRango('otras')}>
          Otras fechas…
        </button>
        <div className="rp-acciones">
          <button className="rp-btn" onClick={descargarExcel} disabled={!datos.ventas || !filas.length}>
            ⬇ Descargar Excel
          </button>
          <button className="rp-btn sec" onClick={imprimir} disabled={!datos.ventas}>
            Imprimir
          </button>
        </div>
      </div>

      {rango === 'otras' && (
        <div className="rp-otras">
          <label>
            Desde
            <input type="date" value={otras.desde} max={hoy} onChange={(e) => setOtras((o) => ({ ...o, desde: e.target.value }))} />
          </label>
          <label>
            Hasta
            <input type="date" value={otras.hasta} max={hoy} onChange={(e) => setOtras((o) => ({ ...o, hasta: e.target.value }))} />
          </label>
          {!valido && <span className="msg bad">La fecha de inicio tiene que ser antes de la final.</span>}
        </div>
      )}

      <p className="rp-rango">
        {unDia ? 'El ' : 'Del '}
        <b>{unDia ? fechaConDia(R.desde) : fechaLarga(R.desde)}</b>
        {!unDia && (
          <>
            {' '}
            al <b>{fechaLarga(R.hasta)}</b>
          </>
        )}
        , todo en orden de hora. Toca un tipo para quitarlo o volver a ponerlo.
      </p>

      <div className="rp-tipos">
        {TIPOS.map((t) => (
          <button key={t} className={`rp-tipo-chip ${tipos[t] ? 'on' : ''}`} aria-pressed={tipos[t]} onClick={() => setTipos((x) => ({ ...x, [t]: !x[t] }))}>
            <i />
            {t} · {conteo[t] || 0}
          </button>
        ))}
      </div>

      {error && <p className="msg bad">{error}</p>}

      <div className="rp-resumen-diario">
        <div>
          <span>Movimientos</span>
          <b>{filas.length}</b>
        </div>
        <div>
          <span>Entró</span>
          <b className="rp-entra">{fmt(entra)}</b>
        </div>
        <div>
          <span>Salió</span>
          <b className="rp-sale">{fmt(sale)}</b>
        </div>
        <div>
          <span>Efectivo entregado a Fausto</span>
          <b>{fmt(traslado)}</b>
        </div>
      </div>

      <div className="rp-tabla-wrap">
        <table className="rp-diario">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Tipo</th>
              <th>Detalle</th>
              <th>Quién</th>
              <th className="num">Entra</th>
              <th className="num">Sale</th>
            </tr>
          </thead>
          <tbody>
            {!datos.ventas && (
              <tr>
                <td colSpan="6" className="rp-tabla-vacia">
                  Cargando…
                </td>
              </tr>
            )}
            {datos.ventas && !filas.length && (
              <tr>
                <td colSpan="6" className="rp-tabla-vacia">
                  No hay movimientos con esos filtros.
                </td>
              </tr>
            )}
            {filas.map((r, i) => {
              const sep = !unDia && (i === 0 || filas[i - 1].fecha !== r.fecha);
              return [
                sep && (
                  <tr className="rp-fecha-sep" key={'s' + r.fecha}>
                    <td colSpan="6">{fechaConDia(r.fecha)}</td>
                  </tr>
                ),
                <tr key={r.id} className={r.anulada ? 'anulada' : ''}>
                  <td className="hora">{r.hora || '—'}</td>
                  <td className="etq">
                    <span className="rp-etq-tipo">
                      {r.tipo}
                      {r.anulada ? ' · anulado' : ''}
                    </span>
                  </td>
                  <td className="det">{r.det}</td>
                  <td className="quien">{r.quien || ''}</td>
                  <td className="num entra-col">
                    {r.entra ? (
                      <span className="rp-entra">{fmt(r.entra)}</span>
                    ) : r.traslado ? (
                      <span title="Traslado: el efectivo pasa de la caja a Fausto">↔ {fmt(r.traslado)}</span>
                    ) : (
                      ''
                    )}
                  </td>
                  <td className="num sale-col">{r.sale ? <span className="rp-sale">{fmt(r.sale)}</span> : ''}</td>
                </tr>,
              ];
            })}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan="4">Totales (sin anulados)</td>
                <td className="num">
                  <span className="rp-entra">{fmt(entra)}</span>
                </td>
                <td className="num">
                  <span className="rp-sale">{fmt(sale)}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
