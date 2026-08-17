import { useEffect, useState } from 'react';
import { resumenDia, hoyStr } from '../lib/cierre';
import { suscribirConfig } from '../lib/config';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Cierre({ usuario }) {
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
  }, [config]);

  async function cargar() {
    if (!config) return;
    try {
      const r = await resumenDia(hoyStr(), config);
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
    <div className="card" style={{ maxWidth: 620 }}>
      <h2>Prendas vendidas hoy ({resumen.prendas.reduce((s, p) => s + p.qty, 0)})</h2>
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
        <div style={{ marginTop: 6, marginBottom: 6 }}>
          {resumen.cambiosLista.length === 0 ? (
            <div className="empty-lines">Ningún cambio hoy.</div>
          ) : (
            resumen.cambiosLista.map((c) => (
              <div key={c.id} className="kv" style={{ alignItems: 'flex-start' }}>
                <span>
                  {c.hora}
                  <br />
                  <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                    devuelve: {c.devuelve.map((d) => `${d.name} ×${d.qty}`).join(', ')}
                    <br />
                    lleva: {c.lleva.map((d) => `${d.name} ×${d.qty}`).join(', ')}
                  </span>
                </span>
                <span className="v">
                  {c.diferencia === 0 ? 'parejo' : c.diferencia > 0 ? `+${fmt(c.diferencia)}` : `−${fmt(-c.diferencia)}`}
                </span>
              </div>
            ))
          )}
        </div>
      )}

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
        <div style={{ marginTop: 6 }}>
          {resumen.gastosLista.length === 0 && resumen.comisionMonto === 0 ? (
            <div className="empty-lines">Ningún gasto hoy.</div>
          ) : (
            <>
              {resumen.gastosLista.map((g) => (
                <div key={g.id} className="kv">
                  <span>
                    {g.hora} · {g.categoria}
                    {g.quien ? ` · ${g.quien}` : ''}
                    <br />
                    <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{g.origen}</span>
                  </span>
                  <span className="v">{fmt(g.monto)}</span>
                </div>
              ))}
              {resumen.comisionMonto > 0 && (
                <div className="kv">
                  <span>Comisión ({resumen.comision.prendas} prendas) · automática</span>
                  <span className="v">{fmt(resumen.comisionMonto)}</span>
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
            <div style={{ marginTop: 6 }}>
              {resumen.comprasLista.length === 0 ? (
                <div className="empty-lines">Ninguna compra hoy.</div>
              ) : (
                resumen.comprasLista.map((c) => (
                  <div key={c.id} className="kv">
                    <span>
                      {c.hora}{c.proveedor ? ` · ${c.proveedor}` : ''}
                      <br />
                      <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                        {c.items.map((i) => `${i.name} ×${i.qty}`).join(', ')} · {c.origen}
                      </span>
                    </span>
                    <span className="v">{fmt(c.totalGeneral)}</span>
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
  );
}
