import { useEffect, useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import { suscribirConfig } from '../lib/config';
import { registrarGasto, anularGasto, comisionDeHoy, gastosDeHoy, esNomina } from '../lib/gastos';
import { imprimirComprobantePago } from '../lib/imprimir';

const CATEGORIAS_TODOS = ['Sueldo', 'Recibos', 'Otro'];
const CATEGORIAS_NELSON = ['Sueldo', 'Socios', 'Recibos', 'Otro'];
const ORIGENES = ['Efectivo de la caja', 'Nequi del local'];

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Gastos({ usuario }) {
  const [config, setConfig] = useState(null);
  const [lista, setLista] = useState(null);
  const [monto, setMonto] = useState('');
  const [cat, setCat] = useState('');
  const [quien, setQuien] = useState(null);
  const [desc, setDesc] = useState('');
  const [origen, setOrigen] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [comisionHoy, setComisionHoy] = useState(null);

  const vendedoras = USUARIOS_BASE.filter((u) => u.id !== 'nelson');
  const nomina = esNomina(cat);
  const CATEGORIAS = usuario.id === 'nelson' ? CATEGORIAS_NELSON : CATEGORIAS_TODOS;

  useEffect(() => suscribirConfig(setConfig), []);
  useEffect(() => {
    cargarLista();
  }, []);

  // La comisión del día se calcula sola, en vivo — nadie la escribe a mano.
  useEffect(() => {
    if (config) comisionDeHoy(config).then(setComisionHoy);
  }, [config, lista]);

  async function cargarLista() {
    try {
      const g = await gastosDeHoy();
      setLista(g.sort((a, b) => (a.creadoEn?.seconds || 0) - (b.creadoEn?.seconds || 0)));
    } catch (e) {
      setLista([]);
    }
  }

  function limpiar() {
    setMonto('');
    setCat('');
    setQuien(null);
    setDesc('');
    setOrigen(null);
  }

  async function guardar() {
    setMsg({ tipo: '', texto: '' });
    const montoNum = parseInt(monto) || 0;
    if (montoNum <= 0) {
      setMsg({ tipo: 'bad', texto: 'Falta escribir cuánto fue.' });
      return;
    }
    if (!cat) {
      setMsg({ tipo: 'bad', texto: 'Falta elegir de qué es el gasto.' });
      return;
    }
    if (nomina && !quien) {
      setMsg({ tipo: 'bad', texto: 'Falta decir a quién se le paga.' });
      return;
    }
    if (!origen) {
      setMsg({ tipo: 'bad', texto: 'Falta decir de dónde sale la plata.' });
      return;
    }
    setGuardando(true);
    try {
      const res = await registrarGasto({
        usuario,
        categoria: cat,
        quien: quien ? quien.nombreDefault : null,
        periodo: null,
        monto: montoNum,
        desc: desc.trim(),
        origen,
      });
      await cargarLista();
      setMsg({ tipo: 'good', texto: nomina ? 'Pago registrado. Imprime el comprobante y hazlo firmar.' : 'Listo. Guarda el recibo.' });
      if (nomina) {
        imprimirComprobantePago({
          consecutivoPago: res.consecutivoPago,
          fecha: res.fecha,
          hora: res.hora,
          quien: quien.nombreDefault,
          categoria: cat,
          periodo: null,
          origen,
          desc: desc.trim(),
          monto: montoNum,
          usuarioNombre: usuario.nombreDefault,
        });
      }
      limpiar();
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar el gasto.' });
    } finally {
      setGuardando(false);
    }
  }

  async function onAnular(g) {
    const motivo = window.prompt('¿Por qué se anula este gasto?');
    if (!motivo || !motivo.trim()) return;
    try {
      await anularGasto(g.id, motivo.trim(), usuario);
      await cargarLista();
    } catch (e) {
      alert('No se pudo anular: ' + e.message);
    }
  }

  const totalGastosReales = (lista || []).filter((g) => !g.anulado).reduce((s, g) => s + g.monto, 0);
  const comisionMonto = comisionHoy && comisionHoy.aplica ? comisionHoy.total : 0;
  const totalHoy = totalGastosReales + comisionMonto;

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>
          Gastos de hoy <span className="side">{totalHoy > 0 ? fmt(totalHoy) : ''}</span>
        </h2>

        {comisionMonto > 0 && (
          <div className="gasto-item">
            <div>
              <div className="gasto-nombre">
                Comisión <span style={{ fontSize: 11, color: 'var(--cian-fuerte)', fontWeight: 800, marginLeft: 4 }}>AUTOMÁTICA</span>
              </div>
              <div className="gasto-sub">
                {comisionHoy.prendas} prendas vendidas hoy · se la reparten Blanca y Sofía, sale sola de la caja
              </div>
            </div>
            <span className="gasto-monto">{fmt(comisionMonto)}</span>
          </div>
        )}

        {!lista ? (
          <div className="empty-lines">Cargando…</div>
        ) : lista.length === 0 && comisionMonto === 0 ? (
          <div className="empty-lines">Todavía no hay gastos hoy.</div>
        ) : (
          <>
            {lista.map((g) => (
              <div className="gasto-item" key={g.id} style={g.anulado ? { opacity: 0.45 } : {}}>
                <div>
                  <div className="gasto-nombre">
                    {g.quien ? `${g.categoria} · ${g.quien}` : g.categoria}
                    {g.anulado && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 6 }}>ANULADO</span>}
                  </div>
                  <div className="gasto-sub">
                    {g.hora} · {g.origen}
                    {g.desc ? ` · ${g.desc}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="gasto-monto">{fmt(g.monto)}</span>
                  {!g.anulado && (
                    <button className="gasto-x" title="Anular" onClick={() => onAnular(g)}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
            {(lista.length > 0 || comisionMonto > 0) && (
              <div className="gasto-item" style={{ borderBottom: 'none', paddingTop: 12 }}>
                <div className="gasto-nombre">Total del día</div>
                <span className="gasto-monto" style={{ fontSize: 22 }}>{fmt(totalHoy)}</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Nuevo gasto</h2>

          <div className="field">
            <label>Cuánto y de qué es</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                inputMode="numeric"
                placeholder="0"
                className="monto-grande"
                style={{ flex: 1 }}
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
            </div>
          </div>
          <div className="chips" style={{ marginBottom: 12 }}>
            {CATEGORIAS.map((c) => (
              <button
                key={c}
                className={`chip ${cat === c ? 'on' : ''}`}
                onClick={() => { setCat(c); setMsg({ tipo: '', texto: '' }); }}
              >
                {c}
              </button>
            ))}
          </div>

          {cat && (
            <>
              {nomina && (
                <>
                  <div className="paso">
                    <span className="paso-n">·</span> ¿A quién se le paga?
                  </div>
                  <div className="chips">
                    {vendedoras.map((u) => (
                      <button key={u.id} className={`chip ${quien?.id === u.id ? 'on' : ''}`} onClick={() => setQuien(u)}>
                        {u.nombreDefault}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="paso">
                <span className="paso-n">·</span> ¿De dónde sale?
              </div>
              <div className="chips">
                {ORIGENES.map((o) => (
                  <button key={o} className={`chip ${origen === o ? 'on' : ''}`} onClick={() => setOrigen(o)}>
                    {o}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Nota (opcional)"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                style={{ marginTop: 12 }}
              />

              <button className="btn" disabled={guardando} onClick={guardar} style={{ marginTop: 12 }}>
                {guardando ? 'Guardando…' : 'Registrar gasto'}
              </button>
            </>
          )}

          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      </div>
    </div>
  );
}
