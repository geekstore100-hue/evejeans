import { useEffect, useMemo, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { crearPedidoCompra, comprasRecientes, ajustarPedido } from '../lib/compras';

// Versión simplificada de Compras, pensada para Fausto: letra grande, un solo
// paso a la vez, botones grandes con +/- para la cantidad (además de poder
// escribirla directo, para pedidos grandes de una sola referencia), y sin nada
// que no necesite (buscador, origen del dinero, historial completo, atajos de
// teclado, etc.). El historial de TODOS los pedidos lo sigue viendo Nelson
// desde su propia pantalla de Compras — acá solo se ven los últimos pedidos DE
// FAUSTO, por si hay que corregir alguno.

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function ComprasFausto({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [carrito, setCarrito] = useState({}); // {id: {qty, costoUnitario, nota}}
  const [proveedor, setProveedor] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [exito, setExito] = useState(null); // { proveedor, total } | null
  const [misPedidos, setMisPedidos] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);

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
      const todos = await comprasRecientes(50);
      setMisPedidos(todos.filter((c) => c.usuarioId === usuario.id).slice(0, 5));
    } catch (e) {
      setMisPedidos([]);
    }
  }

  const porId = useMemo(() => {
    const m = {};
    (inventario || []).forEach((i) => (m[i.id] = i));
    return m;
  }, [inventario]);

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

  function agregar(id) {
    const it = porId[id];
    setCarrito((c) => ({
      ...c,
      [id]: {
        qty: c[id]?.qty || 1,
        costoUnitario: c[id]?.costoUnitario ?? (it.costoCompra || 0),
        nota: c[id]?.nota || '',
      },
    }));
  }
  function quitarLinea(id) {
    setCarrito((c) => {
      const copia = { ...c };
      delete copia[id];
      return copia;
    });
  }
  function cambiarCantidad(id, valor) {
    setCarrito((c) => ({ ...c, [id]: { ...c[id], qty: parseInt(valor) || 0 } }));
  }
  function sumarUno(id, delta) {
    setCarrito((c) => ({ ...c, [id]: { ...c[id], qty: Math.max(0, (c[id]?.qty || 0) + delta) } }));
  }
  function cambiarCosto(id, valor) {
    setCarrito((c) => ({ ...c, [id]: { ...c[id], costoUnitario: parseInt(valor) || 0 } }));
  }
  function cambiarNota(id, valor) {
    setCarrito((c) => ({ ...c, [id]: { ...c[id], nota: valor } }));
  }

  const lineas = Object.entries(carrito).map(([id, d]) => ({
    id,
    name: porId[id]?.name || id,
    qty: d.qty,
    costoUnitario: d.costoUnitario,
    nota: d.nota || '',
    total: d.qty * d.costoUnitario,
  }));
  const totalGeneral = lineas.reduce((s, l) => s + l.total, 0);

  function vaciar() {
    setCarrito({});
    setProveedor('');
  }

  async function confirmar() {
    setMsg({ tipo: '', texto: '' });
    setExito(null);
    if (lineas.length === 0) {
      setMsg({ tipo: 'bad', texto: 'Toca al menos una prenda para agregarla al pedido.' });
      return;
    }
    if (!proveedor.trim()) {
      setMsg({ tipo: 'bad', texto: 'Falta escribir el nombre del proveedor.' });
      return;
    }
    if (lineas.some((l) => !l.qty || l.qty <= 0)) {
      setMsg({ tipo: 'bad', texto: 'Revisa la cantidad de alguna prenda, no puede quedar en cero.' });
      return;
    }
    if (lineas.some((l) => !l.costoUnitario || l.costoUnitario <= 0)) {
      setMsg({ tipo: 'bad', texto: 'Falta el costo de alguna prenda.' });
      return;
    }
    setGuardando(true);
    try {
      await crearPedidoCompra({
        items: lineas.map((l) => ({
          id: l.id,
          name: l.name,
          cantidadPedida: l.qty,
          costoUnitario: l.costoUnitario,
          nota: l.nota.trim(),
        })),
        proveedor,
        // Su plata siempre sale de la misma caja (efectivo de las ventas) — se
        // manda fijo, sin preguntárselo, para que el Cierre del día siga
        // descontando bien lo que él gasta del efectivo a entregar.
        origen: 'Efectivo de la caja',
        usuario,
      });
      setExito({ proveedor, total: totalGeneral });
      vaciar();
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
          ✅ ¡Listo! Se guardó el pedido con <b>{exito.proveedor}</b> por <b>{fmt(exito.total)}</b>.
          <button className="cf-exito-cerrar" onClick={() => setExito(null)}>
            Entendido
          </button>
        </div>
      )}

      <div className="cf-card">
        <div className="cf-paso">1. ¿A quién le compraste?</div>
        <input
          className="cf-input"
          type="text"
          placeholder="Nombre del proveedor"
          value={proveedor}
          onChange={(e) => setProveedor(e.target.value)}
        />
      </div>

      <div className="cf-card">
        <div className="cf-paso">2. ¿Qué compraste?</div>

        <div className="cf-split-label">Con nombre</div>
        <div className="cf-tiles">
          {itemsNombre.map((it) => (
            <button
              key={it.id}
              className={`cf-tile ${carrito[it.id] ? 'cf-tile-on' : ''}`}
              onClick={() => agregar(it.id)}
            >
              {it.name}
              {carrito[it.id] && <span className="cf-tile-check">✓ agregada</span>}
            </button>
          ))}
        </div>

        <div className="cf-split-label" style={{ marginTop: 16 }}>Por precio</div>
        <div className="cf-tiles">
          {itemsPrecio.map((it) => (
            <button
              key={it.id}
              className={`cf-tile ${carrito[it.id] ? 'cf-tile-on' : ''}`}
              onClick={() => agregar(it.id)}
            >
              {it.name}
              {carrito[it.id] && <span className="cf-tile-check">✓ agregada</span>}
            </button>
          ))}
        </div>
      </div>

      {lineas.length > 0 && (
        <div className="cf-card">
          <div className="cf-paso">3. Cantidad y costo de cada una</div>
          {lineas.map((l) => (
            <div key={l.id} className="cf-linea">
              <div className="cf-linea-top">
                <span className="cf-linea-nombre">{l.name}</span>
                <button className="cf-quitar" onClick={() => quitarLinea(l.id)}>
                  Quitar
                </button>
              </div>
              <div className="cf-linea-campo">
                <label>Cantidad</label>
                <div className="cf-stepper">
                  <button type="button" onClick={() => sumarUno(l.id, -1)}>
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={l.qty}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => cambiarCantidad(l.id, e.target.value)}
                  />
                  <button type="button" onClick={() => sumarUno(l.id, 1)}>
                    +
                  </button>
                </div>
              </div>
              <div className="cf-linea-campo">
                <label>Costo de cada una</label>
                <input
                  className="cf-input cf-input-costo"
                  type="number"
                  inputMode="numeric"
                  value={l.costoUnitario}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => cambiarCosto(l.id, e.target.value)}
                />
              </div>
              <div className="cf-linea-campo">
                <label>Nota — opcional</label>
                <input
                  className="cf-input"
                  type="text"
                  placeholder=""
                  value={l.nota}
                  onChange={(e) => cambiarNota(l.id, e.target.value)}
                />
              </div>
              <div className="cf-linea-total">Total: {fmt(l.total)}</div>
            </div>
          ))}
          <div className="cf-total-general">Total del pedido: {fmt(totalGeneral)}</div>
        </div>
      )}

      <button className="cf-btn-registrar" disabled={guardando} onClick={confirmar}>
        {guardando ? 'Guardando…' : 'Registrar pedido'}
      </button>
      {msg.texto && <div className={`msg ${msg.tipo}`} style={{ fontSize: 16 }}>{msg.texto}</div>}

      {misPedidos && misPedidos.length > 0 && (
        <div className="cf-card">
          <div className="cf-paso">Tus últimos pedidos</div>
          {misPedidos.map((c) =>
            corrigiendo === c.id ? (
              <CorreccionSimple
                key={c.id}
                pedido={c}
                onCancelar={() => setCorrigiendo(null)}
                onListo={async () => {
                  setCorrigiendo(null);
                  await cargarMisPedidos();
                }}
              />
            ) : (
              <div key={c.id} className="cf-pedido-row">
                <div className="cf-pedido-top">
                  <span>
                    {c.fecha} · {c.proveedor}
                  </span>
                  <span className={`cf-estado ${c.estado}`}>
                    {c.estado === 'confirmada' ? 'CONFIRMADO' : 'PENDIENTE'}
                  </span>
                </div>
                <div className="cf-pedido-total">{fmt(c.totalGeneral)}</div>
                {c.estado === 'pendiente' && (
                  <button className="cf-btn-corregir" onClick={() => setCorrigiendo(c.id)}>
                    Corregir este pedido
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function CorreccionSimple({ pedido, onCancelar, onListo }) {
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
      setMsg('No se pudo corregir: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="cf-correccion">
      <div className="cf-paso">Corrige la cantidad de cada prenda</div>
      {pedido.items.map((i) => (
        <div key={i.id} className="cf-linea-campo">
          <label>{i.name}</label>
          <input
            type="number"
            inputMode="numeric"
            value={cantidades[i.id]}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCantidades((c) => ({ ...c, [i.id]: e.target.value }))}
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
