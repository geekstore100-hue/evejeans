import { useEffect, useState } from 'react';
import { resumenNumerosNequi, agregarNumeroNequi, hoyStr } from '../lib/nequi';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Nequi({ usuario }) {
  const [numeros, setNumeros] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [mostrarForm, setMostrarForm] = useState(false);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setErrorCarga('');
    try {
      const r = await resumenNumerosNequi();
      setNumeros(r);
      setMostrarForm(r.length === 0);
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

  if (!numeros) return <div className="loading">Cargando…</div>;

  const activo = numeros.find((n) => n.activo);
  const anteriores = numeros.filter((n) => !n.activo);

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>Números de Nequi</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          Cada número queda con su propio total, contado solo desde que empezó hasta que se
          cambió por otro — así nunca se mezcla ni se duplica la plata entre uno y otro.
        </p>

        {activo ? (
          <div className="kv" style={{ fontSize: 18, borderBottom: 'none' }}>
            <span>
              📱 Activo desde el <b>{activo.desde}</b>
              <br />
              <span style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 400 }}>{activo.numero}</span>
            </span>
            <span className="v" style={{ fontWeight: 800 }}>{fmt(activo.total)}</span>
          </div>
        ) : (
          <div className="empty-lines">Todavía no has registrado ningún número.</div>
        )}

        {!mostrarForm && (
          <button className="btn ghost sm" style={{ width: 'auto', marginTop: 10 }} onClick={() => setMostrarForm(true)}>
            Cambiar de número
          </button>
        )}

        {mostrarForm && (
          <FormularioNumero
            usuario={usuario}
            onCancelar={numeros.length > 0 ? () => setMostrarForm(false) : null}
            onListo={async () => {
              setMostrarForm(false);
              await cargar();
            }}
          />
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Números anteriores</h2>
          {anteriores.length === 0 ? (
            <div className="empty-lines">Todavía ninguno.</div>
          ) : (
            anteriores.map((n) => (
              <div className="kv" key={n.id}>
                <span>
                  {n.numero}
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                    del {n.desde} al {n.hasta}
                  </span>
                </span>
                <span className="v">{fmt(n.total)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FormularioNumero({ usuario, onCancelar, onListo }) {
  const [numero, setNumero] = useState('');
  const [desde, setDesde] = useState(hoyStr());
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  async function guardar() {
    setMsg('');
    setGuardando(true);
    try {
      await agregarNumeroNequi(numero, usuario, desde);
      onListo();
    } catch (e) {
      setMsg('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card modo-prueba" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Nuevo número de Nequi</div>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
        Desde este momento, todo lo que entre por Nequi se cuenta para este número nuevo — el
        anterior (si había uno) se cierra automáticamente el día antes de esta fecha.
      </p>
      <div className="field">
        <label>Número de Nequi</label>
        <input type="text" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} />
      </div>
      <div className="field">
        <label>Activo desde</label>
        <input type="date" value={desde} max={hoyStr()} onChange={(e) => setDesde(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {onCancelar && (
          <button className="btn ghost sm" style={{ width: 'auto' }} onClick={onCancelar}>
            Cancelar
          </button>
        )}
        <button className="btn sm" style={{ width: 'auto' }} disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar número'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}
