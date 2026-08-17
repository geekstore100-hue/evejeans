import { useEffect, useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import { suscribirConfig } from '../lib/config';
import { registrarGasto, anularGasto, comisionDeHoy, gastosDeHoy, esNomina } from '../lib/gastos';
import { imprimirComprobantePago } from '../lib/imprimir';

const CATEGORIAS = ['Sueldo', 'Comisión', 'Recibos', 'Otro'];
const ORIGENES = ['Efectivo de la caja', 'Nequi del local', 'Datáfono del local', 'Transferencia bancaria', 'Lo puso Nelson'];

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Gastos({ usuario }) {
  const [config, setConfig] = useState(null);
  const [lista, setLista] = useState(null);
  const [cat, setCat] = useState(null);
  const [quien, setQuien] = useState(null);
  const [periodo, setPeriodo] = useState('');
  const [monto, setMonto] = useState('');
  const [desc, setDesc] = useState('');
  const [origen, setOrigen] = useState(null);
  const [comision, setComision] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });

  const vendedoras = USUARIOS_BASE.filter((u) => u.id !== 'nelson');
  const nomina = esNomina(cat);

  useEffect(() => suscribirConfig(setConfig), []);
  useEffect(() => {
    cargarLista();
  }, []);

  async function cargarLista() {
    try {
      const g = await gastosDeHoy();
      setLista(g.sort((a, b) => (a.creadoEn?.seconds || 0) - (b.creadoEn?.seconds || 0)));
    } catch (e) {
      setLista([]);
    }
  }

  useEffect(() => {
    if (cat === 'Comisión' && config) {
      comisionDeHoy(config).then(setComision);
    } else {
      setComision(null);
    }
  }, [cat, config]);

  useEffect(() => {
    if (cat === 'Comisión' && comision && comision.aplica && !monto) {
      const yaPagado = (lista || [])
        .filter((g) => !g.anulado && g.categoria === 'Comisión')
        .reduce((s, g) => s + g.monto, 0);
      const falta = comision.total - yaPagado;
      if (falta > 0) setMonto(String(falta));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comision]);

  function limpiar() {
    setCat(null);
    setQuien(null);
    setPeriodo('');
    setMonto('');
    setDesc('');
    setOrigen(null);
    setComision(null);
  }

  async function guardar() {
    setMsg({ tipo: '', texto: '' });
    const montoNum = parseInt(monto) || 0;
    if (nomina && !quien) {
      setMsg({ tipo: 'bad', texto: 'Falta decir a quién se le paga.' });
      return;
    }
    if (nomina && !periodo.trim()) {
      setMsg({ tipo: 'bad', texto: 'Falta el período que se está pagando.' });
      return;
    }
    if (montoNum <= 0) {
      setMsg({ tipo: 'bad', texto: 'Falta escribir cuánto fue.' });
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
        periodo: periodo.trim(),
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
          periodo: periodo.trim(),
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

  const totalHoy = (lista || []).filter((g) => !g.anulado).reduce((s, g) => s + g.monto, 0);
  const yaPagadoComision = (lista || [])
    .filter((g) => !g.anulado && g.categoria === 'Comisión')
    .reduce((s, g) => s + g.monto, 0);

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>
          Gastos de hoy <span className="side">{totalHoy > 0 ? fmt(totalHoy) : ''}</span>
        </h2>
        {!lista ? (
          <div className="empty-lines">Cargando…</div>
        ) : lista.length === 0 ? (
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
                    {g.periodo ? ` · ${g.periodo}` : ''}
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
            <div className="gasto-item" style={{ borderBottom: 'none', paddingTop: 12 }}>
              <div className="gasto-nombre">Total del día</div>
              <span className="gasto-monto" style={{ fontSize: 22 }}>{fmt(totalHoy)}</span>
            </div>
          </>
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Nuevo gasto</h2>

          <div className="paso">
            <span className="paso-n">1</span> ¿De qué es?
          </div>
          <div className="chips">
            {CATEGORIAS.map((c) => (
              <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => { setCat(c); setMsg({ tipo: '', texto: '' }); }}>
                {c}
              </button>
            ))}
          </div>

          {cat && (
            <>
              {nomina && (
                <>
                  <div className="paso">
                    <span className="paso-n">2</span> ¿A quién y por qué período?
                  </div>
                  <div className="chips">
                    {vendedoras.map((u) => (
                      <button key={u.id} className={`chip ${quien?.id === u.id ? 'on' : ''}`} onClick={() => setQuien(u)}>
                        {u.nombreDefault}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Período. Ej: 1 al 15 de agosto"
                    value={periodo}
                    onChange={(e) => setPeriodo(e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                  {cat === 'Comisión' && comision && (
                    <div className={`msg ${comision.aplica ? 'good' : ''}`} style={{ textAlign: 'left', marginTop: 10 }}>
                      Hoy se vendieron <b>{comision.prendas}</b> prenda{comision.prendas === 1 ? '' : 's'} en total.{' '}
                      {comision.aplica ? (
                        <>Comisión del día: <b>{fmt(comision.total)}</b>.</>
                      ) : (
                        <>Se paga comisión desde {config?.comisionMinimo ?? 6} prendas.</>
                      )}
                      {yaPagadoComision > 0 && (
                        <>
                          <br />Ya se pagaron {fmt(yaPagadoComision)} · queda por repartir{' '}
                          <b>{fmt(Math.max(0, comision.total - yaPagadoComision))}</b>.
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="paso">
                <span className="paso-n">{nomina ? '3' : '2'}</span> ¿Cuánto?
              </div>
              <input
                type="number"
                inputMode="numeric"
                placeholder="0"
                className="monto-grande"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />

              <div className="paso">
                <span className="paso-n">{nomina ? '4' : '3'}</span> ¿De dónde sale?
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
