import { useEffect, useState } from 'react';
import { resumenDia, yaCerrado, registrarCierre, hoyStr } from '../lib/cierre';
import { suscribirConfig } from '../lib/config';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Cierre({ usuario }) {
  const [config, setConfig] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [cerrado, setCerrado] = useState(undefined);
  const [contado, setContado] = useState('');
  const [obs, setObs] = useState('');
  const [cerrando, setCerrando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [errorCarga, setErrorCarga] = useState('');
  const [verCambios, setVerCambios] = useState(false);
  const [verGastos, setVerGastos] = useState(false);

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
      const fecha = hoyStr();
      const [r, c] = await Promise.all([resumenDia(fecha, config), yaCerrado(fecha)]);
      setResumen(r);
      setCerrado(c);
    } catch (e) {
      setErrorCarga('No se pudo cargar el resumen del día: ' + e.message);
    }
  }

  async function cerrar() {
    setMsg({ tipo: '', texto: '' });
    const contadoNum = parseInt(contado);
    if (isNaN(contadoNum)) {
      setMsg({ tipo: 'bad', texto: 'Escribe cuánto efectivo contaste.' });
      return;
    }
    setCerrando(true);
    try {
      const esperado = resumen.efectivoAEntregar;
      const res = await registrarCierre({ usuario, esperado, contado: contadoNum, obs: obs.trim(), resumen });
      setResultado({ esperado, contado: contadoNum, diferencia: res.diferencia });
      const c = await yaCerrado(hoyStr());
      setCerrado(c);
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo cerrar el día.' });
    } finally {
      setCerrando(false);
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

  if (!resumen || cerrado === undefined) {
    return <div className="loading">Cargando…</div>;
  }

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>Prendas vendidas hoy</h2>
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

        {/* Cambios, desplegable */}
        <button
          className="btn ghost sm"
          style={{ width: 'auto', marginTop: 14 }}
          onClick={() => setVerCambios((v) => !v)}
        >
          {verCambios ? 'Ocultar cambios' : `Ver cambios (${resumen.cambiosLista.length})`}
        </button>
        {verCambios && (
          <div style={{ marginTop: 10 }}>
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

        <div className="kv" style={{ marginTop: 14 }}>
          <span>Descuentos dados</span>
          <span className="v">{fmt(resumen.descuentos)}</span>
        </div>

        {/* Gastos, desplegable */}
        <button
          className="btn ghost sm"
          style={{ width: 'auto', marginTop: 10 }}
          onClick={() => setVerGastos((v) => !v)}
        >
          {verGastos ? 'Ocultar gastos' : 'Ver gastos'}
        </button>
        <div className="kv" style={{ marginTop: 6 }}>
          <span>
            Gastos del día
            {resumen.comisionPendiente > 0 && (
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}> (incluyendo {fmt(resumen.comisionPendiente)} de comisión)</span>
            )}
          </span>
          <span className="v">{fmt(resumen.gastosTot)}</span>
        </div>
        {verGastos && (
          <div style={{ marginTop: 6 }}>
            {resumen.gastosLista.length === 0 && resumen.comisionPendiente === 0 ? (
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
                {resumen.comisionPendiente > 0 && (
                  <div className="kv">
                    <span>Comisión causada, todavía sin pagar</span>
                    <span className="v" style={{ color: '#b8874a' }}>{fmt(resumen.comisionPendiente)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="split-label" style={{ marginTop: 16 }}>Por medio de pago</div>
        {['Datáfono', 'Nequi', 'Addi', 'PTM', 'Sistecrédito'].map((m) => {
          const entro = resumen.porPago[m] || 0;
          const salio = resumen.gastosMedio[m] || 0;
          if (entro === 0 && salio === 0) return null;
          return (
            <div className="kv" key={m}>
              <span>
                {m}
                {salio > 0 && (
                  <>
                    <br />
                    <span style={{ fontSize: 12, color: '#b8874a' }}>salieron {fmt(salio)} en gastos</span>
                  </>
                )}
              </span>
              <span className="v">{fmt(resumen.netoPorMedio[m])}</span>
            </div>
          );
        })}

        <div className="kv" style={{ marginTop: 10, borderTop: '2px solid var(--ink)', borderBottom: 'none', paddingTop: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 800 }}>Efectivo a entregar</span>
          <span className="v" style={{ fontSize: 22 }}>{fmt(resumen.efectivoAEntregar)}</span>
        </div>
        <div className="hint" style={{ fontSize: 12 }}>Ventas en efectivo menos los gastos que salieron de la caja.</div>
      </div>

      <div className="ticket">
        <div className="card">
          {cerrado && !resultado ? (
            <div className="msg good" style={{ textAlign: 'left' }}>
              El día ya se cerró a las {cerrado.hora} por {cerrado.usuarioNombre}.
            </div>
          ) : null}

          {resultado ? (
            <>
              <h2>Día cerrado</h2>
              <div className="kv"><span>Efectivo a entregar</span><span className="v">{fmt(resultado.esperado)}</span></div>
              <div className="kv"><span>Efectivo que contaste</span><span className="v">{fmt(resultado.contado)}</span></div>
              <div className="kv" style={{ borderBottom: 'none' }}>
                <span><b>Diferencia</b></span>
                <span className="v" style={{ color: resultado.diferencia === 0 ? 'var(--ok)' : 'var(--danger)' }}>
                  <b>
                    {resultado.diferencia === 0
                      ? 'cuadró'
                      : resultado.diferencia > 0
                      ? `sobran ${fmt(resultado.diferencia)}`
                      : `faltan ${fmt(-resultado.diferencia)}`}
                  </b>
                </span>
              </div>
              <div className="msg" style={{ textAlign: 'left', marginTop: 10 }}>
                Guarda el efectivo en un sobre marcado con la fecha de hoy, séllalo y fírmalo.
              </div>
            </>
          ) : (
            <>
              <h2>Cerrar el día</h2>
              <div className="field">
                <label>Efectivo contado</label>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={contado}
                  onChange={(e) => setContado(e.target.value)}
                  disabled={!!cerrado}
                />
              </div>
              <div className="field">
                <label>Observaciones (opcional)</label>
                <input
                  type="text"
                  placeholder="Algo que Nelson deba saber"
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  disabled={!!cerrado}
                />
              </div>
              <button className="btn" disabled={!!cerrado || cerrando} onClick={cerrar}>
                {cerrando ? 'Cerrando…' : cerrado ? 'Ya se cerró hoy' : 'Cerrar el día'}
              </button>
              {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
