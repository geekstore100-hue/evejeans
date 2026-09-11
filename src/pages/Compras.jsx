import { useEffect, useMemo, useRef, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { crearPedidoCompra, comprasRecientes, ajustarPedido, eliminarPedido, nuevaLineaId, claveLinea } from '../lib/compras';
import { useBuscadorFiltro, CuadroBusqueda } from '../lib/buscadorFiltro';
import { soloDigitos, formatoPesos } from '../lib/formatoDinero';

// Igual que la pantalla de Fausto: un asistente paso a paso (elegir prenda ->
// cantidad/costo/nota de esa prenda -> ¿agregas otra factura? -> registrar),
// en vez del carrito de antes. A diferencia de la de Fausto, acá sí se pide
// proveedor y de dónde sale la plata (Fausto no lo necesita), y se conserva
// el buscador y el detalle de precio/stock en cada prenda, porque Nelson
// maneja muchas más referencias. El historial de abajo sigue mostrando los
// pedidos de TODOS los usuarios, como siempre.

const ORIGENES = ['Efectivo de la caja', 'Nequi del local', 'Datáfono del local', 'Transferencia bancaria'];
const NOTAS_SUGERIDAS = ['Short', 'Blusa', 'Faldas', 'Chaquetas de jean', 'Chaquetas de cuerina'];

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Compras({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [paso, setPaso] = useState('elegir'); // 'elegir' | 'todo' | 'decidir'
  const [pedido, setPedido] = useState([]); // [{lineaId, id, name, qty, costo, nota}]
  const [actual, setActual] = useState(null); // {id, name, qty, costo, nota} — la prenda que se está agregando ahora
  const [proveedor, setProveedor] = useState('');
  const [origen, setOrigen] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [historial, setHistorial] = useState(null);
  const [editando, setEditando] = useState(null);
  const [eliminando, setEliminando] = useState(null);
  const [msgEliminar, setMsgEliminar] = useState('');
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(null);
  const [costoSospechoso, setCostoSospechoso] = useState(false);
  // Por debajo de esto casi seguro faltó escribir uno o más ceros (ej. "40" en
  // vez de "40.000") — no se bloquea del todo, pero toca confirmarlo aparte.
  const UMBRAL_COSTO_BAJO = 5000;

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

  // Primero las referencias "con nombre" (orden alfabético), y después las
  // "por precio" en orden ascendente.
  const itemsNombre = useMemo(
    () =>
      (inventario || [])
        .filter((i) => i.tipo === 'nombre' && !i.oculto)
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [inventario]
  );
  const itemsPrecio = useMemo(
    () =>
      (inventario || [])
        .filter((i) => i.tipo === 'precio' && !i.oculto)
        .sort((a, b) => (a.price || 0) - (b.price || 0)),
    [inventario]
  );

  const busc = useBuscadorFiltro(itemsNombre, itemsPrecio);
  const buscadorRef = useRef(null);

  // Tocar una prenda (o buscarla y darle Enter) empieza a agregar UNA línea
  // nueva de esa referencia — si la misma referencia se compra más de una vez
  // en el mismo pedido (ej. dos facturas distintas del mismo proveedor), se
  // vuelve a elegir más adelante y queda como otra línea aparte.
  function elegir(it) {
    setMsg({ tipo: '', texto: '' });
    // La nota queda precargada con la última que se usó para esta misma
    // referencia, para que no quede escrita un poco distinta cada vez.
    setActual({ id: it.id, name: it.name, qty: 1, costo: '', nota: it.ultimaNota || '' });
    setCostoSospechoso(false);
    setPaso('todo');
  }

  function sumarUno(delta) {
    setActual((a) => ({ ...a, qty: Math.max(1, (a.qty || 1) + delta) }));
  }
  function cambiarCantidad(valor) {
    setActual((a) => ({ ...a, qty: Math.max(1, parseInt(valor) || 1) }));
  }
  function cambiarCosto(valor) {
    setActual((a) => ({ ...a, costo: valor }));
    // Si ya había salido la advertencia de precio muy bajo y vuelve a tocar el
    // campo, se quita — el número cambió, toca revisarlo de nuevo.
    setCostoSospechoso(false);
  }
  function cambiarNota(valor) {
    setActual((a) => ({ ...a, nota: valor }));
  }
  function elegirNota(n) {
    setActual((a) => ({ ...a, nota: n }));
  }

  function volverAElegir() {
    setActual(null);
    setPaso('elegir');
  }

  function agregarPrenda() {
    setMsg({ tipo: '', texto: '' });
    const costoNum = parseInt(actual.costo) || 0;
    if (costoNum <= 0) {
      setMsg({ tipo: 'bad', texto: 'Falta el precio de compra.' });
      return;
    }
    if (costoNum < UMBRAL_COSTO_BAJO) {
      setCostoSospechoso(true);
      return;
    }
    agregarPrendaDefinitivo(costoNum);
  }

  function agregarPrendaDefinitivo(costoNum) {
    setPedido((p) => [
      ...p,
      {
        lineaId: nuevaLineaId(),
        id: actual.id,
        name: actual.name,
        qty: actual.qty,
        costo: costoNum,
        nota: actual.nota.trim(),
      },
    ]);
    setActual(null);
    setCostoSospechoso(false);
    setPaso('decidir');
  }

  function confirmarCostoBajo() {
    agregarPrendaDefinitivo(parseInt(actual.costo) || 0);
  }

  function otraFactura() {
    setPaso('elegir');
  }

  function eliminarLinea(lineaId) {
    const nuevo = pedido.filter((l) => l.lineaId !== lineaId);
    setPedido(nuevo);
    if (nuevo.length === 0) setPaso('elegir');
  }

  const totalPedido = pedido.reduce((s, l) => s + l.qty * l.costo, 0);

  function cancelarPedido() {
    setPedido([]);
    setActual(null);
    setProveedor('');
    setOrigen(null);
    setPaso('elegir');
    setMsg({ tipo: '', texto: '' });
    buscadorRef.current?.focus();
  }

  async function registrar() {
    setMsg({ tipo: '', texto: '' });
    if (pedido.length === 0) return;
    if (!proveedor.trim()) {
      setMsg({ tipo: 'bad', texto: 'Falta el proveedor.' });
      return;
    }
    if (!origen) {
      setMsg({ tipo: 'bad', texto: 'Falta decir de dónde sale la plata.' });
      return;
    }
    setGuardando(true);
    try {
      await crearPedidoCompra({
        items: pedido.map((l) => ({
          id: l.id,
          lineaId: l.lineaId,
          name: l.name,
          cantidadPedida: l.qty,
          costoUnitario: l.costo,
          nota: l.nota,
        })),
        proveedor,
        origen,
        usuario,
      });
      setMsg({
        tipo: 'good',
        texto: `Pedido registrado con ${proveedor}: ${fmt(totalPedido)}. El stock sube cuando confirmen que llegó, en "Recibir mercancía".`,
      });
      setPedido([]);
      setProveedor('');
      setOrigen(null);
      setPaso('elegir');
      cargarHistorial();
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar el pedido.' });
    } finally {
      setGuardando(false);
      buscadorRef.current?.focus();
    }
  }

  async function eliminarDelHistorial(c) {
    setConfirmandoEliminar(null);
    setMsgEliminar('');
    setEliminando(c.id);
    try {
      await eliminarPedido(c.id);
      await cargarHistorial();
    } catch (e) {
      setMsgEliminar('No se pudo eliminar: ' + e.message);
    } finally {
      setEliminando(null);
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
      {paso === 'elegir' && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Nuevo pedido — ¿qué compraste?</h2>
          <CuadroBusqueda
            ref={buscadorRef}
            busqueda={busc.busqueda}
            setBusqueda={busc.setBusqueda}
            busquedaMsg={busc.busquedaMsg}
            setBusquedaMsg={busc.setBusquedaMsg}
            onKeyDown={(e) => busc.manejarTecla(e, (item) => elegir(item))}
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
                    onClick={() => elegir(it)}
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
                    onClick={() => elegir(it)}
                    seleccionado={busc.combinados[busc.selIndex]?.id === it.id}
                  />
                ))}
              </div>
            </div>
          </div>
          {pedido.length > 0 && (
            <button className="btn ghost sm" style={{ width: 'auto', marginTop: 12 }} onClick={() => setPaso('decidir')}>
              Volver al pedido en curso ({pedido.length})
            </button>
          )}
          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      )}

      {paso === 'todo' && actual && (
        <div className="card" style={{ gridColumn: '1 / -1', maxWidth: 460 }}>
          <button className="btn ghost sm" style={{ width: 'auto', marginBottom: 10 }} onClick={volverAElegir}>
            ‹ Volver
          </button>
          <h2>{actual.name}</h2>

          <div className="field">
            <label>¿Cuántas?</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn ghost sm" style={{ width: 44 }} type="button" onClick={() => sumarUno(-1)}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={actual.qty}
                onFocus={(e) => e.target.select()}
                onChange={(e) => cambiarCantidad(e.target.value)}
                style={{ textAlign: 'center', width: 80 }}
              />
              <button className="btn ghost sm" style={{ width: 44 }} type="button" onClick={() => sumarUno(1)}>
                +
              </button>
            </div>
          </div>

          <div className="field">
            <label>Precio de compra</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="$0"
              value={formatoPesos(actual.costo)}
              onFocus={(e) => e.target.select()}
              onChange={(e) => cambiarCosto(soloDigitos(e.target.value))}
            />
          </div>

          <div className="field">
            <label>Nota (opcional)</label>
            <input type="text" value={actual.nota} onFocus={(e) => e.target.select()} onChange={(e) => cambiarNota(e.target.value)} />
            <div className="chips" style={{ marginTop: 6 }}>
              {NOTAS_SUGERIDAS.map((n) => (
                <button key={n} type="button" className="chip" onClick={() => elegirNota(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {costoSospechoso && (
            <div
              style={{
                background: 'var(--danger-soft)',
                border: '2px solid var(--danger)',
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 12,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 900, color: 'var(--danger)' }}>
                ⚠️ ¿Seguro que el precio de compra es {fmt(parseInt(actual.costo) || 0)}?
              </div>
              <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 4, marginBottom: 10 }}>
                Se ve muy bajo — revisa que no falten ceros.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setCostoSospechoso(false)}>
                  No, corregirlo
                </button>
                <button
                  className="btn sm"
                  style={{ width: 'auto', background: 'var(--danger)', borderColor: 'var(--danger)' }}
                  onClick={confirmarCostoBajo}
                >
                  Sí, es correcto
                </button>
              </div>
            </div>
          )}

          <button className="btn" onClick={agregarPrenda}>
            Agregar esta prenda
          </button>
          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      )}

      {paso === 'decidir' && (
        <div className="card" style={{ gridColumn: '1 / -1', maxWidth: 520 }}>
          <h2>Nuevo pedido</h2>
          {pedido.map((l, idx) => (
            <div key={l.lineaId} style={{ border: '2px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {l.name}
                    {l.nota ? ` (${l.nota})` : ''}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--rosa-fuerte)', marginTop: 2 }}>
                    Factura #{idx + 1}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
                    {l.qty} × {fmt(l.costo)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>{fmt(l.qty * l.costo)}</span>
                  <button
                    title="Eliminar esta línea"
                    onClick={() => eliminarLinea(l.lineaId)}
                    style={{ border: 'none', background: 'none', color: 'var(--danger)', fontSize: 18 }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="totals">
            <div className="trow big">
              <span>Total de grupo de facturas</span>
              <span className="v">{fmt(totalPedido)}</span>
            </div>
          </div>

          <div className="field">
            <label>Proveedor</label>
            <input type="text" placeholder="Nombre del proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
          </div>
          <div className="field">
            <label>¿De dónde sale la plata?</label>
            <div className="chips">
              {ORIGENES.map((o) => (
                <button key={o} className={`chip ${origen === o ? 'on' : ''}`} onClick={() => setOrigen(o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            <button className="btn ghost" onClick={otraFactura}>
              Agregar otra factura
            </button>
            <button className="btn" disabled={guardando} onClick={registrar}>
              {guardando ? 'Guardando…' : 'Registrar pedido'}
            </button>
            <button className="btn ghost sm" style={{ width: 'auto', alignSelf: 'center' }} onClick={cancelarPedido}>
              Cancelar pedido
            </button>
          </div>
          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      )}

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
                itemsNombre={itemsNombre}
                itemsPrecio={itemsPrecio}
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
                    {c.fecha} {c.hora}
                    {c.proveedor ? ` · ${c.proveedor}` : ''}{' '}
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
                    {c.estado === 'pendiente' && (usuario.id === 'nelson' || c.usuarioId === usuario.id) && confirmandoEliminar !== c.id && (
                      <button
                        className="btn ghost sm"
                        style={{ width: 'auto', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        onClick={() => setConfirmandoEliminar(c.id)}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3 }}>
                  {c.items.map((i) => `${i.name}${i.nota ? ` (${i.nota})` : ''} ×${i.cantidadPedida}`).join(', ')}
                  {c.origen ? ` · ${c.origen}` : ''}
                  {c.usuarioNombre ? ` · pidió ${c.usuarioNombre}` : ''}
                  {c.estado === 'confirmada' && ` · confirmó ${c.confirmadoPor} el ${c.confirmadoFecha}`}
                </div>
                {confirmandoEliminar === c.id && (
                  <div
                    style={{
                      background: 'var(--danger-soft)',
                      border: '2px solid var(--danger)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      marginTop: 8,
                    }}
                  >
                    <div style={{ fontWeight: 800, color: 'var(--danger)', marginBottom: 8 }}>
                      ¿Seguro que quieres eliminar este pedido?
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        className="btn sm"
                        style={{ width: 'auto', background: 'var(--danger)', borderColor: 'var(--danger)' }}
                        disabled={eliminando === c.id}
                        onClick={() => eliminarDelHistorial(c)}
                      >
                        {eliminando === c.id ? 'Eliminando…' : 'Sí, eliminar'}
                      </button>
                      <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setConfirmandoEliminar(null)}>
                        No
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          )
        )}
        {msgEliminar && <div className="msg bad">{msgEliminar}</div>}
      </div>
    </div>
  );
}

function FormularioAjuste({ pedido, itemsNombre, itemsPrecio, onCancelar, onListo }) {
  const [cantidades, setCantidades] = useState(() => {
    const ini = {};
    pedido.items.forEach((i) => (ini[claveLinea(i)] = String(i.cantidadPedida)));
    return ini;
  });
  // Qué referencia de inventario quedó elegida para cada línea — por defecto
  // la misma con la que se registró, pero se puede cambiar por si se eligió
  // la categoría equivocada al hacer el pedido.
  const [prendas, setPrendas] = useState(() => {
    const ini = {};
    pedido.items.forEach((i) => (ini[claveLinea(i)] = i.id));
    return ini;
  });
  // El precio de compra también se puede corregir — por defecto el mismo con
  // el que se registró.
  const [costos, setCostos] = useState(() => {
    const ini = {};
    pedido.items.forEach((i) => (ini[claveLinea(i)] = String(i.costoUnitario || '')));
    return ini;
  });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const todasLasPrendas = [...(itemsNombre || []), ...(itemsPrecio || [])];
  function nombreDe(id) {
    return todasLasPrendas.find((it) => it.id === id)?.name || id;
  }

  async function guardar() {
    setMsg('');
    setGuardando(true);
    try {
      const itemsAjustados = pedido.items.map((i) => {
        const nuevoId = prendas[claveLinea(i)];
        return {
          id: nuevoId,
          lineaId: i.lineaId,
          name: nombreDe(nuevoId),
          cantidadPedida: parseInt(cantidades[claveLinea(i)]) || 0,
          costoUnitario: parseInt(costos[claveLinea(i)]) || 0,
          nota: i.nota,
        };
      });
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
        Ajustar pedido{pedido.proveedor ? ` — ${pedido.proveedor}` : ''}
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
        Cambia la cantidad, el precio de compra, o la referencia si se eligió la prenda
        equivocada, para que se pueda confirmar sin quedar trabado por un descuadre.
      </p>
      {pedido.items.map((i, idx) => (
        <div
          key={claveLinea(i)}
          style={{ border: '2px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 12 }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--rosa-fuerte)', textTransform: 'uppercase', marginBottom: 8 }}>
            Factura #{idx + 1}
            {i.nota ? ` — ${i.nota}` : ''}
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>Prenda</label>
            <select
              value={prendas[claveLinea(i)]}
              onChange={(e) => setPrendas((p) => ({ ...p, [claveLinea(i)]: e.target.value }))}
            >
              <optgroup label="Con nombre">
                {(itemsNombre || []).map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Por precio">
                {(itemsPrecio || []).map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Precio de compra</label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="$0"
                value={formatoPesos(costos[claveLinea(i)])}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setCostos((c) => ({ ...c, [claveLinea(i)]: soloDigitos(e.target.value) }))}
              />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Cantidad</label>
              <input
                type="number"
                inputMode="numeric"
                value={cantidades[claveLinea(i)]}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setCantidades((c) => ({ ...c, [claveLinea(i)]: e.target.value }))}
              />
            </div>
          </div>
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

function TileCompra({ item, onClick, seleccionado }) {
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
    </button>
  );
}
