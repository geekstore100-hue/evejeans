import { useEffect, useMemo, useRef, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { crearPedidoCompra, comprasRecientes, ajustarPedido } from '../lib/compras';
import { useBuscadorFiltro, CuadroBusqueda } from '../lib/buscadorFiltro';

const ORIGENES = ['Efectivo de la caja', 'Nequi del local', 'Datáfono del local', 'Transferencia bancaria', 'Lo puso Nelson'];

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Compras({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [carrito, setCarrito] = useState({}); // {id: {qty, costoUnitario}}
  const [proveedor, setProveedor] = useState('');
  const [origen, setOrigen] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [historial, setHistorial] = useState(null);
  const [editando, setEditando] = useState(null);

  useEffect(() => {
    const quitar = suscribirInventario(setInventario, (err) =>
      setErrorCarga('No se pudo leer el inventario: ' + err.message)
    );
    return quitar;
  }, []);

  useEffect(() => {
    cargarHistorial();
  }, []);

  async function cargarHistorial() {
    try {
      setHistorial(await comprasRecientes());
    } catch (e) {
      setHistorial([]);
    }
  }

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

  function agregar(id) {
    const it = porId[id];
    setCarrito((c) => ({
      ...c,
      [id]: { qty: (c[id]?.qty || 0) + 1, costoUnitario: c[id]?.costoUnitario ?? (it.costoCompra || 0) },
    }));
  }

  const busc = useBuscadorFiltro(nombreItemsTodos, precioItemsTodos);
  const buscadorRef = useRef(null);
  function quitarLinea(id) {
    setCarrito((c) => {
      const copia = { ...c };
      delete copia[id];
      return copia;
    });
  }
  function cambiarCosto(id, valor) {
    setCarrito((c) => ({ ...c, [id]: { ...c[id], costoUnitario: parseInt(valor) || 0 } }));
  }

  const lineas = Object.entries(carrito).map(([id, d]) => ({
    id,
    name: porId[id]?.name || id,
    qty: d.qty,
    costoUnitario: d.costoUnitario,
    total: d.qty * d.costoUnitario,
  }));
  const totalGeneral = lineas.reduce((s, l) => s + l.total, 0);

  function vaciar() {
    setCarrito({});
    setProveedor('');
    setOrigen(null);
    setNota('');
    setMsg({ tipo: '', texto: '' });
    buscadorRef.current?.focus();
  }

  async function confirmar() {
    setMsg({ tipo: '', texto: '' });
    if (lineas.length === 0) {
      setMsg({ tipo: 'bad', texto: 'Agrega al menos una referencia.' });
      return;
    }
    if (!proveedor.trim()) {
      setMsg({ tipo: 'bad', texto: 'Falta el proveedor.' });
      return;
    }
    if (lineas.some((l) => !l.costoUnitario || l.costoUnitario <= 0)) {
      setMsg({ tipo: 'bad', texto: 'Falta el costo unitario de alguna referencia.' });
      return;
    }
    if (!origen) {
      setMsg({ tipo: 'bad', texto: 'Falta decir de dónde sale la plata.' });
      return;
    }
    setGuardando(true);
    try {
      await crearPedidoCompra({
        items: lineas.map((l) => ({ id: l.id, name: l.name, cantidadPedida: l.qty, costoUnitario: l.costoUnitario })),
        proveedor,
        origen,
        nota: nota.trim(),
        usuario,
      });
      setMsg({
        tipo: 'good',
        texto: `Pedido registrado con ${proveedor}: ${fmt(totalGeneral)}. El stock sube cuando confirmen que llegó, en "Recibir mercancía".`,
      });
      vaciar();
      cargarHistorial();
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar el pedido.' });
    } finally {
      setGuardando(false);
      buscadorRef.current?.focus();
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
  if (!inventario) return <div className="loading">Cargando…</div>;

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>Qué se pidió</h2>
        <CuadroBusqueda
          ref={buscadorRef}
          busqueda={busc.busqueda}
          setBusqueda={busc.setBusqueda}
          busquedaMsg={busc.busquedaMsg}
          setBusquedaMsg={busc.setBusquedaMsg}
          onKeyDown={(e) => busc.manejarTecla(e, (item) => agregar(item.id))}
          autoFocus
        />
        <div className="cat-split">
          <div>
            <div className="split-label">Con nombre</div>
            <div className="tiles">
              {busc.nombreItems.map((it) => (
                <TileCompra
                  key={it.id}
                  item={it}
                  enCarrito={carrito[it.id]?.qty || 0}
                  onClick={() => agregar(it.id)}
                  seleccionado={busc.combinados[busc.selIndex]?.id === it.id}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="split-label">Por precio</div>
            <div className="tiles">
              {busc.precioItems.map((it) => (
                <TileCompra
                  key={it.id}
                  item={it}
                  enCarrito={carrito[it.id]?.qty || 0}
                  onClick={() => agregar(it.id)}
                  seleccionado={busc.combinados[busc.selIndex]?.id === it.id}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Nuevo pedido</h2>
          <div className="field">
            <label>Proveedor</label>
            <input type="text" placeholder="Nombre del proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
          </div>

          <div className="lines">
            {lineas.length === 0 ? (
              <div className="empty-lines">Toca una referencia para empezar.</div>
            ) : (
              lineas.map((l) => (
                <div key={l.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>
                      {l.name} <span className="qty">×{l.qty}</span>
                    </span>
                    <button tabIndex={-1} onClick={() => quitarLinea(l.id)} style={{ border: 'none', background: 'none', color: 'var(--danger)', fontSize: 18 }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                    <label style={{ fontSize: 12, marginBottom: 0, whiteSpace: 'nowrap' }}>Costo c/u</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={l.costoUnitario}
                      onChange={(e) => cambiarCosto(l.id, e.target.value)}
                      style={{ padding: 8, fontSize: 14 }}
                    />
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(l.total)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="totals">
            <div className="trow big">
              <span>Total pedido</span>
              <span className="v">{fmt(totalGeneral)}</span>
            </div>
          </div>

          <div className="field">
            <label>¿De dónde sale la plata?</label>
            <div className="chips">
              {ORIGENES.map((o) => (
                <button key={o} className={`chip ${origen === o ? 'on' : ''}`} onClick={() => setOrigen(o)}>{o}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Nota (opcional)</label>
            <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>

          <button className="btn" disabled={guardando} onClick={confirmar}>
            {guardando ? 'Guardando…' : 'Registrar pedido'}
          </button>
          <button className="btn ghost" onClick={vaciar}>Vaciar</button>
          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Historial de pedidos</h2>
        {!historial ? (
          <div className="empty-lines">Cargando…</div>
        ) : historial.length === 0 ? (
          <div className="empty-lines">Todavía no hay pedidos.</div>
        ) : (
          historial.map((c) =>
            editando === c.id ? (
              <FormularioAjuste
                key={c.id}
                pedido={c}
                onCancelar={() => setEditando(null)}
                onListo={async () => {
                  setEditando(null);
                  await cargarHistorial();
                }}
              />
            ) : (
              <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {c.fecha} {c.hora} · {c.proveedor}{' '}
                    <span
                      className="gasto-x"
                      style={{
                        display: 'inline-block', width: 'auto', height: 'auto', padding: '2px 8px',
                        fontSize: 10, fontWeight: 800, borderRadius: 5, verticalAlign: 'middle',
                        color: c.estado === 'confirmada' ? 'var(--ok)' : '#b8874a',
                        borderColor: c.estado === 'confirmada' ? 'var(--ok)' : '#b8874a',
                      }}
                    >
                      {c.estado === 'confirmada' ? 'CONFIRMADO' : 'PENDIENTE'}
                    </span>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>{fmt(c.totalGeneral)}</span>
                    {c.estado === 'pendiente' && (usuario.id === 'nelson' || c.usuarioId === usuario.id) && (
                      <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setEditando(c.id)}>
                        Ajustar
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3 }}>
                  {c.items.map((i) => `${i.name} ×${i.cantidadPedida}`).join(', ')} · {c.origen}
                  {c.usuarioNombre ? ` · pidió ${c.usuarioNombre}` : ''}
                  {c.nota ? ` · ${c.nota}` : ''}
                  {c.estado === 'confirmada' && ` · confirmó ${c.confirmadoPor} el ${c.confirmadoFecha}`}
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}

function FormularioAjuste({ pedido, onCancelar, onListo }) {
  const [cantidades, setCantidades] = useState(() => {
    const ini = {};
    pedido.items.forEach((i) => (ini[i.id] = String(i.cantidadPedida)));
    return ini;
  });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  async function guardar() {
    setMsg('');
    setGuardando(true);
    try {
      const itemsAjustados = pedido.items.map((i) => ({
        id: i.id,
        name: i.name,
        cantidadPedida: parseInt(cantidades[i.id]) || 0,
        costoUnitario: i.costoUnitario,
      }));
      await ajustarPedido(pedido.id, itemsAjustados);
      onListo();
    } catch (e) {
      setMsg('No se pudo ajustar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card modo-prueba" style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>
        Ajustar pedido — {pedido.proveedor}
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
        Cambia la cantidad pedida al número real que va a llegar, para que se pueda confirmar
        sin quedar trabado por un descuadre.
      </p>
      {pedido.items.map((i) => (
        <div className="field" key={i.id} style={{ marginBottom: 8 }}>
          <label>{i.name} · costo {fmt(i.costoUnitario)}</label>
          <input
            type="number"
            inputMode="numeric"
            value={cantidades[i.id]}
            onChange={(e) => setCantidades((c) => ({ ...c, [i.id]: e.target.value }))}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn ghost sm" style={{ width: 'auto' }} onClick={onCancelar}>Cancelar</button>
        <button className="btn sm" style={{ width: 'auto' }} disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar ajuste'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}

function TileCompra({ item, enCarrito, onClick, seleccionado }) {
  return (
    <button className={`tile ${seleccionado ? 'tile-sel' : ''}`} onClick={onClick} tabIndex={-1}>
      <div>
        <div className="tile-name">{item.name}</div>
        <div className="tile-price">
          {item.tipo === 'nombre' && `venta ${fmt(item.price)} · `}costo {fmt(item.costoCompra || 0)}
        </div>
      </div>
      <div className="tile-stock stock-ok">
        {item.stock || 0}
        <small>EN STOCK</small>
      </div>
      {enCarrito > 0 && <div className="tile-inbag">{enCarrito} pidiendo</div>}
    </button>
  );
}
