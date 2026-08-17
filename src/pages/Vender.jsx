import { useEffect, useMemo, useState } from 'react';
import { suscribirInventario, sembrarCatalogoInicial } from '../lib/inventario';
import { registrarVenta } from '../lib/ventas';
import { reiniciarParaProduccion } from '../lib/reset';

const MEDIOS = ['Efectivo', 'Datáfono', 'Nequi', 'Addi', 'PTM', 'Sistecrédito'];

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
  const [sembrando, setSembrando] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  const [confirmandoReinicio, setConfirmandoReinicio] = useState(false);
  const [textoConfirma, setTextoConfirma] = useState('');

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

  const porId = useMemo(() => {
    const m = {};
    (inventario || []).forEach((i) => (m[i.id] = i));
    return m;
  }, [inventario]);

  const nombreItems = (inventario || []).filter((i) => i.tipo === 'nombre' && !i.oculto);
  const precioItems = (inventario || []).filter((i) => i.tipo === 'precio' && !i.oculto);

  function stockDisponible(id) {
    const it = porId[id];
    if (!it) return 0;
    return (it.stock || 0) - (carrito[id] || 0);
  }

  function agregar(id) {
    if (stockDisponible(id) <= 0) return;
    setCarrito((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
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
      setCarrito({});
      setDescuento('');
      setMotivo('');
      setPagos({});
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar la venta.' });
    } finally {
      setCobrando(false);
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

  async function ejecutarReinicio() {
    if (textoConfirma.trim().toUpperCase() !== 'REINICIAR') return;
    setReiniciando(true);
    try {
      const { nVentasBorradas } = await reiniciarParaProduccion();
      alert(
        `Listo. Se borraron ${nVentasBorradas} ventas de prueba, el stock quedó en 0 en todas las referencias, y la próxima venta real será la N.º 1.\n\nAhora carga el conteo físico real, referencia por referencia, en Firestore.`
      );
      setConfirmandoReinicio(false);
      setTextoConfirma('');
    } catch (e) {
      alert('No se pudo reiniciar: ' + e.message);
    } finally {
      setReiniciando(false);
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
    <div className="sale-grid">
      {usuario.id === 'nelson' && (
        <div className="card modo-prueba" style={{ gridColumn: '1 / -1' }}>
          {!confirmandoReinicio ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, fontSize: 13 }}>
                <b>Modo prueba.</b> Cuando Blanca y Sofía terminen de probar y vayan a
                empezar a usarlo de verdad, borra los datos de prueba y arranca en 0.
              </span>
              <button
                className="btn ghost sm"
                style={{ width: 'auto' }}
                onClick={() => setConfirmandoReinicio(true)}
              >
                Reiniciar para producción
              </button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, margin: '0 0 8px' }}>
                Esto <b>borra todas las ventas</b> que haya hasta ahora, pone el{' '}
                <b>stock de todo en 0</b> y reinicia el consecutivo. No se puede deshacer.
                Escribe <b>REINICIAR</b> para confirmar.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={textoConfirma}
                  onChange={(e) => setTextoConfirma(e.target.value)}
                  placeholder="REINICIAR"
                  style={{ maxWidth: 220 }}
                />
                <button
                  className="btn ghost sm"
                  style={{ width: 'auto' }}
                  onClick={() => {
                    setConfirmandoReinicio(false);
                    setTextoConfirma('');
                  }}
                >
                  Cancelar
                </button>
                <button
                  className="btn sm"
                  style={{ width: 'auto', background: 'var(--danger)' }}
                  disabled={textoConfirma.trim().toUpperCase() !== 'REINICIAR' || reiniciando}
                  onClick={ejecutarReinicio}
                >
                  {reiniciando ? 'Reiniciando…' : 'Sí, borrar todo y reiniciar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>
          Prendas
          <span className="side">
            {inventario.reduce((s, i) => s + (i.stock || 0), 0)} en total
          </span>
        </h2>
        <div className="cat-split">
          <div>
            <div className="split-label">Con nombre</div>
            <div className="tiles">
              {nombreItems.map((it) => (
                <Tile
                  key={it.id}
                  item={it}
                  disponible={stockDisponible(it.id)}
                  enCarrito={carrito[it.id] || 0}
                  onClick={() => agregar(it.id)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="split-label">Por precio</div>
            <div className="tiles">
              {precioItems.map((it) => (
                <Tile
                  key={it.id}
                  item={it}
                  disponible={stockDisponible(it.id)}
                  enCarrito={carrito[it.id] || 0}
                  onClick={() => agregar(it.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ticket">
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
                  <button onClick={() => quitarLinea(l.id)}>✕</button>
                </div>
              ))
            )}
          </div>

          <div className="totals">
            <div className="trow">
              <span>Subtotal</span>
              <span className="v">{fmt(subtotal)}</span>
            </div>
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
            {MEDIOS.map((m) => (
              <div className="pay-row" key={m}>
                <button
                  className="pay-quick"
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
                  onFocus={(e) => {
                    if (!pagos[m] && pagado > 0 && falta > 0) {
                      cambiarPago(m, falta);
                      e.target.select();
                    }
                  }}
                  onChange={(e) => cambiarPago(m, e.target.value)}
                />
              </div>
            ))}
          </div>

          <button className="btn" disabled={cobrando} onClick={cobrar}>
            {cobrando ? 'Cobrando…' : 'Cobrar'}
          </button>
          <button className="btn ghost" onClick={vaciar}>
            Vaciar venta
          </button>
          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      </div>
    </div>
  );
}

function Tile({ item, disponible, enCarrito, onClick }) {
  const clase = disponible <= 0 ? 'stock-zero' : disponible <= 5 ? 'stock-low' : 'stock-ok';
  return (
    <button className="tile" disabled={disponible <= 0} onClick={onClick}>
      <div>
        <div className="tile-name">{item.name}</div>
        <div className="tile-price">{fmt(item.price)}</div>
      </div>
      <div className={`tile-stock ${clase}`}>
        {disponible}
        <small>DISP.</small>
      </div>
      {enCarrito > 0 && <div className="tile-inbag">{enCarrito} en la venta</div>}
    </button>
  );
}
