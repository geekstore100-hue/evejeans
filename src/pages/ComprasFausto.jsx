import { useEffect, useMemo, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { crearPedidoCompra, comprasDeUsuario, ajustarPedido, eliminarPedido, nuevaLineaId, claveLinea } from '../lib/compras';

// Versión simplificada de Compras, pensada para Fausto: letra grande, un solo
// paso a la vez (elegir prenda -> cantidad, costo y nota de esa prenda ->
// ¿agregas otra? -> registrar), sin nada que no necesite (buscador, origen
// del dinero, historial completo, atajos de teclado, etc.). El historial de
// TODOS los pedidos lo sigue viendo Nelson desde su propia pantalla de
// Compras — acá solo se ven los últimos pedidos DE FAUSTO, por si hay que
// corregir alguno.

const NOTAS_SUGERIDAS = ['Short', 'Blusa', 'Chaquetas', 'Faldas'];

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function ComprasFausto({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [paso, setPaso] = useState('elegir'); // 'elegir' | 'todo' | 'decidir'
  const [pedido, setPedido] = useState([]); // [{lineaId, id, name, qty, costo, nota}]
  const [actual, setActual] = useState(null); // {id, name, qty, costo, nota} — la prenda que se está agregando ahora
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [exito, setExito] = useState(null); // { total } | null
  const [misPedidos, setMisPedidos] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [eliminando, setEliminando] = useState(null);
  const [msgEliminar, setMsgEliminar] = useState('');

  useEffect(() => {
    const quitar = suscribirInventario(setInventario, (err) =>
      setErrorCarga('No se pudo leer el inventario: ' + err.message)
    );
    return quitar;
  }, []);

  useEffect(() => {
    cargarMisPedidos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarMisPedidos() {
    try {
      const mios = await comprasDeUsuario(usuario.id);
      // TODOS los pendientes se muestran siempre, sin importar cuántos haya
      // — si no, uno viejo se puede quedar sin poder corregirse ni
      // eliminarse solo porque hubo varios pedidos después (de él mismo o de
      // Nelson). De los ya confirmados, con los últimos 5 basta (son solo
      // para mirar, ya no se pueden tocar).
      const pendientes = mios.filter((c) => c.estado === 'pendiente');
      const confirmadas = mios.filter((c) => c.estado !== 'pendiente').slice(0, 5);
      setMisPedidos([...pendientes, ...confirmadas]);
    } catch (e) {
      setMisPedidos([]);
    }
  }

  // Primero las referencias "con nombre" (orden alfabético), y después las "por
  // precio" en orden ascendente — sin buscador: son pocas y así siempre están en
  // el mismo lugar, más fácil de recordar dónde está cada una.
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

  // Tocar una prenda empieza a agregar UNA línea nueva de esa referencia — si
  // la misma referencia llegó en más de un tipo (ej. 10 chaquetas y 20
  // pantalones, ambas a $60.000), se toca la prenda otra vez más adelante y
  // queda como otra línea aparte, cada una con su propia cantidad, costo y
  // nota.
  function elegir(it) {
    setMsg({ tipo: '', texto: '' });
    // La nota queda precargada con la última que se usó para esta misma
    // referencia — para que si es lo mismo de siempre, no toque volver a
    // escribirla (y así no queda un poco distinta cada vez, por ejemplo
    // "Chaquetas jean" una vez y "Chaqueta de jean" la siguiente).
    setActual({ id: it.id, name: it.name, qty: 1, costo: '', nota: it.ultimaNota || '' });
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
    setPaso('decidir');
  }

  function otraPrenda() {
    setPaso('elegir');
  }

  async function eliminar(c) {
    const ok = window.confirm(
      `¿Eliminar este pedido de ${fmt(c.totalGeneral)}? No se puede deshacer.`
    );
    if (!ok) return;
    setMsgEliminar('');
    setEliminando(c.id);
    try {
      await eliminarPedido(c.id);
      await cargarMisPedidos();
    } catch (e) {
      setMsgEliminar('No se pudo eliminar: ' + e.message);
    } finally {
      setEliminando(null);
    }
  }

  function eliminarLinea(lineaId) {
    const nuevo = pedido.filter((l) => l.lineaId !== lineaId);
    setPedido(nuevo);
    if (nuevo.length === 0) setPaso('elegir');
  }

  const totalPedido = pedido.reduce((s, l) => s + l.qty * l.costo, 0);

  async function registrar() {
    setMsg({ tipo: '', texto: '' });
    setExito(null);
    if (pedido.length === 0) return;
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
        // Ya no se pregunta a quién se le compró — Nelson decidió quitar ese
        // paso de esta pantalla.
        proveedor: null,
        // Su plata siempre sale de la misma caja (efectivo de las ventas) — se
        // manda fijo, sin preguntárselo, para que el Cierre del día siga
        // descontando bien lo que él gasta del efectivo a entregar.
        origen: 'Efectivo de la caja',
        usuario,
      });
      setExito({ total: totalPedido });
      setPedido([]);
      setPaso('elegir');
      cargarMisPedidos();
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar el pedido.' });
    } finally {
      setGuardando(false);
    }
  }

  if (errorCarga) {
    return (
      <div className="cf-page">
        <div className="cf-card">
          <h2>No se pudo cargar</h2>
          <p style={{ fontSize: 16, color: 'var(--danger)' }}>{errorCarga}</p>
        </div>
      </div>
    );
  }
  if (!inventario) return <div className="loading">Cargando…</div>;

  return (
    <div className="cf-page">
      {exito && (
        <div className="cf-exito">
          ✅ ¡Listo! Se guardó el pedido por <b>{fmt(exito.total)}</b>.
          <button className="cf-exito-cerrar" onClick={() => setExito(null)}>
            Entendido
          </button>
        </div>
      )}

      {paso === 'elegir' && (
        <div className="cf-card">
          <div className="cf-paso">¿Qué compraste?</div>

          <div className="cf-split-label">Con nombre</div>
          <div className="cf-tiles">
            {itemsNombre.map((it) => (
              <button key={it.id} className="cf-tile" onClick={() => elegir(it)}>
                {it.name}
              </button>
            ))}
          </div>

          <div className="cf-split-label" style={{ marginTop: 16 }}>Por precio</div>
          <div className="cf-tiles">
            {itemsPrecio.map((it) => (
              <button key={it.id} className="cf-tile" onClick={() => elegir(it)}>
                {it.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {paso === 'todo' && actual && (
        <div className="cf-card">
          <button className="cf-volver" onClick={volverAElegir}>‹ Volver</button>
          <div className="cf-paso">{actual.name}</div>

          <div className="cf-linea-campo">
            <label>¿Cuántas?</label>
            <div className="cf-stepper">
              <button type="button" onClick={() => sumarUno(-1)}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={actual.qty}
                onFocus={(e) => e.target.select()}
                onChange={(e) => cambiarCantidad(e.target.value)}
              />
              <button type="button" onClick={() => sumarUno(1)}>
                +
              </button>
            </div>
          </div>

          <div className="cf-linea-campo">
            <label>Precio de compra</label>
            <input
              className="cf-input cf-input-costo"
              type="number"
              inputMode="numeric"
              placeholder="0"
              value={actual.costo}
              onFocus={(e) => e.target.select()}
              onChange={(e) => cambiarCosto(e.target.value)}
            />
          </div>

          <div className="cf-linea-campo">
            <label>Nota — opcional</label>
            <input
              className="cf-input"
              type="text"
              value={actual.nota}
              onFocus={(e) => e.target.select()}
              onChange={(e) => cambiarNota(e.target.value)}
            />
            <div className="cf-chips-nota">
              {NOTAS_SUGERIDAS.map((n) => (
                <button key={n} type="button" className="cf-chip-nota" onClick={() => elegirNota(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button className="cf-btn-registrar" onClick={agregarPrenda}>
            Agregar esta prenda
          </button>
          {msg.texto && <div className={`msg ${msg.tipo}`} style={{ fontSize: 16 }}>{msg.texto}</div>}
        </div>
      )}

      {paso === 'decidir' && (
        <div className="cf-card">
          <div className="cf-paso">¿Agregas otra prenda?</div>
          <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginTop: -6, marginBottom: 14 }}>
            Llevas {pedido.length} {pedido.length === 1 ? 'prenda' : 'prendas'} en este pedido.
          </p>

          {pedido.map((l) => (
            <div key={l.lineaId} className="cf-resumen-linea">
              <div className="cf-resumen-info">
                <div className="cf-resumen-izq">
                  <div className="cf-resumen-nombre">
                    {l.name}
                    {l.nota ? ` (${l.nota})` : ''}
                  </div>
                  <div className="cf-resumen-detalle">
                    {l.qty} × {fmt(l.costo)}
                  </div>
                </div>
                <div className="cf-resumen-der">{fmt(l.qty * l.costo)}</div>
              </div>
              <button className="cf-resumen-quitar" title="Eliminar esta línea" onClick={() => eliminarLinea(l.lineaId)}>
                ✕
              </button>
            </div>
          ))}

          <div className="cf-total-general">Total hasta ahora: {fmt(totalPedido)}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            <button className="cf-btn-registrar" style={{ marginBottom: 0 }} onClick={otraPrenda}>
              Agregar otra prenda
            </button>
            <button className="cf-btn-secundario" style={{ width: '100%' }} disabled={guardando} onClick={registrar}>
              {guardando ? 'Guardando…' : 'Registrar pedido'}
            </button>
          </div>
          {msg.texto && <div className={`msg ${msg.tipo}`} style={{ fontSize: 16 }}>{msg.texto}</div>}
        </div>
      )}

      {misPedidos && misPedidos.length > 0 && (
        <div className="cf-card">
          <div className="cf-paso">Tus pedidos</div>
          {misPedidos.map((c) =>
            corrigiendo === c.id ? (
              <CorreccionSimple
                key={c.id}
                pedido={c}
                itemsNombre={itemsNombre}
                itemsPrecio={itemsPrecio}
                onCancelar={() => setCorrigiendo(null)}
                onListo={async () => {
                  setCorrigiendo(null);
                  await cargarMisPedidos();
                }}
              />
            ) : (
              <div key={c.id} className="cf-pedido-row">
                <div className="cf-pedido-top">
                  <span>{c.fecha}</span>
                  <span className={`cf-estado ${c.estado}`}>
                    {c.estado === 'confirmada' ? 'CONFIRMADO' : 'PENDIENTE'}
                  </span>
                </div>
                <div className="cf-pedido-total">{fmt(c.totalGeneral)}</div>
                {c.estado === 'pendiente' && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="cf-btn-corregir" onClick={() => setCorrigiendo(c.id)}>
                      Corregir este pedido
                    </button>
                    <button
                      className="cf-btn-corregir"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      disabled={eliminando === c.id}
                      onClick={() => eliminar(c)}
                    >
                      {eliminando === c.id ? 'Eliminando…' : 'Eliminar pedido'}
                    </button>
                  </div>
                )}
              </div>
            )
          )}
          {msgEliminar && <div className="msg bad">{msgEliminar}</div>}
        </div>
      )}
    </div>
  );
}

function CorreccionSimple({ pedido, itemsNombre, itemsPrecio, onCancelar, onListo }) {
  const [cantidades, setCantidades] = useState(() => {
    const ini = {};
    pedido.items.forEach((i) => (ini[claveLinea(i)] = String(i.cantidadPedida)));
    return ini;
  });
  // Qué referencia de inventario quedó elegida para cada línea — por defecto
  // la misma con la que se registró, pero se puede cambiar por si se tocó la
  // categoría equivocada al hacer el pedido.
  const [prendas, setPrendas] = useState(() => {
    const ini = {};
    pedido.items.forEach((i) => (ini[claveLinea(i)] = i.id));
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
          costoUnitario: i.costoUnitario,
          nota: i.nota,
        };
      });
      await ajustarPedido(pedido.id, itemsAjustados);
      onListo();
    } catch (e) {
      setMsg('No se pudo corregir: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="cf-correccion">
      <div className="cf-paso">Corrige cada prenda de este pedido</div>
      {pedido.items.map((i) => (
        <div key={claveLinea(i)} className="cf-linea-campo">
          <label>
            {i.name}
            {i.nota ? ` (${i.nota})` : ''}
            {/* Si la misma prenda quedó en más de una línea (ej. llegó a distinto
                costo cada vez), el costo es lo único que las distingue — sin esto
                se ven idénticas y parece que solo hay una para corregir. */}
            <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}> — costo {fmt(i.costoUnitario)}</span>
          </label>
          <select
            className="cf-input"
            value={prendas[claveLinea(i)]}
            onChange={(e) => setPrendas((p) => ({ ...p, [claveLinea(i)]: e.target.value }))}
            style={{ marginBottom: 8 }}
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
          <label style={{ fontSize: 12 }}>Cantidad</label>
          <input
            type="number"
            inputMode="numeric"
            value={cantidades[claveLinea(i)]}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCantidades((c) => ({ ...c, [claveLinea(i)]: e.target.value }))}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button className="cf-btn-secundario" onClick={onCancelar}>
          Cancelar
        </button>
        <button className="cf-btn-registrar" style={{ marginBottom: 0 }} disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar corrección'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}
