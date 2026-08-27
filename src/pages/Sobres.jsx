import { useEffect, useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import {
  asegurarPlanillasPendientes,
  planillasPendientes,
  planillasRecibidas,
  confirmarPlanilla,
  confirmarPlanillaHoy,
  calcularEfectivoHoy,
  hoyStr,
} from '../lib/planillas';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Sobres({ usuario }) {
  const [pendientes, setPendientes] = useState(null);
  const [recibidas, setRecibidas] = useState(null);
  const [abierto, setAbierto] = useState(null); // fecha de la planilla que se está recibiendo
  const [hoyAbierto, setHoyAbierto] = useState(false);
  const [errorCarga, setErrorCarga] = useState('');

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setErrorCarga('');
    try {
      // Revisa si hay días atrasados sin planilla y las crea solas (con el monto
      // que ya calculó el Cierre de cada día) antes de mostrar la lista.
      await asegurarPlanillasPendientes();
      const [p, r] = await Promise.all([planillasPendientes(), planillasRecibidas()]);
      setPendientes(p);
      setRecibidas(r);
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

  const totalPendiente = (pendientes || []).reduce((s, p) => s + p.efectivoAEntregar, 0);

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>
          Efectivo por entregar{' '}
          <span className="side">{pendientes && pendientes.length ? `${pendientes.length} · ${fmt(totalPendiente)}` : ''}</span>
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          Cada día se calcula solo, igual que en el Cierre del día — nadie tiene que escribir el
          monto a mano. Cuando Fausto (o tú) lo recojan de verdad y lo cuenten, queda confirmado
          abajo.
        </p>

        {!pendientes ? (
          <div className="empty-lines">Cargando…</div>
        ) : pendientes.length === 0 ? (
          <div className="empty-lines">No hay efectivo pendiente de entregar.</div>
        ) : (
          pendientes.map((p) =>
            abierto === p.fecha ? (
              <FormularioRecibir
                key={p.fecha}
                planilla={p}
                usuario={usuario}
                onCancelar={() => setAbierto(null)}
                onListo={async () => {
                  setAbierto(null);
                  await cargar();
                }}
              />
            ) : (
              <div className="gasto-item" key={p.fecha}>
                <div>
                  <div className="gasto-nombre">{p.fecha}</div>
                  <div className="gasto-sub">del Cierre de ese día</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="gasto-monto">{fmt(p.efectivoAEntregar)}</span>
                  {usuario.id === 'nelson' && (
                    <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setAbierto(p.fecha)}>
                      Recibir
                    </button>
                  )}
                </div>
              </div>
            )
          )
        )}

        {usuario.id === 'nelson' && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {!hoyAbierto ? (
              <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setHoyAbierto(true)}>
                ¿Vas a recoger el efectivo de HOY mismo?
              </button>
            ) : (
              <FormularioHoy
                usuario={usuario}
                onCancelar={() => setHoyAbierto(false)}
                onListo={async () => {
                  setHoyAbierto(false);
                  await cargar();
                }}
              />
            )}
          </div>
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Ya recibido</h2>
          {!recibidas ? (
            <div className="empty-lines">Cargando…</div>
          ) : recibidas.length === 0 ? (
            <div className="empty-lines">Todavía ninguno.</div>
          ) : (
            recibidas.map((p) => (
              <div className="kv" key={p.fecha}>
                <span>
                  {p.fecha}
                  {p.fecha === hoyStr() ? ' (mismo día)' : ''}
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                    entregó {p.entregoNombre || '—'} · recibió {p.recibidoPorNombre || '—'}
                  </span>
                </span>
                <span className="v" style={{ color: p.difEntrega ? 'var(--danger)' : 'var(--ok)' }}>
                  {fmt(p.recibido != null ? p.recibido : p.efectivoAEntregar)}
                  {p.difEntrega ? (
                    <>
                      <br />
                      <span style={{ fontSize: 10 }}>
                        {p.difEntrega > 0 ? 'sobró' : 'faltó'} {fmt(Math.abs(p.difEntrega))}
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ChipsVendedoras({ quien, setQuien }) {
  const vendedoras = USUARIOS_BASE.filter((u) => u.id === 'blanca' || u.id === 'sofia');
  return (
    <div className="chips">
      {vendedoras.map((u) => (
        <button key={u.id} className={`chip ${quien?.id === u.id ? 'on' : ''}`} onClick={() => setQuien(u)}>
          {u.nombreDefault}
        </button>
      ))}
    </div>
  );
}

function FormularioRecibir({ planilla, usuario, onCancelar, onListo }) {
  const [recibido, setRecibido] = useState('');
  const [quien, setQuien] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  async function confirmar() {
    const monto = parseInt(recibido);
    if (isNaN(monto)) {
      setMsg('Escribe cuánto contaste.');
      return;
    }
    if (!quien) {
      setMsg('Falta decir quién te lo entregó.');
      return;
    }
    setGuardando(true);
    try {
      const res = await confirmarPlanilla(planilla, { recibido: monto, entregoNombre: quien.nombreDefault, nota }, usuario);
      if (res.difEntrega !== 0) {
        alert(
          `El dinero no cuadró.\n\nCalculado el ${planilla.fecha}: ${fmt(planilla.efectivoAEntregar)}\nContado ahora: ${fmt(monto)}\nDiferencia: ${
            res.difEntrega > 0 ? 'sobró' : 'faltó'
          } ${fmt(Math.abs(res.difEntrega))}`
        );
      }
      onListo();
    } catch (e) {
      setMsg('No se pudo registrar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card modo-prueba" style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Recibir el efectivo del {planilla.fecha}</div>
      <div className="kv" style={{ borderBottom: 'none', marginBottom: 8 }}>
        <span>Calculado ese día</span>
        <span className="v">{fmt(planilla.efectivoAEntregar)}</span>
      </div>
      <div className="field">
        <label>Efectivo que contaste ahora</label>
        <input type="number" inputMode="numeric" value={recibido} onChange={(e) => setRecibido(e.target.value)} />
      </div>
      <div className="field">
        <label>Quién te lo entregó</label>
        <ChipsVendedoras quien={quien} setQuien={setQuien} />
      </div>
      <div className="field">
        <label>Nota (opcional)</label>
        <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost sm" style={{ width: 'auto' }} onClick={onCancelar}>
          Cancelar
        </button>
        <button className="btn sm" style={{ width: 'auto' }} disabled={guardando} onClick={confirmar}>
          {guardando ? 'Guardando…' : 'Confirmar que la recibí'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}

function FormularioHoy({ usuario, onCancelar, onListo }) {
  const [calculado, setCalculado] = useState(null);
  const [recibido, setRecibido] = useState('');
  const [quien, setQuien] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    calcularEfectivoHoy().then(setCalculado);
  }, []);

  async function confirmar() {
    const monto = parseInt(recibido);
    if (isNaN(monto)) {
      setMsg('Escribe cuánto contaste.');
      return;
    }
    if (!quien) {
      setMsg('Falta decir quién te lo entregó.');
      return;
    }
    setGuardando(true);
    try {
      const res = await confirmarPlanillaHoy({ recibido: monto, entregoNombre: quien.nombreDefault, nota }, usuario);
      if (res.difEntrega !== 0) {
        alert(
          `El dinero no cuadró.\n\nCalculado hasta ahora: ${fmt(res.efectivoAEntregar)}\nContado: ${fmt(monto)}\nDiferencia: ${
            res.difEntrega > 0 ? 'sobró' : 'faltó'
          } ${fmt(Math.abs(res.difEntrega))}`
        );
      }
      onListo();
    } catch (e) {
      setMsg('No se pudo registrar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card modo-prueba" style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Recibir el efectivo de hoy mismo</div>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
        Poco común — normalmente el efectivo se recoge días después. Este número es lo calculado
        HASTA AHORA MISMO; si todavía falta venta por cerrar, va a seguir cambiando.
      </p>
      <div className="kv" style={{ borderBottom: 'none', marginBottom: 8 }}>
        <span>Calculado hasta ahora</span>
        <span className="v">{calculado == null ? 'Calculando…' : fmt(calculado)}</span>
      </div>
      <div className="field">
        <label>Efectivo que contaste ahora</label>
        <input type="number" inputMode="numeric" value={recibido} onChange={(e) => setRecibido(e.target.value)} />
      </div>
      <div className="field">
        <label>Quién te lo entregó</label>
        <ChipsVendedoras quien={quien} setQuien={setQuien} />
      </div>
      <div className="field">
        <label>Nota (opcional)</label>
        <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost sm" style={{ width: 'auto' }} onClick={onCancelar}>
          Cancelar
        </button>
        <button className="btn sm" style={{ width: 'auto' }} disabled={guardando} onClick={confirmar}>
          {guardando ? 'Guardando…' : 'Confirmar que la recibí'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}
