import { useEffect, useState } from 'react';
import { resumenDia, yaCerrado, registrarCierre, hoyStr, MEDIOS } from '../lib/cierre';
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
      const esperado = resumen.netoPorMedio['Efectivo'] || 0;
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
        <h2>Cierre del día</h2>

        {cerrado && (
          <div className="msg good" style={{ textAlign: 'left' }}>
            El día ya se cerró a las {cerrado.hora} por {cerrado.usuarioNombre}.
          </div>
        )}

        <div className="kv"><span>Ventas registradas</span><span className="v">{resumen.nVentas}</span></div>
        <div className="kv"><span>Cambios</span><span className="v">{resumen.nCambios}</span></div>
        <div className="kv"><span>Prendas salidas</span><span className="v">{resumen.unidades}</span></div>
        <div className="kv"><span>Descuentos dados</span><span className="v">{fmt(resumen.descuentos)}</span></div>
        <div className="kv"><span>Gastos del día</span><span className="v">{fmt(resumen.gastosTot)}</span></div>
        {resumen.comision && (
          <div className="kv">
            <span>Comisión del día</span>
            <span className="v" style={{ color: resumen.comision.aplica ? 'var(--ok)' : 'var(--ink-soft)' }}>
              {resumen.comision.aplica ? fmt(resumen.comision.total) : `no aplica (${resumen.comision.prendas} prendas)`}
            </span>
          </div>
        )}

        <div className="split-label" style={{ marginTop: 14 }}>Por medio de pago</div>
        {MEDIOS.filter((m) => m !== 'Efectivo').map((m) => {
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
        <div className="hint" style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 10 }}>
          El efectivo que debería haber en caja no se muestra a propósito: primero cuéntalo.
        </div>
      </div>

      <div className="ticket">
        <div className="card">
          {resultado ? (
            <>
              <h2>Día cerrado</h2>
              <div className="kv"><span>Efectivo que contaste</span><span className="v">{fmt(resultado.contado)}</span></div>
              <div className="kv"><span>Efectivo esperado</span><span className="v">{fmt(resultado.esperado)}</span></div>
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
              <h2>Contar el efectivo</h2>
              <div className="hint" style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
                Cuenta el efectivo de la caja y escribe el total. El sistema te dice después si cuadra.
              </div>
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
