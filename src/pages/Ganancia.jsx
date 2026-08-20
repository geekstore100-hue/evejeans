import { useEffect, useState } from 'react';
import { suscribirConfig } from '../lib/config';
import { calcularGanancia, valorDeMercancia, hoyStr, inicioDeSemana, inicioDeMes } from '../lib/ganancia';
import { generarExcel } from '../lib/excel';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'todo', label: 'Todo' },
];

export default function Ganancia() {
  const [config, setConfig] = useState(null);
  const [periodo, setPeriodo] = useState('mes');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [mercancia, setMercancia] = useState(null);
  const [verGastos, setVerGastos] = useState(false);
  const [generandoExcel, setGenerandoExcel] = useState(false);
  const [errorExcel, setErrorExcel] = useState('');

  async function descargarExcel() {
    setGenerandoExcel(true);
    setErrorExcel('');
    try {
      await generarExcel(config);
    } catch (e) {
      setErrorExcel('No se pudo generar el Excel: ' + e.message);
    } finally {
      setGenerandoExcel(false);
    }
  }

  useEffect(() => suscribirConfig(setConfig), []);

  useEffect(() => {
    if (config) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, periodo]);

  useEffect(() => {
    valorDeMercancia().then(setMercancia).catch(() => setMercancia(null));
  }, []);

  function rangoDe(periodoId) {
    const hoy = hoyStr();
    if (periodoId === 'hoy') return [hoy, hoy];
    if (periodoId === 'semana') return [inicioDeSemana(), hoy];
    if (periodoId === 'mes') return [inicioDeMes(), hoy];
    return ['2020-01-01', hoy];
  }

  async function cargar() {
    setCargando(true);
    setError('');
    try {
      const [desde, hasta] = rangoDe(periodo);
      const r = await calcularGanancia(desde, hasta, config);
      setDatos(r);
    } catch (e) {
      setError('No se pudo calcular: ' + e.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="sale-grid">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Ganancia</h2>
          <button
            className="btn ghost sm"
            style={{ width: 'auto' }}
            disabled={!config || generandoExcel}
            onClick={descargarExcel}
          >
            {generandoExcel ? 'Generando…' : 'Descargar Excel'}
          </button>
        </div>
        {errorExcel && <div className="msg bad" style={{ textAlign: 'left' }}>{errorExcel}</div>}
        <div className="chips" style={{ marginBottom: 14 }}>
          {PERIODOS.map((p) => (
            <button key={p.id} className={`chip ${periodo === p.id ? 'on' : ''}`} onClick={() => setPeriodo(p.id)}>
              {p.label}
            </button>
          ))}
        </div>

        {error && <div className="msg bad" style={{ textAlign: 'left' }}>{error}</div>}
        {cargando || !datos ? (
          <div className="empty-lines">Calculando…</div>
        ) : (
          <>
            <div className="kv">
              <span>Ingresos ({datos.unidadesVendidas} prendas vendidas)</span>
              <span className="v">{fmt(datos.ingresos)}</span>
            </div>
            {datos.descuentos > 0 && (
              <div className="kv">
                <span>Descuentos dados</span>
                <span className="v">−{fmt(datos.descuentos)}</span>
              </div>
            )}
            <div className="kv">
              <span>Costo de la mercancía vendida</span>
              <span className="v">−{fmt(datos.costoMercancia)}</span>
            </div>
            <div className="kv" style={{ borderTop: '2px solid var(--ink)', paddingTop: 8 }}>
              <span style={{ fontWeight: 800 }}>Ganancia Bruta</span>
              <span className="v" style={{ fontWeight: 800 }}>{fmt(datos.gananciaBruta)}</span>
            </div>

            <div className="kv" style={{ marginTop: 10 }}>
              <span>
                Gastos (incluye comisión){' '}
                <button className="link-toggle" onClick={() => setVerGastos((v) => !v)}>
                  {verGastos ? 'ocultar' : 'ver'}
                </button>
              </span>
              <span className="v">−{fmt(datos.gastosAdmin)}</span>
            </div>
            {verGastos && Object.keys(datos.gastosPorCategoria).length > 0 && (
              <div className="detalle-anidado">
                {Object.entries(datos.gastosPorCategoria)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, monto]) => (
                    <div key={cat} className="detalle-item">
                      <div className="detalle-item-top">
                        <span className="detalle-item-titulo">{cat}</span>
                        <span className="detalle-item-monto">{fmt(monto)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            <div className="kv" style={{ marginTop: 10, borderTop: '2px solid var(--ink)', borderBottom: 'none', paddingTop: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 800 }}>Ganancia Neta</span>
              <span className="v" style={{ fontSize: 22, fontWeight: 800, color: datos.gananciaNeta >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                {fmt(datos.gananciaNeta)}
              </span>
            </div>

            {datos.retirosSocios > 0 && (
              <>
                <div className="kv" style={{ marginTop: 14 }}>
                  <span>Retiros de socios en el período</span>
                  <span className="v">{fmt(datos.retirosSocios)}</span>
                </div>
                <div className="hint" style={{ fontSize: 12 }}>
                  Esto no se resta de la Ganancia Neta: es un reparto de la ganancia, no un gasto del negocio.
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Valor de mercancía</h2>
          <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Foto de ahora mismo, no depende del período elegido.
          </div>
          {!mercancia ? (
            <div className="empty-lines">Cargando…</div>
          ) : (
            <>
              <div className="kv">
                <span>Prendas en inventario</span>
                <span className="v">{mercancia.totalPrendas}</span>
              </div>
              <div className="kv">
                <span>Valor a precio de venta</span>
                <span className="v">{fmt(mercancia.valorVenta)}</span>
              </div>
              <div className="kv" style={{ borderBottom: 'none' }}>
                <span>Valor a costo de compra</span>
                <span className="v">{fmt(mercancia.valorCosto)}</span>
              </div>

              <div className="split-label" style={{ marginTop: 16 }}>Las 8 referencias con más valor</div>
              {mercancia.porItem.slice(0, 8).map((it) => (
                <div className="kv" key={it.name}>
                  <span>{it.name} <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>×{it.stock}</span></span>
                  <span className="v">{fmt(it.valorVenta)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
