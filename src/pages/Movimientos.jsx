import { useEffect, useState } from 'react';
import { ventasPorFecha, anularVenta, hoyStr } from '../lib/ventas';
import { conteosRecientes } from '../lib/conteo';
import { gastosRecientes } from '../lib/gastos';
import { ajustesRecientes } from '../lib/inventario';
import { comprasRecientes } from '../lib/compras';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

function sumarDias(fechaStr, delta) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function fechaBonita(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
}

function medioDePago(v) {
  if (v.tipo === 'venta') {
    if (v.pagoLabel === 'Combinado' && v.pagos) {
      return Object.entries(v.pagos)
        .filter(([, monto]) => monto > 0)
        .map(([medio, monto]) => `${medio} ${fmt(monto)}`)
        .join(' + ');
    }
    return v.pagoLabel || '—';
  }
  return v.pago || '—';
}

export default function Movimientos({ usuario }) {
  const [fecha, setFecha] = useState(hoyStr());
  const [lista, setLista] = useState(null);
  const [conteos, setConteos] = useState(null);
  const [gastos, setGastos] = useState(null);
  const [ajustes, setAjustes] = useState(null);
  const [compras, setCompras] = useState(null);
  const [verGastos, setVerGastos] = useState(true);
  const [verAjustes, setVerAjustes] = useState(false);
  const [verCompras, setVerCompras] = useState(false);

  useEffect(() => {
    conteosRecientes().then(setConteos);
    gastosRecientes().then(setGastos);
    ajustesRecientes().then(setAjustes);
    comprasRecientes().then(setCompras);
  }, []);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  async function cargar() {
    setLista(null);
    setLista(await ventasPorFecha(fecha));
  }

  const esHoy = fecha === hoyStr();

  async function onAnular(v) {
    const motivo = window.prompt(
      `¿Por qué se anula ${v.tipo === 'venta' ? `la venta N.º ${v.num}` : `el cambio N.º ${v.num}`}?`
    );
    if (!motivo || !motivo.trim()) return;
    try {
      await anularVenta(v, motivo.trim(), usuario);
      await cargar();
    } catch (e) {
      alert('No se pudo anular: ' + e.message);
    }
  }

  return (
    <div className="sale-grid">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>
            {esHoy ? 'Movimientos de hoy' : `Movimientos · ${fechaBonita(fecha)}`}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn ghost sm" onClick={() => setFecha((f) => sumarDias(f, -1))}>
              ← Anterior
            </button>
            <input
              type="date"
              value={fecha}
              max={hoyStr()}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
            />
            {!esHoy && (
              <button className="btn ghost sm" onClick={() => setFecha(hoyStr())}>
                Hoy
              </button>
            )}
            <button className="btn ghost sm" disabled={esHoy} onClick={() => setFecha((f) => sumarDias(f, 1))}>
              Siguiente →
            </button>
          </div>
        </div>
        {!lista ? (
          <div className="empty-lines">Cargando…</div>
        ) : lista.length === 0 ? (
          <div className="empty-lines">{esHoy ? 'Todavía no hay nada hoy.' : 'No hubo movimientos ese día.'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>N.º</th>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Detalle</th>
                <th>Medio de pago</th>
                <th>Quién</th>
                <th className="num">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((v) => (
                <tr key={v.id} className={v.anulada ? 'void' : ''}>
                  <td className="num">{v.num}</td>
                  <td>{v.hora}</td>
                  <td>
                    <span className={`pill ${v.tipo}`}>{v.tipo}</span>
                    {v.anulada && <span className="pill anul" style={{ marginLeft: 4 }}>anulada</span>}
                  </td>
                  <td>
                    {v.tipo === 'venta'
                      ? v.items.map((i) => `${i.name}×${i.qty}`).join(', ') + (v.descuento ? ` · desc ${fmt(v.descuento)}` : '')
                      : `sobre N.º ${v.ventaOrig || '—'} · devuelve ${v.devuelve.map((d) => d.name).join(', ')} → lleva ${v.lleva.map((d) => d.name).join(', ')}`}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{medioDePago(v)}</td>
                  <td>{v.usuarioNombre}</td>
                  <td className="num">{fmt(v.total)}</td>
                  <td>
                    {!v.anulada && (
                      <button className="btn ghost sm" onClick={() => onAnular(v)}>
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Conteos recientes</h2>
          {!conteos ? (
            <div className="empty-lines">Cargando…</div>
          ) : conteos.length === 0 ? (
            <div className="empty-lines">Todavía no hay ninguno.</div>
          ) : (
            conteos.map((c) => (
              <div key={c.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {c.fecha} {c.hora} · {c.usuarioNombre}
                </div>
                {c.referencias.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: r.contado !== r.sistema ? 'var(--danger)' : 'var(--ink-soft)' }}>
                    {r.name}: sistema {r.sistema} / contó {r.contado}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="kv" style={{ borderBottom: 'none' }}>
            <span style={{ fontWeight: 800 }}>
              Gastos recientes{' '}
              <button className="link-toggle" onClick={() => setVerGastos((v) => !v)}>
                {verGastos ? 'ocultar' : 'ver'}
              </button>
            </span>
          </div>
          {verGastos && (
            <div className="detalle-anidado">
              {!gastos ? (
                <div className="empty-lines">Cargando…</div>
              ) : gastos.length === 0 ? (
                <div className="empty-lines">Ninguno todavía.</div>
              ) : (
                gastos.map((g) => (
                  <div key={g.id} className="detalle-item" style={g.anulado ? { opacity: 0.5 } : {}}>
                    <div className="detalle-item-top">
                      <span className="detalle-item-titulo">
                        {g.categoria}{g.quien ? ` · ${g.quien}` : ''}
                        {g.anulado && <span style={{ color: 'var(--danger)', fontSize: 11 }}> · ANULADO</span>}
                      </span>
                      <span className="detalle-item-monto">{fmt(g.monto)}</span>
                    </div>
                    <div className="detalle-item-sub">
                      {g.fecha} {g.hora} · {g.origen} · {g.usuarioNombre}
                      {g.anulado && ` · anuló ${g.anuladoPor}: ${g.motivoAnulacion}`}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="kv" style={{ borderBottom: 'none' }}>
            <span style={{ fontWeight: 800 }}>
              Ajustes de inventario{' '}
              <button className="link-toggle" onClick={() => setVerAjustes((v) => !v)}>
                {verAjustes ? 'ocultar' : 'ver'}
              </button>
            </span>
          </div>
          {verAjustes && (
            <div className="detalle-anidado">
              {!ajustes ? (
                <div className="empty-lines">Cargando…</div>
              ) : ajustes.length === 0 ? (
                <div className="empty-lines">Ninguno todavía.</div>
              ) : (
                ajustes.map((a) => (
                  <div key={a.id} className="detalle-item">
                    <div className="detalle-item-titulo">{a.fecha} {a.hora} · {a.motivo}</div>
                    {a.cambios.map((c, i) => (
                      <div key={i} className="detalle-item-sub">
                        {c.nombre} ({c.campo}): {c.campo !== 'Stock' ? fmt(c.anterior) : c.anterior} → {c.campo !== 'Stock' ? fmt(c.nuevo) : c.nuevo}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="kv" style={{ borderBottom: 'none' }}>
            <span style={{ fontWeight: 800 }}>
              Compras recientes{' '}
              <button className="link-toggle" onClick={() => setVerCompras((v) => !v)}>
                {verCompras ? 'ocultar' : 'ver'}
              </button>
            </span>
          </div>
          {verCompras && (
            <div className="detalle-anidado">
              {!compras ? (
                <div className="empty-lines">Cargando…</div>
              ) : compras.length === 0 ? (
                <div className="empty-lines">Ninguna todavía.</div>
              ) : (
                compras.map((c) => (
                  <div key={c.id} className="detalle-item">
                    <div className="detalle-item-top">
                      <span className="detalle-item-titulo">
                        {c.proveedor}
                        <span style={{ fontSize: 11, color: c.estado === 'confirmada' ? 'var(--ok)' : '#b8874a' }}>
                          {' '}· {c.estado === 'confirmada' ? 'CONFIRMADA' : 'PENDIENTE'}
                        </span>
                      </span>
                      <span className="detalle-item-monto">{fmt(c.totalGeneral)}</span>
                    </div>
                    <div className="detalle-item-sub">
                      {c.fecha} {c.hora} · {c.items.map((i) => `${i.name} ×${i.cantidadPedida}`).join(', ')}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
