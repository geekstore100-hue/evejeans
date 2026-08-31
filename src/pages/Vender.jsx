import { useEffect, useMemo, useRef, useState } from 'react';
import { suscribirInventario, sembrarCatalogoInicial } from '../lib/inventario';
import { registrarVenta } from '../lib/ventas';
import { imprimirTicketVenta } from '../lib/imprimir';
import { useBuscadorFiltro, CuadroBusqueda } from '../lib/buscadorFiltro';
import { resumenDia, hoyStr } from '../lib/cierre';
import { suscribirConfig } from '../lib/config';
import { tocaConteo, registrarConteo, elegirMuestraSemana } from '../lib/conteo';
import { semanaDe } from '../lib/festivos';
import { guardarConfig } from '../lib/config';

const MEDIOS = ['Efectivo', 'Datáfono', 'Nequi', 'Addi', 'PTM', 'Sistecrédito'];

// Lugares donde puede estar físicamente una prenda al momento del conteo — se
// cuenta por separado en cada uno y se suman, en vez de adivinar un solo total.
const UBICACIONES = [
  { key: 'estanteria', label: 'Estantería' },
  { key: 'bodega', label: 'Bodega' },
  { key: 'exhibicion', label: 'Exhibición' },
  { key: 'apartados', label: 'Apartados' },
  { key: 'cambios', label: 'Cambios' },
  { key: 'lavanderia', label: 'Lavandería' },
];

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Vender({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [carrito, setCarrito] = useState({});
  const [descuento, setDescuento] = useState('');
  const [motivo, setMotivo] = useState('');
  const [pagos, setPagos] = useState({});
  const [cobrando, setCobrando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [ultimaVenta, setUltimaVenta] = useState(null);
  const [config, setConfig] = useState(null);
  const [efectivoCaja, setEfectivoCaja] = useState(null);
  const [debeContar, setDebeContar] = useState(false);
  const [contando, setContando] = useState(false);
  const [muestraConteo, setMuestraConteo] = useState([]);
  const [cantidadesConteo, setCantidadesConteo] = useState({});
  const [guardandoConteo, setGuardandoConteo] = useState(false);
  const [sembrando, setSembrando] = useState(false);

  useEffect(() => {
    const quitar = suscribirInventario(setInventario, (err) => {
      setErrorCarga(
        err.code === 'permission-denied'
          ? 'No se pudo leer el inventario (permiso denegado). Revisa que las reglas de Firestore estén publicadas.'
          : 'No se pudo leer el inventario: ' + err.message
      );
    });
    return quitar;
  }, []);

  useEffect(() => suscribirConfig(setConfig), []);

  useEffect(() => {
    if (!config) return;
    tocaConteo(usuario, config).then(setDebeContar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  function abrirConteo() {
    const disponibles = (inventario || []).filter((i) => !i.oculto);
    // Si Nelson eligió a mano qué contar esta vez, se usa eso en vez de las 2
    // al azar de siempre.
    const elegidas = config?.conteoReferenciasElegidas || [];
    let muestra = elegidas.length > 0 ? elegidas.map((id) => disponibles.find((i) => i.id === id)).filter(Boolean) : [];
    if (muestra.length === 0) {
      // Sembrado con la semana (no con Math.random()): así, si le da "Ahora
      // no" y vuelve a entrar más tarde (o al otro día), le sigue pidiendo
      // contar las MISMAS 2 referencias — no otras cada vez — hasta que las
      // cuente. La semana siguiente, al cambiar la semilla, salen otras.
      muestra = elegirMuestraSemana(disponibles, 2, semanaDe(hoyStr()));
    }
    setMuestraConteo(muestra);
    setCantidadesConteo({});
    setContando(true);
  }

  async function guardarConteoSemana() {
    setGuardandoConteo(true);
    try {
      const referencias = muestraConteo.map((it) => {
        const porUbicacion = {};
        let contado = 0;
        UBICACIONES.forEach((u) => {
          const val = parseInt(cantidadesConteo[it.id]?.[u.key]) || 0;
          porUbicacion[u.key] = val;
          contado += val;
        });
        return {
          id: it.id,
          name: it.name,
          sistema: it.stock || 0,
          contado,
          porUbicacion,
        };
      });
      await registrarConteo({ usuario, referencias });
      // Si esta vez se usó una elección manual de Nelson, se consume: la
      // próxima semana vuelve a ser al azar a menos que él elija de nuevo.
      if (config?.conteoReferenciasElegidas?.length > 0) {
        guardarConfig({ ...config, conteoReferenciasElegidas: [] }).catch(() => {});
      }
      setContando(false);
      setDebeContar(false);
      const conDiferencia = referencias.filter((r) => r.contado !== r.sistema);
      if (conDiferencia.length > 0) {
        alert(
          'Ojo, no coincide con el sistema:\n\n' +
            conDiferencia.map((r) => `${r.name}: sistema ${r.sistema}, contaste ${r.contado}`).join('\n')
        );
      }
    } catch (e) {
      alert('No se pudo guardar el conteo: ' + e.message);
    } finally {
      setGuardandoConteo(false);
    }
  }

  async function actualizarEfectivoCaja() {
    if (!config) return;
    try {
      const r = await resumenDia(hoyStr());
      setEfectivoCaja(r.efectivoAEntregar);
    } catch (e) {
      // Si falla, se deja de mostrar en vez de mostrar un dato viejo o incorrecto.
      setEfectivoCaja(null);
    }
  }

  useEffect(() => {
    actualizarEfectivoCaja();
    // Se refresca solo cada minuto, para que "verificar caja" nunca esté muy desactualizado.
    const intervalo = setInterval(actualizarEfectivoCaja, 60000);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

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

  function stockDisponible(id) {
    const it = porId[id];
    if (!it) return 0;
    return (it.stock || 0) - (carrito[id] || 0);
  }

  function agregar(id) {
    if (stockDisponible(id) <= 0) return false;
    setCarrito((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
  }

  const busc = useBuscadorFiltro(nombreItemsTodos, precioItemsTodos);
  const buscadorRef = useRef(null);
  function elegirDeBusqueda(item) {
    if (stockDisponible(item.id) <= 0) {
      busc.setBusquedaMsg(`"${item.name}" no tiene disponible.`);
      return false;
    }
    agregar(item.id);
  }

  function quitarLinea(id) {
    setCarrito((c) => {
      const copia = { ...c };
      delete copia[id];
      return copia;
    });
    if (Object.keys(carrito).length <= 1) setPagos({});
  }

  const lineas = Object.entries(carrito).map(([id, qty]) => ({
    id,
    qty,
    name: porId[id]?.name || id,
    price: porId[id]?.price || 0,
    tipo: porId[id]?.tipo,
  }));
  const subtotal = lineas.reduce((s, l) => s + l.price * l.qty, 0);
  const descNum = parseInt(descuento) || 0;
  const total = Math.max(0, subtotal - descNum);
  const pagado = Object.values(pagos).reduce((s, v) => s + (v || 0), 0);
  const falta = total - pagado;

  function vaciar() {
    setCarrito({});
    setDescuento('');
    setMotivo('');
    setPagos({});
    setMsg({ tipo: '', texto: '' });
    setUltimaVenta(null);
    buscadorRef.current?.focus();
  }

  function pagarTodoCon(medio) {
    setPagos(total > 0 ? { [medio]: total } : {});
  }
  function cambiarPago(medio, valor) {
    const v = parseInt(valor) || 0;
    setPagos((p) => {
      const copia = { ...p };
      if (v > 0) copia[medio] = v;
      else delete copia[medio];
      return copia;
    });
  }

  async function cobrar() {
    setMsg({ tipo: '', texto: '' });
    if (lineas.length === 0) {
      setMsg({ tipo: 'bad', texto: 'Toca alguna prenda primero.' });
      buscadorRef.current?.focus();
      return;
    }
    if (descNum > 0 && !motivo.trim()) {
      setMsg({ tipo: 'bad', texto: 'El descuento necesita un motivo escrito.' });
      return;
    }
    if (Object.keys(pagos).length === 0) {
      setMsg({ tipo: 'bad', texto: 'Falta registrar cómo paga.' });
      return;
    }
    if (pagado !== total) {
      setMsg({
        tipo: 'bad',
        texto:
          pagado < total
            ? `Faltan ${fmt(total - pagado)} en los pagos.`
            : `Sobran ${fmt(pagado - total)} en los pagos.`,
      });
      return;
    }

    setCobrando(true);
    try {
      const res = await registrarVenta({
        usuario,
        items: lineas.map(({ id, name, price, qty }) => ({ id, name, price, qty })),
        descuento: descNum,
        motivoDescuento: motivo.trim() || null,
        pagos,
      });
      setUltimaVenta({ ...res, lineas, subtotal, descuento: descNum, pagos });
      setMsg({ tipo: 'good', texto: `Venta N.º ${res.num} registrada · ${fmt(res.total)}` });
      imprimirTicketVenta({
        num: res.num,
        fecha: res.fecha,
        hora: res.hora,
        usuarioNombre: usuario.nombreDefault,
        lineas,
        subtotal,
        descuento: descNum,
        total: res.total,
        pagos,
      });
      setCarrito({});
      setDescuento('');
      setMotivo('');
      setPagos({});
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar la venta.' });
    } finally {
      setCobrando(false);
      actualizarEfectivoCaja();
      // El foco vuelve al buscador siempre, para poder seguir escribiendo de una.
      buscadorRef.current?.focus();
    }
  }

  async function sembrar() {
    setSembrando(true);
    try {
      await sembrarCatalogoInicial();
    } catch (e) {
      alert('No se pudo cargar el catálogo: ' + e.message);
    } finally {
      setSembrando(false);
    }
  }

  if (inventario && inventario.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <div className="card" style={{ maxWidth: 460 }}>
          <h2>Todavía no hay catálogo</h2>
          {usuario.id === 'nelson' ? (
            <>
              <p style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
                Carga el catálogo de referencias con stock en 0. Después, el stock real se
                actualiza con el conteo físico inicial.
              </p>
              <button className="btn" disabled={sembrando} onClick={sembrar}>
                {sembrando ? 'Cargando…' : 'Cargar catálogo inicial'}
              </button>
            </>
          ) : (
            <p>Pídele a Nelson que cargue el catálogo desde su usuario.</p>
          )}
        </div>
      </div>
    );
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

  if (!inventario) {
    return <div className="loading">Cargando inventario…</div>;
  }

  return (
    <div className="vender-shell">
      {debeContar && !contando && (
        <div className="card modo-prueba" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, fontSize: 13 }}>
              <b>Falta el conteo de inicio de semana.</b> Son solo{' '}
              {config?.conteoReferenciasElegidas?.length > 0 ? config.conteoReferenciasElegidas.length : 2}{' '}
              referencia{(config?.conteoReferenciasElegidas?.length > 0 ? config.conteoReferenciasElegidas.length : 2) === 1 ? '' : 's'}. Puedes
              seguir vendiendo, pero este aviso no se quita hasta que lo hagas.
            </span>
            <button className="btn sm" style={{ width: 'auto' }} onClick={abrirConteo}>
              Hacer conteo
            </button>
          </div>
        </div>
      )}

      {contando && (
        <div className="card modo-prueba" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Conteo de inicio de semana</div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
            Cuenta cuántas hay de verdad en cada lugar.
          </p>
          {muestraConteo.map((it) => {
            const totalItem = UBICACIONES.reduce(
              (s, u) => s + (parseInt(cantidadesConteo[it.id]?.[u.key]) || 0),
              0
            );
            return (
              <div key={it.id} style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{it.name}</span>
                  <span style={{ color: 'var(--ink-soft)' }}>Total contado: {totalItem}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {UBICACIONES.map((u) => (
                    <div className="field" key={u.key} style={{ minWidth: 100, flex: '1 0 100px' }}>
                      <label>{u.label}</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={cantidadesConteo[it.id]?.[u.key] || ''}
                        onChange={(e) =>
                          setCantidadesConteo((c) => ({
                            ...c,
                            [it.id]: { ...c[it.id], [u.key]: e.target.value },
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setContando(false)}>
              Ahora no
            </button>
            <button className="btn sm" style={{ width: 'auto' }} disabled={guardandoConteo} onClick={guardarConteoSemana}>
              {guardandoConteo ? 'Guardando…' : 'Enviar conteo'}
            </button>
          </div>
        </div>
      )}


      <div className="card">
        <h2>
          Prendas
          <span className="side">
            {efectivoCaja !== null && (
              <span style={{ color: 'var(--cian-fuerte)' }}>Caja: {fmt(efectivoCaja)}</span>
            )}
            <span style={{ color: 'var(--ink-soft)', fontWeight: 600, margin: '0 8px' }}>·</span>
            <span style={{ color: 'var(--ink-soft)', fontWeight: 600, fontSize: 13 }}>
              {inventario.reduce((s, i) => s + (i.stock || 0), 0)} prendas en stock
            </span>
          </span>
        </h2>
        <CuadroBusqueda
          ref={buscadorRef}
          placeholder="Escribe para filtrar · Tab para elegir entre varias · Enter para agregar"
          busqueda={busc.busqueda}
          setBusqueda={busc.setBusqueda}
          busquedaMsg={busc.busquedaMsg}
          setBusquedaMsg={busc.setBusquedaMsg}
          onKeyDown={(e) => busc.manejarTecla(e, elegirDeBusqueda)}
          tabIndex={1}
          autoFocus
        />
        <div className="cat-split">
          <div>
            <div className="split-label">Con nombre</div>
            <div className="tiles-scroll">
              <div className="tiles">
                {busc.nombreItems.map((it) => (
                  <Tile
                    key={it.id}
                    item={it}
                    disponible={stockDisponible(it.id)}
                    enCarrito={carrito[it.id] || 0}
                    onClick={() => agregar(it.id)}
                    seleccionado={busc.combinados[busc.selIndex]?.id === it.id}
                  />
                ))}
              </div>
            </div>
          </div>
          <div>
            <div className="split-label">Por precio</div>
            <div className="tiles-scroll">
              <div className="tiles">
                {busc.precioItems.map((it) => (
                  <Tile
                    key={it.id}
                    item={it}
                    disponible={stockDisponible(it.id)}
                    enCarrito={carrito[it.id] || 0}
                    onClick={() => agregar(it.id)}
                    seleccionado={busc.combinados[busc.selIndex]?.id === it.id}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ticket ticket-fijo-venta">
        <div className="card">
          <h2>Venta</h2>
          <div className="lines">
            {lineas.length === 0 ? (
              <div className="empty-lines">Toca una prenda para empezar.</div>
            ) : (
              lineas.map((l) => (
                <div className="line" key={l.id}>
                  <span>
                    {l.name} <span className="qty">×{l.qty}</span>
                  </span>
                  <span className="amt">{fmt(l.price * l.qty)}</span>
                  <button tabIndex={-1} onClick={() => quitarLinea(l.id)}>✕</button>
                </div>
              ))
            )}
          </div>

          <div className="totals">
            {descNum > 0 && (
              <div className="trow disc">
                <span>Descuento</span>
                <span className="v">−{fmt(descNum)}</span>
              </div>
            )}
            <div className="trow big">
              <span>Total</span>
              <span className="v">{fmt(total)}</span>
            </div>
          </div>

          <div className="field">
            <label>Descuento</label>
            <input
              type="number"
              placeholder="0"
              inputMode="numeric"
              value={descuento}
              onChange={(e) => setDescuento(e.target.value)}
              tabIndex={-1}
            />
          </div>
          {descNum > 0 && (
            <div className="field">
              <label>Motivo del descuento</label>
              <input
                type="text"
                placeholder="Ej: cliente frecuente"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                tabIndex={-1}
              />
            </div>
          )}

          <div className="field">
            <label>
              Cómo paga{' '}
              {total > 0 && (
                <span
                  style={{
                    float: 'right',
                    fontWeight: 700,
                    color: falta === 0 ? 'var(--ok)' : falta > 0 ? '#b8874a' : 'var(--danger)',
                  }}
                >
                  {falta === 0 ? 'completo' : falta > 0 ? `faltan ${fmt(falta)}` : `sobran ${fmt(-falta)}`}
                </span>
              )}
            </label>
            <div className="pays-grid">
              {MEDIOS.map((m, idx) => (
                <div className="pay-row" key={m}>
                  <button
                    className="pay-quick"
                    tabIndex={-1}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      pagarTodoCon(m);
                    }}
                  >
                    {m}
                  </button>
                  <input
                    type="number"
                    className="pay-amt"
                    placeholder="0"
                    inputMode="numeric"
                    value={pagos[m] || ''}
                    tabIndex={idx + 2}
                    onFocus={(e) => {
                      if (!pagos[m] && pagado > 0 && falta > 0) {
                        cambiarPago(m, falta);
                        e.target.select();
                      }
                    }}
                    onChange={(e) => cambiarPago(m, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      if (!pagos[m] && falta > 0) {
                        // Rellena solo lo que falte, sin tocar lo que ya haya en otros medios.
                        cambiarPago(m, falta);
                      } else {
                        const siguiente = document.querySelector(`[tabindex="${idx + 3}"]`);
                        if (siguiente) siguiente.focus();
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <button className="btn" disabled={cobrando} onClick={cobrar} tabIndex={MEDIOS.length + 2}>
            {cobrando ? 'Cobrando…' : 'Cobrar'}
          </button>
          <button className="btn ghost" onClick={vaciar} tabIndex={MEDIOS.length + 3}>
            Vaciar venta
          </button>
          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      </div>
    </div>
  );
}

function Tile({ item, disponible, enCarrito, onClick, seleccionado }) {
  const clase = disponible <= 0 ? 'stock-zero' : disponible <= 5 ? 'stock-low' : 'stock-ok';
  return (
    <button
      className={`tile ${seleccionado ? 'tile-sel' : ''}`}
      disabled={disponible <= 0}
      onClick={onClick}
      tabIndex={-1}
    >
      <div>
        <div className="tile-name">{item.name}</div>
        {item.tipo === 'nombre' && <div className="tile-price">{fmt(item.price)}</div>}
      </div>
      <div className={`tile-stock ${clase}`}>
        {disponible}
        <small>DISP.</small>
      </div>
      {enCarrito > 0 && <div className="tile-inbag">{enCarrito} en la venta</div>}
    </button>
  );
}
