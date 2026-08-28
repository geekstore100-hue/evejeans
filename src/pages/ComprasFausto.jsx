import { useEffect, useMemo, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { crearPedidoCompra, comprasRecientes, ajustarPedido, nuevaLineaId, claveLinea } from '../lib/compras';

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
  const [carrito, setCarrito] = useState({}); // {lineaId: {id, qty, costoUnitario, nota}}
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [exito, setExito] = useState(null); // { total } | null
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

  // Tocar una prenda agrega UNA línea de esa referencia (o mantiene la que ya
  // había, no la duplica) — si hace falta otra línea de la MISMA referencia
  // con otra nota (ej. 10 chaquetas y 20 pantalones, ambas a $60.000), se usa
  // el botón "Agregar otra línea" que aparece dentro de cada línea, abajo.
  function yaTieneReferencia(id) {
    return Object.values(carrito).some((l) => l.id === id);
  }
  function agregar(id) {
    if (yaTieneReferencia(id)) return;
    const it = porId[id];
    setCarrito((c) => ({
      ...c,
      [nuevaLineaId()]: { id, qty: 1, costoUnitario: it.costoCompra || 0, nota: '' },
    }));
  }
  function agregarOtraLinea(lineaId) {
    const base = carrito[lineaId];
    if (!base) return;
    setCarrito((c) => ({
      ...c,
      [nuevaLineaId()]: { id: base.id, qty: 1, costoUnitario: base.costoUnitario, nota: '' },
    }));
  }
  function quitarLinea(lineaId) {
    setCarrito((c) => {
      const copia = { ...c };
      delete copia[lineaId];
      return copia;
    });
  }
  function cambiarCantidad(lineaId, valor) {
    setCarrito((c) => ({ ...c, [lineaId]: { ...c[lineaId], qty: parseInt(valor) || 0 } }));
  }
  function sumarUno(lineaId, delta) {
    setCarrito((c) => ({ ...c, [lineaId]: { ...c[lineaId], qty: Math.max(0, (c[lineaId]?.qty || 0) + delta) } }));
  }
  function cambiarCosto(lineaId, valor) {
    setCarrito((c) => ({ ...c, [lineaId]: { ...c[lineaId], costoUnitario: parseInt(valor) || 0 } }));
  }
  function cambiarNota(lineaId, valor) {
    setCarrito((c) => ({ ...c, [lineaId]: { ...c[lineaId], nota: valor } }));
  }

  const lineas = Object.entries(carrito).map(([lineaId, d]) => ({
    lineaId,
    id: d.id,
    name: porId[d.id]?.name || d.id,
    qty: d.qty,
    costoUnitario: d.costoUnitario,
    nota: d.nota || '',
    total: d.qty * d.costoUnitario,
  }));
  const totalGeneral = lineas.reduce((s, l) => s + l.total, 0);

  function vaciar() {
    setCarrito({});
  }

  async function confirmar() {
    setMsg({ tipo: '', texto: '' });
    setExito(null);
    if (lineas.length === 0) {
      setMsg({ tipo: 'bad', texto: 'Toca al menos una prenda para agregarla al pedido.' });
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
          lineaId: l.lineaId,
          name: l.name,
          cantidadPedida: l.qty,
          costoUnitario: l.costoUnitario,
          nota: l.nota.trim(),
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
      setExito({ total: totalGeneral });
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
          ✅ ¡Listo! Se guardó el pedido por <b>{fmt(exito.total)}</b>.
          <button className="cf-exito-cerrar" onClick={() => setExito(null)}>
            Entendido
          </button>
        </div>
      )}

      <div className="cf-card">
        <div className="cf-paso">1. ¿Qué compraste?</div>

        <div className="cf-split-label">Con nombre</div>
        <div className="cf-tiles">
          {itemsNombre.map((it) => (
            <button
              key={it.id}
              className={`cf-tile ${yaTieneReferencia(it.id) ? 'cf-tile-on' : ''}`}
              onClick={() => agregar(it.id)}
            >
              {it.name}
              {yaTieneReferencia(it.id) && <span className="cf-tile-check">✓ agregada</span>}
            </button>
          ))}
        </div>

        <div className="cf-split-label" style={{ marginTop: 16 }}>Por precio</div>
        <div className="cf-tiles">
          {itemsPrecio.map((it) => (
            <button
              key={it.id}
              className={`cf-tile ${yaTieneReferencia(it.id) ? 'cf-tile-on' : ''}`}
              onClick={() => agregar(it.id)}
            >
              {it.name}
              {yaTieneReferencia(it.id) && <span className="cf-tile-check">✓ agregada</span>}
            </button>
          ))}
        </div>
      </div>

      {lineas.length > 0 && (
        <div className="cf-card">
          <div className="cf-paso">2. Cantidad y costo de cada una</div>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 0 }}>
            Si de la MISMA prenda llegaron varios tipos (ej. unas chaquetas y unos pantalones al
            mismo precio), usa "Agregar otra línea" para contarlos por separado, cada uno con su
            propia nota.
          </p>
          {lineas.map((l) => (
            <div key={l.lineaId} className="cf-linea">
              <div className="cf-linea-top">
                <span className="cf-linea-nombre">{l.name}</span>
                <button className="cf-quitar" onClick={() => quitarLinea(l.lineaId)}>
                  Quitar
                </button>
              </div>
              <div className="cf-linea-campo">
                <label>Cantidad</label>
                <div className="cf-stepper">
                  <button type="button" onClick={() => sumarUno(l.lineaId, -1)}>
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={l.qty}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => cambiarCantidad(l.lineaId, e.target.value)}
                  />
                  <button type="button" onClick={() => sumarUno(l.lineaId, 1)}>
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
                  onChange={(e) => cambiarCosto(l.lineaId, e.target.value)}
                />
              </div>
              <div className="cf-linea-campo">
                <label>Nota — opcional</label>
                <input
                  className="cf-input"
                  type="text"
                  placeholder=""
                  value={l.nota}
                  onChange={(e) => cambiarNota(l.lineaId, e.target.value)}
                />
              </div>
              <div className="cf-linea-total">Total: {fmt(l.total)}</div>
              <button
                className="cf-btn-secundario"
                style={{ marginTop: 8, width: '100%' }}
                onClick={() => agregarOtraLinea(l.lineaId)}
              >
                + Agregar otra línea de "{l.name}"
              </button>
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
                  <span>{c.fecha}</span>
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
    pedido.items.forEach((i) => (ini[claveLinea(i)] = String(i.cantidadPedida)));
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
        lineaId: i.lineaId,
        name: i.name,
        cantidadPedida: parseInt(cantidades[claveLinea(i)]) || 0,
        costoUnitario: i.costoUnitario,
        nota: i.nota,
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
        <div key={claveLinea(i)} className="cf-linea-campo">
          <label>
            {i.name}
            {i.nota ? ` (${i.nota})` : ''}
          </label>
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
