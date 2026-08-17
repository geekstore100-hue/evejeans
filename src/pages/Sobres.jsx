import { useEffect, useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import { listarPendientes, listarEntregados, entregarSobre } from '../lib/sobres';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Sobres({ usuario }) {
  const [pendientes, setPendientes] = useState(null);
  const [entregados, setEntregados] = useState(null);
  const [abierto, setAbierto] = useState(null); // id del sobre que se está entregando

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const [p, e] = await Promise.all([listarPendientes(), listarEntregados()]);
    setPendientes(p);
    setEntregados(e);
  }

  const totalPendiente = (pendientes || []).reduce((s, c) => s + c.contado, 0);

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>
          Dinero por entregar <span className="side">{pendientes && pendientes.length ? `${pendientes.length} · ${fmt(totalPendiente)}` : ''}</span>
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          El efectivo de cada día que cerraste queda guardado en un sobre marcado con la fecha,
          hasta que Nelson lo recoja y lo cuente contigo.
        </p>

        {!pendientes ? (
          <div className="empty-lines">Cargando…</div>
        ) : pendientes.length === 0 ? (
          <div className="empty-lines">No hay dinero pendiente de entregar.</div>
        ) : (
          pendientes.map((c) =>
            abierto === c.id ? (
              <FormularioEntrega
                key={c.id}
                cierre={c}
                onCancelar={() => setAbierto(null)}
                onListo={async () => {
                  setAbierto(null);
                  await cargar();
                }}
              />
            ) : (
              <div className="gasto-item" key={c.id}>
                <div>
                  <div className="gasto-nombre">{c.fecha}</div>
                  <div className="gasto-sub">cerró {c.usuarioNombre}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="gasto-monto">{fmt(c.contado)}</span>
                  {usuario.id === 'nelson' && (
                    <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setAbierto(c.id)}>
                      Entregar
                    </button>
                  )}
                </div>
              </div>
            )
          )
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Ya entregado</h2>
          {!entregados ? (
            <div className="empty-lines">Cargando…</div>
          ) : entregados.length === 0 ? (
            <div className="empty-lines">Todavía ninguno.</div>
          ) : (
            entregados.map((c) => (
              <div className="kv" key={c.id}>
                <span>
                  {c.fecha}
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                    cerró {c.usuarioNombre} · entregó {c.entregadoPor || '—'}
                  </span>
                </span>
                <span className="v" style={{ color: c.difCustodia ? 'var(--danger)' : 'var(--ok)' }}>
                  {fmt(c.recibido != null ? c.recibido : c.contado)}
                  {c.difCustodia ? (
                    <>
                      <br />
                      <span style={{ fontSize: 10 }}>
                        {c.difCustodia > 0 ? 'sobró' : 'faltó'} {fmt(Math.abs(c.difCustodia))}
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

function FormularioEntrega({ cierre, onCancelar, onListo }) {
  const [recibido, setRecibido] = useState('');
  const [quien, setQuien] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const vendedoras = USUARIOS_BASE.filter((u) => u.id !== 'nelson');

  async function confirmar() {
    const monto = parseInt(recibido);
    if (isNaN(monto)) {
      setMsg('Escribe cuánto contaste.');
      return;
    }
    if (!quien) {
      setMsg('Falta decir quién está entregando.');
      return;
    }
    setGuardando(true);
    try {
      const res = await entregarSobre(cierre.id, { recibido: monto, entregadoPor: quien.nombreDefault, nota }, cierre);
      if (res.difCustodia !== 0) {
        alert(
          `El dinero no cuadró.\n\nDeclarado al cerrar: ${fmt(cierre.contado)}\nContado ahora: ${fmt(monto)}\nDiferencia: ${
            res.difCustodia > 0 ? 'sobró' : 'faltó'
          } ${fmt(Math.abs(res.difCustodia))}\n\nQueda a cargo de ${cierre.usuarioNombre}, que fue quien cerró ese día.`
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
      <div style={{ fontWeight: 800, marginBottom: 6 }}>
        Entregar el dinero del {cierre.fecha} (lo cerró {cierre.usuarioNombre})
      </div>
      <div className="kv" style={{ borderBottom: 'none', marginBottom: 8 }}>
        <span>Declarado al cerrar</span>
        <span className="v">{fmt(cierre.contado)}</span>
      </div>
      <div className="field">
        <label>Efectivo que contaste ahora</label>
        <input type="number" inputMode="numeric" value={recibido} onChange={(e) => setRecibido(e.target.value)} />
      </div>
      <div className="field">
        <label>Quién está entregando</label>
        <div className="chips">
          {vendedoras.map((u) => (
            <button key={u.id} className={`chip ${quien?.id === u.id ? 'on' : ''}`} onClick={() => setQuien(u)}>
              {u.nombreDefault}
            </button>
          ))}
        </div>
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
          {guardando ? 'Guardando…' : 'Confirmar entrega'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}
