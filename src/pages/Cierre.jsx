import { useEffect, useState } from 'react';
import { resumenDia, hoyStr } from '../lib/cierre';
import { suscribirConfig } from '../lib/config';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

function fechaBonita(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function Cierre({ usuario }) {
  const [fecha, setFecha] = useState(hoyStr());
  const [config, setConfig] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [verCambios, setVerCambios] = useState(false);
  const [verGastos, setVerGastos] = useState(false);
  const [verCompras, setVerCompras] = useState(false);

  useEffect(
    () =>
      suscribirConfig(setConfig, (err) =>
        setErrorCarga('No se pudo leer la configuración: ' + err.message)
      ),
    []
  );

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, fecha]);

  const esHoy = fecha === hoyStr();

  async function cargar() {
    if (!config) return;
    try {
      setResumen(null);
      const r = await resumenDia(fecha, config);
      setResumen(r);
    } catch (e) {
      setErrorCarga('No se pudo cargar el resumen del día: ' + e.message);
    }
  }

  if (errorCarga) {
    return (
      <div style={{ padding: 24 }}>
        <div className="card" style={{ maxWidth: 460 }}>
          <h2>No se pudo cargar</h2>
          <p style={{ fontSize: 14, color: 'var(--danger)' }}>{errorCarga}</p>
        </div>
      </div>
    );
  }

  if (!resumen) {
    return <div className="loading">Cargando…</div>;
  }

  return (
    <div className="sale-grid">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>
            Prendas vendidas {esHoy ? 'hoy' : `· ${fechaBonita(fecha)}`} ({resumen.prendas.reduce((s, p) => s + p.qty, 0)})
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
          </div>
        </div>
        {resumen.prendas.length === 0 ? (
          <div className="empty-lines">Todavía no hay nada.</div>
        ) : (
          <table>
            <tbody>
              {resumen.prendas.map((p) => (
                <tr key={p.name}>
                  <td style={{ fontWeight: 700, fontSize: 16, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>{p.name}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 18, fontWeight: 800, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    {p.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Cambios: un solo renglón, con el desplegable como texto sutil */}
        <div className="kv" style={{ marginTop: 14 }}>
          <span>
            Cambios{' '}
            <button className="link-toggle" onClick={() => setVerCambios((v) => !v)}>
              {verCambios ? 'ocultar' : 'ver'}
            </button>
          </span>
          <span className="v">{resumen.cambiosLista.length}</span>
        </div>
        {verCambios && (
          <div className="detalle-anidado">
            {resumen.cambiosLista.length === 0 ? (
              <div className="empty-lines">{esHoy ? 'Ningún cambio hoy.' : 'Ningún cambio ese día.'}</div>
            ) : (
              resumen.cambiosLista.map((c) => (
                <div key={c.id} className="detalle-item">
                  <div className="detalle-item-top">
                    <span className="detalle-item-titulo">Cambio {c.hora}</span>
                    <span className="detalle-item-monto">
                      {c.diferencia === 0 ? 'parejo' : c.diferencia > 0 ? `+${fmt(c.diferencia)}` : `−${fmt(-c.diferencia)}`}
                    </span>
                  </div>
                  <div className="detalle-item-sub">
                    devuelve: {c.devuelve.map((d) => `${d.name} ×${d.qty}`).join(', ')}
                  </div>
                  <div className="detalle-item-sub">
                    lleva: {c.lleva.map((d) => `${d.name} ×${d.qty}`).join(', ')}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Resumen del día</h2>

          <div className="kv">
            <span>Descuentos dados</span>
            <span className="v">{fmt(resumen.descuentos)}</span>
          </div>

          {/* Gastos: un solo renglón, con el desplegable como texto sutil */}
          <div className="kv">
            <span>
              Gastos del día{' '}
              <button className="link-toggle" onClick={() => setVerGastos((v) => !v)}>
                {verGastos ? 'ocultar' : 'ver'}
              </button>
            </span>
            <span className="v">{fmt(resumen.gastosTot)}</span>
          </div>
          {verGastos && (
            <div className="detalle-anidado">
              {resumen.gastosLista.length === 0 && resumen.comisionMonto === 0 ? (
                <div className="empty-lines">{esHoy ? 'Ningún gasto hoy.' : 'Ningún gasto ese día.'}</div>
              ) : (
                <>
                  {resumen.gastosLista.map((g) => (
                    <div key={g.id} className="detalle-item">
                      <div className="detalle-item-top">
                        <span className="detalle-item-titulo">
                          {g.categoria}{g.quien ? ` · ${g.quien}` : ''}
                        </span>
                        <span className="detalle-item-monto">{fmt(g.monto)}</span>
                      </div>
                      <div className="detalle-item-sub">{g.hora} · {g.origen}</div>
                    </div>
                  ))}
                  {resumen.comisionMonto > 0 && (
                    <div className="detalle-item">
                      <div className="detalle-item-top">
                        <span className="detalle-item-titulo">Comisión</span>
                        <span className="detalle-item-monto">{fmt(resumen.comisionMonto)}</span>
                      </div>
                      <div className="detalle-item-sub">{resumen.comision.prendas} prendas · automática</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {usuario.id === 'nelson' && (
            <>
              {/* Compras: un solo renglón, con el desplegable como texto sutil */}
              <div className="kv">
                <span>
                  Compras del día{' '}
                  <button className="link-toggle" onClick={() => setVerCompras((v) => !v)}>
                    {verCompras ? 'ocultar' : 'ver'}
                  </button>
                </span>
                <span className="v">{fmt(resumen.comprasTot)}</span>
              </div>
              {verCompras && (
                <div className="detalle-anidado">
                  {resumen.comprasLista.length === 0 ? (
                    <div className="empty-lines">{esHoy ? 'Ninguna compra hoy.' : 'Ninguna compra ese día.'}</div>
                  ) : (
                    resumen.comprasLista.map((c) => (
                      <div key={c.id} className="detalle-item">
                        <div className="detalle-item-top">
                          <span className="detalle-item-titulo">{c.proveedor || 'Sin proveedor'}</span>
                          <span className="detalle-item-monto">{fmt(c.totalGeneral)}</span>
                        </div>
                        <div className="detalle-item-sub">
                          {c.hora} · {c.items.map((i) => `${i.name} ×${i.qty}`).join(', ')} · {c.origen}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}

          <div className="split-label" style={{ marginTop: 16 }}>Por medio de pago</div>
          {['Datáfono', 'Nequi', 'Addi', 'PTM', 'Sistecrédito'].map((m) => {
            const entro = resumen.porPago[m] || 0;
            const salioGastos = resumen.gastosMedio[m] || 0;
            const salioCompras = resumen.comprasMedio[m] || 0;
            if (entro === 0 && salioGastos === 0 && salioCompras === 0) return null;
            return (
              <div className="kv" key={m}>
                <span>
                  {m}
                  {salioGastos > 0 && (
                    <>
                      <br />
                      <span style={{ fontSize: 12, color: '#b8874a' }}>salieron {fmt(salioGastos)} en gastos</span>
                    </>
                  )}
                  {usuario.id === 'nelson' && salioCompras > 0 && (
                    <>
                      <br />
                      <span style={{ fontSize: 12, color: '#b8874a' }}>salieron {fmt(salioCompras)} en compras</span>
                    </>
                  )}
                </span>
                <span className="v">{fmt(resumen.netoPorMedio[m])}</span>
              </div>
            );
          })}

          <div className="kv" style={{ marginTop: 10, borderTop: '2px solid var(--ink)', paddingTop: 10 }}>
            <span>Efectivo antes de gastos</span>
            <span className="v">{fmt(resumen.porPago['Efectivo'] || 0)}</span>
          </div>
          <div className="kv" style={{ borderBottom: 'none' }}>
            <span style={{ fontSize: 18, fontWeight: 800 }}>Efectivo a entregar</span>
            <span className="v" style={{ fontSize: 22 }}>{fmt(resumen.efectivoAEntregar)}</span>
          </div>
          <div className="hint" style={{ fontSize: 12 }}>Ventas en efectivo menos los gastos y compras que salieron de la caja.</div>
        </div>
      </div>
    </div>
  );
}
