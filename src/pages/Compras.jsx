import { useEffect, useMemo, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { registrarCompra, comprasRecientes } from '../lib/compras';

const ORIGENES = ['Efectivo de la caja', 'Nequi del local', 'Datáfono del local', 'Transferencia bancaria', 'Lo puso Nelson'];

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Compras() {
  const [inventario, setInventario] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [carrito, setCarrito] = useState({}); // {id: {qty, costoUnitario}}
  const [proveedor, setProveedor] = useState('');
  const [origen, setOrigen] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [historial, setHistorial] = useState(null);

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

  const nombreItems = (inventario || []).filter((i) => i.tipo === 'nombre' && !i.oculto);
  const precioItems = (inventario || []).filter((i) => i.tipo === 'precio' && !i.oculto);

  function agregar(id) {
    const it = porId[id];
    setCarrito((c) => ({
      ...c,
      [id]: { qty: (c[id]?.qty || 0) + 1, costoUnitario: c[id]?.costoUnitario ?? (it.costoCompra || 0) },
    }));
  }
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
  }

  async function confirmar() {
    setMsg({ tipo: '', texto: '' });
    if (lineas.length === 0) {
      setMsg({ tipo: 'bad', texto: 'Agrega al menos una referencia.' });
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
      await registrarCompra({
        items: lineas.map((l) => ({ id: l.id, name: l.name, qty: l.qty, costoUnitario: l.costoUnitario, stockActual: porId[l.id]?.stock || 0 })),
        proveedor: proveedor.trim(),
        origen,
        nota: nota.trim(),
      });
      setMsg({ tipo: 'good', texto: `Compra registrada: ${fmt(totalGeneral)}. El stock y el costo ya quedaron actualizados.` });
      vaciar();
      cargarHistorial();
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar la compra.' });
    } finally {
      setGuardando(false);
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
        <h2>Qué llegó</h2>
        <div className="cat-split">
          <div>
            <div className="split-label">Con nombre</div>
            <div className="tiles">
              {nombreItems.map((it) => (
                <TileCompra key={it.id} item={it} enCarrito={carrito[it.id]?.qty || 0} onClick={() => agregar(it.id)} />
              ))}
            </div>
          </div>
          <div>
            <div className="split-label">Por precio</div>
            <div className="tiles">
              {precioItems.map((it) => (
                <TileCompra key={it.id} item={it} enCarrito={carrito[it.id]?.qty || 0} onClick={() => agregar(it.id)} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Nueva compra</h2>
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
                    <button onClick={() => quitarLinea(l.id)} style={{ border: 'none', background: 'none', color: 'var(--danger)', fontSize: 18 }}>✕</button>
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
              <span>Total</span>
              <span className="v">{fmt(totalGeneral)}</span>
            </div>
          </div>

          <div className="field">
            <label>Proveedor (opcional)</label>
            <input type="text" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
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
            {guardando ? 'Guardando…' : 'Registrar compra'}
          </button>
          <button className="btn ghost" onClick={vaciar}>Vaciar</button>
          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Compras recientes</h2>
        {!historial ? (
          <div className="empty-lines">Cargando…</div>
        ) : historial.length === 0 ? (
          <div className="empty-lines">Todavía no hay compras registradas.</div>
        ) : (
          historial.map((c) => (
            <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  {c.fecha} {c.hora}{c.proveedor ? ` · ${c.proveedor}` : ''}
                </span>
                <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>{fmt(c.totalGeneral)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3 }}>
                {c.items.map((i) => `${i.name} ×${i.qty}`).join(', ')} · {c.origen}
                {c.nota ? ` · ${c.nota}` : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TileCompra({ item, enCarrito, onClick }) {
  return (
    <button className="tile" onClick={onClick}>
      <div>
        <div className="tile-name">{item.name}</div>
        <div className="tile-price">venta {fmt(item.price)} · costo {fmt(item.costoCompra || 0)}</div>
      </div>
      <div className="tile-stock stock-ok">
        {item.stock || 0}
        <small>EN STOCK</small>
      </div>
      {enCarrito > 0 && <div className="tile-inbag">{enCarrito} comprando</div>}
    </button>
  );
}
