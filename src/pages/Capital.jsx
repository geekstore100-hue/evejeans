import { useEffect, useState } from 'react';
import { capitalDisponible, guardarCapitalInicial, historialCapitalInicial } from '../lib/capital';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}
function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export default function Capital({ usuario }) {
  const [datos, setDatos] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [historial, setHistorial] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setErrorCarga('');
    try {
      const [d, h] = await Promise.all([capitalDisponible(), historialCapitalInicial()]);
      setDatos(d);
      setHistorial(h);
      setMostrarForm(!d.checkpoint);
    } catch (e) {
      setErrorCarga('No se pudo cargar: ' + e.message);
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

  if (!datos) return <div className="loading">Cargando…</div>;

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>Capital disponible</h2>
        {!datos.checkpoint ? (
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
            Todavía no hay un punto de partida. Cuenta cuánta plata hay AHORA MISMO en cada
            bolsillo y regístralo abajo — de ahí en adelante el sistema lo va sumando y restando
            solo con cada venta, gasto y compra.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
              Contando desde el punto de partida del <b>{datos.checkpoint.fecha}</b> (
              {fmt(datos.checkpoint.efectivo + datos.checkpoint.nequi + datos.checkpoint.banco)}), más
              todas las ventas, menos gastos y compras, hasta hoy ({datos.hasta}).
            </p>

            <div className="kv" style={{ fontSize: 18 }}>
              <span style={{ fontWeight: 800 }}>Total disponible</span>
              <span className="v" style={{ fontWeight: 800 }}>{fmt(datos.total)}</span>
            </div>
            <div className="kv">
              <span>💵 Efectivo</span>
              <span className="v">{fmt(datos.efectivo)}</span>
            </div>
            <div className="kv">
              <span>📱 Nequi</span>
              <span className="v">{fmt(datos.nequi)}</span>
            </div>
            <div className="kv">
              <span>🏦 Banco (Datáfono, Addi, PTM, Sistecrédito, transferencias)</span>
              <span className="v">{fmt(datos.banco)}</span>
            </div>

            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>
              Ojo: Datáfono/Addi/PTM/Sistecrédito se cuentan disponibles desde el día de la venta,
              aunque la entidad se demore unos días en consignarte — así que el banco de verdad
              puede tardar un poco en ponerse al día con este número.
            </p>

            {!mostrarForm && (
              <button className="btn ghost sm" style={{ width: 'auto', marginTop: 8 }} onClick={() => setMostrarForm(true)}>
                Recalibrar con un conteo nuevo
              </button>
            )}
          </>
        )}

        {mostrarForm && (
          <FormularioCheckpoint
            usuario={usuario}
            onCancelar={datos.checkpoint ? () => setMostrarForm(false) : null}
            onListo={async () => {
              setMostrarForm(false);
              await cargar();
            }}
          />
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Puntos de partida anteriores</h2>
          {!historial ? (
            <div className="empty-lines">Cargando…</div>
          ) : historial.length === 0 ? (
            <div className="empty-lines">Todavía ninguno.</div>
          ) : (
            historial.map((h) => (
              <div key={h.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{h.fecha}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                  efectivo {fmt(h.efectivo)} · nequi {fmt(h.nequi)} · banco {fmt(h.banco)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                  registrado {h.creadoFecha} {h.creadoHora} · {h.usuarioNombre}
                  {h.nota ? ` · ${h.nota}` : ''}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FormularioCheckpoint({ usuario, onCancelar, onListo }) {
  const [fecha, setFecha] = useState(hoyStr());
  const [efectivo, setEfectivo] = useState('');
  const [nequi, setNequi] = useState('');
  const [banco, setBanco] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  async function guardar() {
    const e = parseInt(efectivo) || 0;
    const n = parseInt(nequi) || 0;
    const b = parseInt(banco) || 0;
    if (efectivo === '' && nequi === '' && banco === '') {
      setMsg('Escribe al menos un bolsillo.');
      return;
    }
    setGuardando(true);
    setMsg('');
    try {
      await guardarCapitalInicial({ fecha, efectivo: e, nequi: n, banco: b, nota, usuario });
      onListo();
    } catch (err) {
      setMsg('No se pudo guardar: ' + err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card modo-prueba" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Nuevo punto de partida</div>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
        Escribe el saldo tal como quedó AL FINAL de ese día (después de cerrar) — desde el día
        siguiente en adelante el sistema lo va sumando solo. Si pones la fecha de hoy, asegúrate
        de que el número ya incluya lo que ha pasado hoy hasta este momento.
      </p>
      <div className="field">
        <label>Fecha del conteo</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} max={hoyStr()} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ minWidth: 140 }}>
          <label>💵 Efectivo</label>
          <input type="number" inputMode="numeric" value={efectivo} onChange={(e) => setEfectivo(e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 140 }}>
          <label>📱 Nequi</label>
          <input type="number" inputMode="numeric" value={nequi} onChange={(e) => setNequi(e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 140 }}>
          <label>🏦 Banco</label>
          <input type="number" inputMode="numeric" value={banco} onChange={(e) => setBanco(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Nota (opcional)</label>
        <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {onCancelar && (
          <button className="btn ghost sm" style={{ width: 'auto' }} onClick={onCancelar}>
            Cancelar
          </button>
        )}
        <button className="btn sm" style={{ width: 'auto' }} disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar punto de partida'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}
