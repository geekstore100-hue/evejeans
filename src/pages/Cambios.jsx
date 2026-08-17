import { useEffect, useMemo, useState } from 'react';
import { registrarCambio } from '../lib/cambios';
import { suscribirInventario } from '../lib/inventario';
import { imprimirTicketCambio } from '../lib/imprimir';
import { useBuscadorFiltro, CuadroBusqueda } from '../lib/buscadorFiltro';

const MEDIOS = ['Efectivo', 'Datáfono', 'Nequi', 'Addi', 'PTM', 'Sistecrédito'];

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Cambios({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [devuelve, setDevuelve] = useState({});
  const [lleva, setLleva] = useState({});
  const [pagoDif, setPagoDif] = useState('Efectivo');
  const [procesando, setProcesando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });

  useEffect(() => {
    const quitar = suscribirInventario(setInventario, (err) =>
      setErrorCarga('No se pudo leer el inventario: ' + err.message)
    );
    return quitar;
  }, []);

  const porId = useMemo(() => {
    const m = {};
    (inventario || []).forEach((i) => (m[i.id] = i));
    return m;
  }, [inventario]);

  const nombreItemsTodos = (inventario || [])
    .filter((i) => i.tipo === 'nombre' && !i.oculto)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const precioItemsTodos = (inventario || [])
    .filter((i) => i.tipo === 'precio' && !i.oculto)
    .sort((a, b) => a.price - b.price);

  function agregarDevuelve(id) {
    setDevuelve((d) => ({ ...d, [id]: (d[id] || 0) + 1 }));
  }
  function agregarLleva(id) {
    const it = porId[id];
    const yaEnLleva = lleva[id] || 0;
    if (!it || (it.stock || 0) - yaEnLleva <= 0) return false;
    setLleva((l) => ({ ...l, [id]: (l[id] || 0) + 1 }));
  }

  const buscDev = useBuscadorFiltro(nombreItemsTodos, precioItemsTodos);
  const buscLlv = useBuscadorFiltro(nombreItemsTodos, precioItemsTodos);

  const lineasDevuelve = Object.entries(devuelve)
    .filter(([, q]) => q > 0)
    .map(([id, qty]) => ({ id, qty, name: porId[id]?.name || id, price: porId[id]?.price || 0 }));
  const lineasLleva = Object.entries(lleva)
    .filter(([, q]) => q > 0)
    .map(([id, qty]) => ({ id, qty, name: porId[id]?.name || id, price: porId[id]?.price || 0 }));

  const valDev = lineasDevuelve.reduce((s, l) => s + l.price * l.qty, 0);
  const valLlv = lineasLleva.reduce((s, l) => s + l.price * l.qty, 0);
  const diferencia = valLlv - valDev;

  function limpiarCampos() {
    setDevuelve({});
    setLleva({});
    setPagoDif('Efectivo');
  }
  function vaciar() {
    limpiarCampos();
    setMsg({ tipo: '', texto: '' });
  }

  async function confirmar() {
    setMsg({ tipo: '', texto: '' });
    setProcesando(true);
    try {
      const res = await registrarCambio({
        usuario,
        devuelve: lineasDevuelve,
        lleva: lineasLleva,
        pagoDif: diferencia > 0 ? pagoDif : null,
      });
      setMsg({ tipo: 'good', texto: `Cambio N.º ${res.num} registrado.` });
      imprimirTicketCambio({
        num: res.num,
        fecha: new Date().toISOString().slice(0, 10),
        hora: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        usuarioNombre: usuario.nombreDefault,
        devuelve: lineasDevuelve,
        lleva: lineasLleva,
        valDev: res.valDev,
        valLlv: res.valLlv,
        diferencia: res.diferencia,
        pago: diferencia > 0 ? pagoDif : null,
      });
      limpiarCampos();
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar el cambio.' });
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="sale-grid">
      {errorCarga ? (
        <div className="card" style={{ maxWidth: 460 }}>
          <h2>No se pudo cargar</h2>
          <p style={{ fontSize: 14, color: 'var(--danger)' }}>{errorCarga}</p>
        </div>
      ) : !inventario ? (
        <div className="loading">Cargando inventario…</div>
      ) : (
        <>
          <div className="card">
            <h2>1 · Qué devuelve el cliente</h2>
            <CuadroBusqueda
              busqueda={buscDev.busqueda}
              setBusqueda={buscDev.setBusqueda}
              busquedaMsg={buscDev.busquedaMsg}
              setBusquedaMsg={buscDev.setBusquedaMsg}
              onKeyDown={(e) => buscDev.manejarTecla(e, (item) => agregarDevuelve(item.id))}
              tabIndex={1}
              autoFocus
            />
            <div className="cat-split">
              <div>
                <div className="split-label">Con nombre</div>
                <div className="tiles">
                  {buscDev.nombreItems.map((it) => (
                    <TileSimple
                      key={it.id}
                      item={it}
                      cantidad={devuelve[it.id] || 0}
                      onClick={() => agregarDevuelve(it.id)}
                      seleccionado={buscDev.combinados[buscDev.selIndex]?.id === it.id}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="split-label">Por precio</div>
                <div className="tiles">
                  {buscDev.precioItems.map((it) => (
                    <TileSimple
                      key={it.id}
                      item={it}
                      cantidad={devuelve[it.id] || 0}
                      onClick={() => agregarDevuelve(it.id)}
                      seleccionado={buscDev.combinados[buscDev.selIndex]?.id === it.id}
                    />
                  ))}
                </div>
              </div>
            </div>

            <h2 style={{ marginTop: 20 }}>2 · Qué se lleva</h2>
            <CuadroBusqueda
              busqueda={buscLlv.busqueda}
              setBusqueda={buscLlv.setBusqueda}
              busquedaMsg={buscLlv.busquedaMsg}
              setBusquedaMsg={buscLlv.setBusquedaMsg}
              onKeyDown={(e) =>
                buscLlv.manejarTecla(e, (item) => {
                  const disp = (item.stock || 0) - (lleva[item.id] || 0);
                  if (disp <= 0) {
                    buscLlv.setBusquedaMsg(`"${item.name}" no tiene disponible.`);
                    return false;
                  }
                  agregarLleva(item.id);
                })
              }
              tabIndex={2}
            />
            <div className="cat-split">
              <div>
                <div className="split-label">Con nombre</div>
                <div className="tiles">
                  {buscLlv.nombreItems.map((it) => {
                    const disp = (it.stock || 0) - (lleva[it.id] || 0);
                    return (
                      <TileSimple
                        key={it.id}
                        item={it}
                        disponible={disp}
                        cantidad={lleva[it.id] || 0}
                        onClick={() => agregarLleva(it.id)}
                        seleccionado={buscLlv.combinados[buscLlv.selIndex]?.id === it.id}
                      />
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="split-label">Por precio</div>
                <div className="tiles">
                  {buscLlv.precioItems.map((it) => {
                    const disp = (it.stock || 0) - (lleva[it.id] || 0);
                    return (
                      <TileSimple
                        key={it.id}
                        item={it}
                        disponible={disp}
                        cantidad={lleva[it.id] || 0}
                        onClick={() => agregarLleva(it.id)}
                        seleccionado={buscLlv.combinados[buscLlv.selIndex]?.id === it.id}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="ticket">
            <div className="card">
              <h2>Resumen del cambio</h2>

              {lineasDevuelve.length === 0 && lineasLleva.length === 0 ? (
                <div className="empty-lines">Elige qué devuelve el cliente para empezar.</div>
              ) : (
                <>
                  <div className="split-label">Devuelve</div>
                  <div className="lines" style={{ maxHeight: 140 }}>
                    {lineasDevuelve.map((l) => (
                      <div className="line" key={l.id}>
                        <span>
                          {l.name} <span className="qty">×{l.qty}</span>
                        </span>
                        <span className="amt">{fmt(l.price * l.qty)}</span>
                        <button tabIndex={-1} onClick={() => setDevuelve((d) => ({ ...d, [l.id]: 0 }))}>✕</button>
                      </div>
                    ))}
                  </div>

                  <div className="split-label" style={{ marginTop: 12 }}>
                    Se lleva
                  </div>
                  <div className="lines" style={{ maxHeight: 140 }}>
                    {lineasLleva.map((l) => (
                      <div className="line" key={l.id}>
                        <span>
                          {l.name} <span className="qty">×{l.qty}</span>
                        </span>
                        <span className="amt">{fmt(l.price * l.qty)}</span>
                        <button tabIndex={-1} onClick={() => setLleva((d) => ({ ...d, [l.id]: 0 }))}>✕</button>
                      </div>
                    ))}
                  </div>

                  <div className="totals">
                    <div className="trow">
                      <span>Devuelve</span>
                      <span className="v">{fmt(valDev)}</span>
                    </div>
                    <div className="trow">
                      <span>Se lleva</span>
                      <span className="v">{fmt(valLlv)}</span>
                    </div>
                    <div className="trow big">
                      <span>Diferencia</span>
                      <span className="v">{diferencia === 0 ? fmt(0) : (diferencia > 0 ? '+' : '−') + fmt(Math.abs(diferencia))}</span>
                    </div>
                  </div>

                  {valDev === 0 || valLlv === 0 ? (
                    <div className="msg">Falta completar ambos lados.</div>
                  ) : diferencia === 0 ? (
                    <div className="msg good">Cambio parejo. No hay plata de por medio.</div>
                  ) : diferencia > 0 ? (
                    <div className="field">
                      <label>El cliente paga la diferencia con</label>
                      <div className="chips">
                        {MEDIOS.map((m) => (
                          <button key={m} tabIndex={-1} className={`chip ${pagoDif === m ? 'on' : ''}`} onClick={() => setPagoDif(m)}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="msg bad">
                      Le quedan {fmt(-diferencia)} a favor. No se devuelve dinero: debe llevar otra
                      prenda hasta completar.
                    </div>
                  )}

                  {valDev > 0 && valLlv > 0 && diferencia >= 0 && (
                    <button className="btn" tabIndex={3} disabled={procesando} onClick={confirmar}>
                      {procesando ? 'Registrando…' : 'Registrar cambio'}
                    </button>
                  )}
                  <button className="btn ghost" tabIndex={4} onClick={vaciar}>
                    Cancelar
                  </button>
                </>
              )}
              {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TileSimple({ item, disponible, cantidad, onClick, seleccionado }) {
  const bloqueado = disponible !== undefined && disponible <= 0;
  return (
    <button className={`tile ${seleccionado ? 'tile-sel' : ''}`} disabled={bloqueado} onClick={onClick} tabIndex={-1}>
      <div>
        <div className="tile-name">{item.name}</div>
        {item.tipo === 'nombre' && <div className="tile-price">{fmt(item.price)}</div>}
      </div>
      {disponible !== undefined && (
        <div className={`tile-stock ${disponible <= 0 ? 'stock-zero' : disponible <= 5 ? 'stock-low' : 'stock-ok'}`}>
          {disponible}
          <small>DISP.</small>
        </div>
      )}
      {cantidad > 0 && <div className="tile-inbag">{cantidad}</div>}
    </button>
  );
}
