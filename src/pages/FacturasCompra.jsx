import { useEffect, useMemo, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import {
  crearPedidoCompra,
  suscribirComprasDelDia,
  suscribirComprasDeUsuario,
  suscribirPedidosPendientes,
  suscribirComprasRecientes,
  ajustarPedido,
  eliminarPedido,
  nuevaLineaId,
  hoyStr,
} from '../lib/compras';

// Pantalla para pasar las facturas de compra. La usan Fausto (ComprasFausto.jsx)
// y Nelson (Compras.jsx), con pocas diferencias (ver "modo").
//
// - Cada factura de papel es una factura en pantalla: un recibo con sus
//   renglones y su propio total. Se guarda apenas se termina, como un pedido
//   aparte, así la vendedora la recibe factura por factura.
// - Cada renglón se agrega con un solo botón y una pregunta a la vez: primero
//   la referencia (es la que decide cómo entra al inventario); si es una ref
//   "por precio", qué prenda es (opcional); luego cuántas y a cuánto cada una.
// - Arriba está la suma de las facturas de hoy, como la tirilla de una
//   sumadora. Abajo, las que todavía no han recibido en la tienda. Al tocar
//   una, se despliega su detalle ahí mismo.
// - Todo se actualiza en vivo: lo que registra o recibe otra persona aparece
//   solo, sin recargar la página.
// - La factura que se está armando queda guardada en este dispositivo hasta
//   terminarla: si se cambia de pestaña o se recarga la página, no se pierde.
//
// En ninguno de los dos modos se pregunta proveedor ni de dónde sale la
// plata: siempre sale del efectivo que recoge Fausto (ver "Entrega de dinero").
// modo "fausto": solo ve y toca sus propias facturas.
// modo "nelson": ve las facturas de todos, y puede corregir o eliminar
// cualquiera que siga sin recibir.

const PRENDAS = ['Chaquetas de jean', 'Chaquetas de cuerina', 'Short', 'Blusa', 'Faldas'];
const UMBRAL_COSTO_BAJO = 5000;

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}
function num(n) {
  return Math.round(n || 0).toLocaleString('es-CO');
}
function renglonesTxt(n) {
  return n + (n === 1 ? ' renglón' : ' renglones');
}
function totalLineas(lineas) {
  return lineas.reduce((s, l) => s + l.cant * l.costo, 0);
}

function claveBorrador(usuarioId) {
  return `evejeans_factura_borrador_${usuarioId}`;
}
function leerBorrador(usuarioId) {
  try {
    const crudo = localStorage.getItem(claveBorrador(usuarioId));
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;
  }
}
function guardarBorrador(usuarioId, datos) {
  try {
    if (datos) localStorage.setItem(claveBorrador(usuarioId), JSON.stringify(datos));
    else localStorage.removeItem(claveBorrador(usuarioId));
  } catch {
    // Si el navegador no deja guardar, todo sigue funcionando; solo que la
    // factura sin terminar no sobrevive a una recarga.
  }
}

// Cómo se lee un renglón en el recibo: "5 Chaquetas de jean" / "40 SEF" /
// "5 ref $70.000" (ref de precio sin nota).
function descLinea(l) {
  if (l.refTipo !== 'precio') return l.refName;
  return l.prenda || `ref ${l.refName}`;
}
function subLinea(l) {
  const partes = [];
  if (l.refTipo === 'precio' && l.prenda) partes.push(`ref ${l.refName}`);
  partes.push(`${fmt(l.costo)} c/u`);
  return partes.join(' · ');
}

export default function FacturasCompra({ usuario, modo }) {
  const esNelson = modo === 'nelson';
  const borradorInicial = useMemo(() => leerBorrador(usuario.id), [usuario.id]);
  const hoy = hoyStr();

  const [inventario, setInventario] = useState(null);
  const [delDia, setDelDia] = useState(null); // facturas de hoy de todos
  const [misCompras, setMisCompras] = useState(null); // solo Fausto: todas las suyas
  const [pendientesTodos, setPendientesTodos] = useState(null); // solo Nelson
  const [recientes, setRecientes] = useState(null); // solo Nelson: para el historial
  const [errorCarga, setErrorCarga] = useState('');

  const [vista, setVista] = useState(borradorInicial?.abierta ? 'factura' : 'hoy');
  // { compraId: null | id (si se corrige una guardada), facturaNum, fecha,
  //   usuarioId (dueño), lineas }
  const [abierta, setAbierta] = useState(borradorInicial?.abierta || null);
  const [hoja, setHoja] = useState(null);
  const [flujo, setFlujo] = useState(null); // { paso, d: {refId, prenda, cant, costo}, edit, orig }
  const [kp, setKp] = useState('');
  const [verOtra, setVerOtra] = useState(false);
  const [otraTxt, setOtraTxt] = useState('');
  const [costoBajo, setCostoBajo] = useState(false);
  const [expandida, setExpandida] = useState(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState(null);
  const [verHistorial, setVerHistorial] = useState(false);
  // La lista de "sin recibir" arranca recogida en una sola línea: si no,
  // cada factura de hoy sale dos veces (en la tirilla y en esta lista).
  const [verPendientes, setVerPendientes] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');
  const [toast, setToast] = useState('');
  const [resaltar, setResaltar] = useState(null);
  const [nuevoRenglon, setNuevoRenglon] = useState(null);

  // ---------- Datos en vivo ----------
  useEffect(() => {
    const quitar = suscribirInventario(setInventario, (err) =>
      setErrorCarga('No se pudo leer el inventario: ' + err.message)
    );
    return quitar;
  }, []);

  useEffect(() => {
    const alFallar = (err) => setErrorCarga('No se pudieron leer las facturas: ' + err.message);
    const quitar = [suscribirComprasDelDia(hoy, setDelDia, alFallar)];
    if (esNelson) {
      quitar.push(suscribirPedidosPendientes((lista) => setPendientesTodos(lista), alFallar));
      quitar.push(suscribirComprasRecientes(setRecientes, alFallar, 60));
    } else {
      quitar.push(suscribirComprasDeUsuario(usuario.id, setMisCompras, alFallar));
    }
    return () => quitar.forEach((q) => q());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    guardarBorrador(usuario.id, abierta ? { abierta } : null);
  }, [abierta, usuario.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // La factura recién guardada se resalta un momento y se apaga sola, para
  // que no parezca que tiene algo distinto a las demás.
  useEffect(() => {
    if (!resaltar) return;
    const t = setTimeout(() => setResaltar(null), 3000);
    return () => clearTimeout(t);
  }, [resaltar]);

  useEffect(() => {
    if (nuevoRenglon == null) return;
    const t = setTimeout(() => setNuevoRenglon(null), 700);
    return () => clearTimeout(t);
  }, [nuevoRenglon]);

  // ---------- Listas ----------
  const porId = useMemo(() => {
    const m = {};
    (inventario || []).forEach((i) => (m[i.id] = i));
    return m;
  }, [inventario]);
  const itemsPrecio = useMemo(
    () =>
      (inventario || [])
        .filter((i) => i.tipo === 'precio' && !i.oculto)
        .sort((a, b) => (a.price || 0) - (b.price || 0)),
    [inventario]
  );
  const itemsNombre = useMemo(
    () =>
      (inventario || [])
        .filter((i) => i.tipo === 'nombre' && !i.oculto)
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [inventario]
  );

  // Facturas de hoy de todos, en el orden en que se registraron, con su número
  // del día (las de antes de este cambio no lo traen guardado: se numeran por
  // orden).
  const delDiaNumeradas = useMemo(() => {
    const lista = (delDia || []).slice().reverse();
    return lista.map((c, i) => ({ ...c, num: c.facturaNum || i + 1 }));
  }, [delDia]);
  const numeroDe = useMemo(() => {
    const m = {};
    delDiaNumeradas.forEach((c) => (m[c.id] = c.num));
    return m;
  }, [delDiaNumeradas]);
  const siguienteNum = delDiaNumeradas.reduce((m, c) => Math.max(m, c.num), 0) + 1;

  const facturasHoy = esNelson ? delDiaNumeradas : delDiaNumeradas.filter((c) => c.usuarioId === usuario.id);
  const totalHoy = facturasHoy.reduce((s, c) => s + (c.totalGeneral || 0), 0);

  const pendientes = useMemo(() => {
    const lista = esNelson ? pendientesTodos || [] : (misCompras || []).filter((c) => c.estado === 'pendiente');
    return lista
      .map((c) => ({ ...c, num: numeroDe[c.id] || c.facturaNum || null }))
      .sort((a, b) => (a.fecha === b.fecha ? (a.num || 0) - (b.num || 0) : a.fecha < b.fecha ? 1 : -1));
  }, [esNelson, pendientesTodos, misCompras, numeroDe]);

  const historial = useMemo(
    () =>
      (recientes || [])
        .filter((c) => c.estado === 'confirmada' && c.fecha !== hoy)
        .slice(0, 20)
        .map((c) => ({ ...c, num: c.facturaNum || null })),
    [recientes, hoy]
  );

  const numAbierta = abierta ? abierta.facturaNum || (abierta.compraId ? '' : siguienteNum) : null;
  const cargando = !inventario || !delDia || (esNelson ? !pendientesTodos || !recientes : !misCompras);

  // Si se está corrigiendo una factura y mientras tanto la reciben en la
  // tienda (o se elimina), se cierra la corrección: ya no se puede cambiar.
  useEffect(() => {
    if (!abierta?.compraId || cargando) return;
    if (!pendientes.some((c) => c.id === abierta.compraId)) {
      setAbierta(null);
      setHoja(null);
      setFlujo(null);
      setVista('hoy');
      setMsg(
        `La factura ${abierta.facturaNum || ''} ya no está pendiente: la recibieron en la tienda o se eliminó, así que ya no se puede cambiar.`
      );
    }
  }, [pendientes, abierta, cargando]);

  function puedeCambiar(c) {
    return c.estado === 'pendiente' && (esNelson || c.usuarioId === usuario.id);
  }

  // ---------- Asistente de un renglón ----------
  function esPrecio(refId) {
    return porId[refId]?.tipo === 'precio';
  }
  function pasosDe(d) {
    return d.refId == null || esPrecio(d.refId) ? ['ref', 'prenda', 'cant', 'costo'] : ['ref', 'cant', 'costo'];
  }
  function irAPaso(fl, paso) {
    setVerOtra(false);
    setOtraTxt('');
    setCostoBajo(false);
    if (paso === 'cant' || paso === 'costo') setKp(fl.d[paso] != null ? String(fl.d[paso]) : '');
    setFlujo({ ...fl, paso });
    setHoja({ tipo: 'flujo' });
  }
  function siguiente(fl) {
    const ps = pasosDe(fl.d);
    irAPaso(fl, ps[ps.indexOf(fl.paso) + 1]);
  }
  function empezarRenglon() {
    irAPaso({ d: { refId: null, prenda: null, cant: null, costo: null }, edit: null, orig: null }, 'ref');
  }
  function cerrarFlujo() {
    // Cerrar a mitad de una corrección deja el renglón como estaba.
    if (flujo?.edit != null && flujo.orig) {
      setAbierta((a) => {
        const lineas = a.lineas.slice();
        lineas.splice(flujo.edit, 0, flujo.orig);
        return { ...a, lineas };
      });
    }
    setFlujo(null);
    setHoja(null);
    setCostoBajo(false);
  }
  function atras() {
    const ps = pasosDe(flujo.d);
    const i = ps.indexOf(flujo.paso);
    if (i === 0) cerrarFlujo();
    else irAPaso(flujo, ps[i - 1]);
  }
  function elegirRef(it) {
    const d = { ...flujo.d, refId: it.id, prenda: it.id === flujo.d.refId ? flujo.d.prenda : null };
    siguiente({ ...flujo, d });
  }
  function elegirPrenda(p) {
    siguiente({ ...flujo, d: { ...flujo.d, prenda: p } });
  }
  function usarOtra() {
    const t = otraTxt.trim();
    if (t) elegirPrenda(t.charAt(0).toUpperCase() + t.slice(1));
  }
  function teclear(v) {
    setCostoBajo(false);
    if (v === 'borrar') {
      setKp((k) => k.slice(0, -1));
      return;
    }
    setKp((k) => {
      if (k === '' && (v === '0' || v === '000')) return k;
      return (k + v).slice(0, flujo?.paso === 'cant' ? 5 : 9);
    });
  }
  function listoCantidad() {
    const c = parseInt(kp || '0', 10);
    if (c > 0) siguiente({ ...flujo, d: { ...flujo.d, cant: c } });
  }
  function listoCosto(confirmado) {
    const costo = parseInt(kp || '0', 10);
    if (costo <= 0) return;
    // El aviso de precio bajo solo sale al tocar "Agregar", no mientras se
    // escribe — si no, sale apenas se teclea el primer número.
    if (costo < UMBRAL_COSTO_BAJO && !confirmado) {
      setCostoBajo(true);
      return;
    }
    const it = porId[flujo.d.refId];
    const linea = {
      lineaId: flujo.orig?.lineaId || nuevaLineaId(),
      refId: flujo.d.refId,
      refName: it?.name || flujo.orig?.refName || '',
      refTipo: it?.tipo || flujo.orig?.refTipo || 'nombre',
      prenda: it?.tipo === 'precio' ? flujo.d.prenda || '' : '',
      cant: flujo.d.cant,
      costo,
    };
    const pos = flujo.edit != null ? flujo.edit : abierta.lineas.length;
    setAbierta((a) => {
      const lineas = a.lineas.slice();
      lineas.splice(pos, 0, linea);
      return { ...a, lineas };
    });
    setNuevoRenglon(linea.lineaId);
    setFlujo(null);
    setHoja(null);
    setCostoBajo(false);
  }

  // En computador (Nelson), los números también se pueden escribir con el
  // teclado: dígitos, borrar y Enter.
  useEffect(() => {
    function alTeclear(e) {
      if (e.key === 'Escape') {
        if (flujo) cerrarFlujo();
        else setHoja(null);
        return;
      }
      if (!flujo || (flujo.paso !== 'cant' && flujo.paso !== 'costo')) return;
      if (e.target?.tagName === 'INPUT') return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        teclear(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        teclear('borrar');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flujo.paso === 'cant') listoCantidad();
        else listoCosto(costoBajo);
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  });

  // ---------- Factura ----------
  function nuevaFactura() {
    setMsg('');
    setExpandida(null);
    if (!abierta) {
      setAbierta({
        compraId: null,
        facturaNum: null,
        fecha: hoy,
        usuarioId: usuario.id,
        lineas: [],
      });
    }
    setVista('factura');
    window.scrollTo(0, 0);
  }

  function irAHoy() {
    setHoja(null);
    setFlujo(null);
    setVista('hoy');
    window.scrollTo(0, 0);
  }

  function lineasDePedido(c) {
    return (c.items || []).map((i) => ({
      lineaId: i.lineaId || nuevaLineaId(),
      refId: i.id,
      refName: i.name,
      refTipo: porId[i.id]?.tipo || (String(i.name).startsWith('$') ? 'precio' : 'nombre'),
      prenda: i.nota || '',
      cant: i.cantidadPedida,
      costo: i.costoUnitario,
    }));
  }

  function corregirFactura(c) {
    setAbierta({
      compraId: c.id,
      facturaNum: c.num || c.facturaNum || null,
      fecha: c.fecha,
      usuarioId: c.usuarioId,
      lineas: lineasDePedido(c),
    });
    setExpandida(null);
    setMsg('');
    setVista('factura');
    window.scrollTo(0, 0);
  }

  async function eliminarFactura(c) {
    setGuardando(true);
    try {
      await eliminarPedido(c.id);
      setExpandida(null);
      setConfirmarEliminar(null);
      setToast(c.num ? `Factura ${c.num} eliminada` : 'Factura eliminada');
    } catch (e) {
      setMsg('No se pudo eliminar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  function tocarTerminar() {
    if (!abierta || abierta.lineas.length === 0 || guardando) return;
    guardarFactura();
  }

  async function guardarFactura() {
    setMsg('');
    setGuardando(true);
    const items = abierta.lineas.map((l) => ({
      id: l.refId,
      lineaId: l.lineaId,
      name: l.refName,
      cantidadPedida: l.cant,
      costoUnitario: l.costo,
      nota: l.prenda || '',
    }));
    const total = totalLineas(abierta.lineas);
    const numero = numAbierta;
    try {
      let id = abierta.compraId;
      if (abierta.compraId) {
        await ajustarPedido(abierta.compraId, items);
      } else {
        const res = await crearPedidoCompra({
          items,
          // No se anota proveedor, y la plata siempre sale del efectivo que
          // recoge Fausto de la caja (ver "Entrega de dinero").
          proveedor: null,
          origen: 'Efectivo de la caja',
          usuario,
          facturaNum: numero,
        });
        id = res.id;
      }
      setAbierta(null);
      setHoja(null);
      setVista('hoy');
      setResaltar(id);
      setToast(`✓ Factura ${numero} guardada · ${fmt(total)}`);
      window.scrollTo(0, 0);
    } catch (e) {
      setMsg('No se pudo guardar la factura: ' + (e.message || 'error desconocido') + '. Inténtalo de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  function descartarFactura() {
    setAbierta(null);
    setHoja(null);
    setVista('hoy');
  }

  if (errorCarga) {
    return (
      <div className="ff-page">
        <div className="ff-aviso-error">{errorCarga}</div>
      </div>
    );
  }
  if (cargando) return <div className="loading">Cargando…</div>;

  // ---------- Detalle desplegable de una factura guardada ----------
  function quienTxt(c) {
    if (!esNelson) return '';
    return c.usuarioId === usuario.id ? ' · tuya' : ` · ${c.usuarioNombre || ''}`;
  }

  function lineasGuardadas(c) {
    return lineasDePedido(c);
  }

  function detalle(c, clave) {
    const cambiable = puedeCambiar(c);
    return (
      <div className="ff-detalle">
        {lineasGuardadas(c).map((l) => (
          <div key={l.lineaId} className="ff-renglon fijo">
            <div className="ff-renglon-top">
              <span className="ff-renglon-desc">
                <b>{l.cant}</b> {descLinea(l)}
              </span>
              <span className="ff-renglon-amt">{num(l.cant * l.costo)}</span>
            </div>
            <div className="ff-renglon-sub">{subLinea(l)}</div>
          </div>
        ))}
        <hr className="ff-regla" />
        <div className="ff-recibo-total chico">
          <span>TOTAL</span>
          <span>{fmt(c.totalGeneral)}</span>
        </div>
        <div className="ff-detalle-estado">
          Guardada a las {c.hora}
          {esNelson && c.usuarioNombre ? ` por ${c.usuarioNombre}` : ''}
          {' · '}
          {c.estado === 'pendiente'
            ? 'todavía no la reciben en la tienda'
            : `ya la recibió ${c.confirmadoPor || 'la tienda'}, no se puede cambiar`}
        </div>
        {cambiable && confirmarEliminar === clave && (
          <div className="ff-confirmar">
            <div>¿Seguro que quieres eliminar la factura {c.num || ''}?</div>
            <div className="ff-fila-btns">
              <button className="ff-btn-main peligro" disabled={guardando} onClick={() => eliminarFactura(c)}>
                {guardando ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
              <button className="ff-btn-sec" onClick={() => setConfirmarEliminar(null)}>
                No
              </button>
            </div>
          </div>
        )}
        {cambiable && confirmarEliminar !== clave && abierta && (
          <div className="ff-detalle-estado">Para corregirla, primero termina (o descarta) la factura que tienes abierta.</div>
        )}
        {cambiable && confirmarEliminar !== clave && !abierta && (
          <div className="ff-fila-btns fila">
            <button className="ff-btn-sec" onClick={() => corregirFactura(c)}>
              Corregir
            </button>
            <button className="ff-btn-sec peligro" onClick={() => setConfirmarEliminar(clave)}>
              Eliminar
            </button>
          </div>
        )}
      </div>
    );
  }

  function alternar(clave) {
    setExpandida((e) => (e === clave ? null : clave));
    setConfirmarEliminar(null);
    setResaltar(null);
  }

  function filaLista(c, clave, titulo) {
    const ab = expandida === clave;
    return (
      <div key={clave}>
        <button className={`ff-vieja ${ab ? 'abierta' : ''}`} aria-expanded={ab} onClick={() => alternar(clave)}>
          <span>
            {titulo}
            <span className="ff-flecha">›</span>
            <small>
              {c.hora} · {renglonesTxt((c.items || []).length)}
              {quienTxt(c)}
            </small>
          </span>
          <span className="ff-tape-amt">{num(c.totalGeneral)}</span>
        </button>
        {ab && detalle(c, clave)}
      </div>
    );
  }

  function tituloFactura(c) {
    const n = c.num ? `Factura ${c.num}` : 'Factura';
    return c.fecha === hoy ? `${n} de hoy` : `${n} del ${c.fecha}`;
  }

  // ---------- Pantalla: Hoy ----------
  function vistaHoy() {
    return (
      <>
        <div className="ff-bar">
          <span className="ff-bar-title">Compras de hoy</span>
        </div>

        <section className="ff-dia">
          <div className="ff-dia-label">{esNelson ? 'Comprado hoy entre todos' : 'Llevas hoy'}</div>
          <div className="ff-dia-total">{fmt(totalHoy)}</div>
          <div className="ff-dia-sub">
            {facturasHoy.length} {facturasHoy.length === 1 ? 'factura guardada' : 'facturas guardadas'}
          </div>
        </section>

        {msg && <div className="ff-aviso-error">{msg}</div>}

        {abierta && (
          <button className="ff-pendiente" onClick={nuevaFactura}>
            <span>
              <b>
                Factura {numAbierta} · {abierta.compraId ? 'corrección sin guardar' : 'sin terminar'}
              </b>
              <small>
                {renglonesTxt(abierta.lineas.length)} · {fmt(totalLineas(abierta.lineas))} (todavía no suma)
              </small>
            </span>
            <span className="ff-seguir">Seguir ›</span>
          </button>
        )}

        <section className="ff-tape" aria-label="Suma de las facturas de hoy">
          <div className="ff-tape-cap">Facturas de hoy · toca una para ver el detalle</div>
          {facturasHoy.length === 0 && <div className="ff-tape-vacia">Todavía no hay facturas hoy.</div>}
          {facturasHoy.map((c, i) => {
            const clave = 't' + c.id;
            const ab = expandida === clave;
            return (
              <div key={c.id}>
                <button
                  className={`ff-tape-row ${resaltar === c.id ? 'nueva' : ''} ${ab ? 'abierta' : ''}`}
                  aria-expanded={ab}
                  onClick={() => alternar(clave)}
                >
                  <span className="ff-tape-op">{i === 0 ? '' : '+'}</span>
                  <span className="ff-tape-name">
                    Factura {c.num}
                    <span className="ff-flecha">›</span>
                    <small>
                      {c.hora} · {renglonesTxt((c.items || []).length)}
                      {quienTxt(c)}
                    </small>
                  </span>
                  <span className="ff-tape-amt">{num(c.totalGeneral)}</span>
                </button>
                {ab && detalle(c, clave)}
              </div>
            );
          })}
          {facturasHoy.length > 0 && (
            <div className="ff-tape-sum">
              <span>=</span>
              <span>Total del día</span>
              <span>{num(totalHoy)}</span>
            </div>
          )}
        </section>

        {pendientes.length > 0 && (
          <section className="ff-viejas">
            <button
              className={`ff-resumen-pend ${verPendientes ? 'abierta' : ''}`}
              aria-expanded={verPendientes}
              onClick={() => {
                setVerPendientes((v) => !v);
                setExpandida(null);
                setConfirmarEliminar(null);
              }}
            >
              <span>
                {pendientes.length} {pendientes.length === 1 ? 'factura' : 'facturas'} sin recibir en la tienda
                <span className="ff-flecha">›</span>
              </span>
              <span className="ff-tape-amt">{num(pendientes.reduce((s, c) => s + (c.totalGeneral || 0), 0))}</span>
            </button>
            {verPendientes && (
              <div className="ff-resumen-lista">{pendientes.map((c) => filaLista(c, 'p' + c.id, tituloFactura(c)))}</div>
            )}
          </section>
        )}

        {esNelson && historial.length > 0 && verHistorial && (
          <section className="ff-viejas">
            <div className="ff-tape-cap">Ya recibidas, días anteriores</div>
            {historial.map((c) => filaLista(c, 'h' + c.id, tituloFactura(c)))}
          </section>
        )}
        {esNelson && historial.length > 0 && (
          <button className="ff-historial-link" onClick={() => setVerHistorial((v) => !v)}>
            {verHistorial ? 'Ocultar las ya recibidas de días anteriores' : 'Ver las ya recibidas de días anteriores'}
          </button>
        )}

        <div className="ff-cta">
          <button className="ff-btn-main" onClick={nuevaFactura}>
            {abierta ? `Seguir con la factura ${numAbierta}` : '+ Nueva factura'}
          </button>
        </div>
      </>
    );
  }

  // ---------- Pantalla: una factura ----------
  function vistaFactura() {
    const total = totalLineas(abierta.lineas);
    const corrigiendo = !!abierta.compraId;
    const ajena = esNelson && corrigiendo && abierta.usuarioId !== usuario.id;
    return (
      <>
        <div className="ff-bar">
          <button className="ff-back" onClick={irAHoy}>
            ‹ Hoy
          </button>
          <span className="ff-bar-title">
            {corrigiendo ? 'Corrigiendo factura' : 'Factura'} {numAbierta}
          </span>
        </div>

        {msg && <div className="ff-aviso-error">{msg}</div>}

        <div className="ff-recibo">
          <div className="ff-recibo-head">
            FACTURA {numAbierta}
            <span>
              {corrigiendo
                ? `Del ${abierta.fecha}${ajena ? ' · de otra persona' : ''} · cambia lo que haga falta`
                : 'Copia cada renglón del papel'}
            </span>
          </div>
          <hr className="ff-regla" />
          {abierta.lineas.map((l, i) => (
            <button
              key={l.lineaId}
              className={`ff-renglon ${nuevoRenglon === l.lineaId ? 'nuevo' : ''}`}
              onClick={() => setHoja({ tipo: 'renglon', i })}
            >
              <div className="ff-renglon-top">
                <span className="ff-renglon-desc">
                  <b>{l.cant}</b> {descLinea(l)}
                </span>
                <span className="ff-renglon-amt">{num(l.cant * l.costo)}</span>
              </div>
              <div className="ff-renglon-sub">{subLinea(l)}</div>
            </button>
          ))}
          <button className="ff-agregar" onClick={empezarRenglon}>
            + Agregar renglón
          </button>
          <hr className="ff-regla" />
          <div className="ff-recibo-total">
            <span>TOTAL</span>
            <span>{fmt(total)}</span>
          </div>
          {abierta.lineas.length > 0 && <div className="ff-recibo-nota">Compáralo con el total que dice el papel.</div>}
        </div>

        <button className="ff-descartar" onClick={() => setHoja({ tipo: 'descartar' })}>
          {corrigiendo ? 'Cancelar la corrección' : 'Descartar esta factura'}
        </button>

        <div className="ff-cta">
          <button className="ff-btn-main" disabled={abierta.lineas.length === 0 || guardando} onClick={tocarTerminar}>
            {guardando ? 'Guardando…' : `${corrigiendo ? 'Guardar corrección' : 'Terminar factura'} · ${fmt(total)}`}
          </button>
        </div>
      </>
    );
  }

  // ---------- Hojas que suben desde abajo ----------
  function teclado(conMil) {
    return (
      <div className="ff-teclado">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((t) => (
          <button key={t} className="ff-tecla" onClick={() => teclear(t)}>
            {t}
          </button>
        ))}
        {conMil ? (
          <button className="ff-tecla mil" onClick={() => teclear('000')}>
            000
          </button>
        ) : (
          <span />
        )}
        <button className="ff-tecla" onClick={() => teclear('0')}>
          0
        </button>
        <button className="ff-tecla borrar" aria-label="Borrar" onClick={() => teclear('borrar')}>
          ⌫
        </button>
      </div>
    );
  }

  function hojaFlujo() {
    const d = flujo.d;
    const ps = pasosDe(d);
    const i = ps.indexOf(flujo.paso);
    const it = d.refId != null ? porId[d.refId] : null;

    let cuerpo = null;
    if (flujo.paso === 'ref') {
      cuerpo = (
        <>
          <h3 className="ff-sheet-title">¿A cómo se vende?</h3>
          {itemsPrecio.length > 0 && (
            <>
              <div className="ff-grupo">Por precio</div>
              <div className="ff-refs">
                {itemsPrecio.map((x) => (
                  <button key={x.id} className={`ff-ref ${d.refId === x.id ? 'on' : ''}`} onClick={() => elegirRef(x)}>
                    {x.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {itemsNombre.length > 0 && (
            <>
              <div className="ff-grupo">Con nombre</div>
              <div className="ff-refs">
                {itemsNombre.map((x) => (
                  <button key={x.id} className={`ff-ref nombre ${d.refId === x.id ? 'on' : ''}`} onClick={() => elegirRef(x)}>
                    {x.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      );
    } else if (flujo.paso === 'prenda') {
      const ultima = it?.ultimaNota;
      cuerpo = (
        <>
          <h3 className="ff-sheet-title">¿Qué prenda es?</h3>
          <p className="ff-sheet-sub">
            Opcional. La ref {it?.name} puede ser varias cosas; esto le ayuda a la vendedora a reconocerla al recibir.
          </p>
          <div className="ff-chips">
            {PRENDAS.map((p) => (
              <button key={p} className={`ff-chip ${d.prenda === p ? 'on' : ''}`} onClick={() => elegirPrenda(p)}>
                {p}
                {ultima === p && <small>la última vez</small>}
              </button>
            ))}
            {ultima && !PRENDAS.includes(ultima) && (
              <button className={`ff-chip ${d.prenda === ultima ? 'on' : ''}`} onClick={() => elegirPrenda(ultima)}>
                {ultima}
                <small>la última vez</small>
              </button>
            )}
            <button className="ff-chip suave" onClick={() => setVerOtra(true)}>
              Otra…
            </button>
          </div>
          {verOtra && (
            <div className="ff-otra">
              <input
                type="text"
                placeholder="Escribe la prenda"
                autoFocus
                value={otraTxt}
                onChange={(e) => setOtraTxt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    usarOtra();
                  }
                }}
              />
              <button className="ff-btn-add" disabled={!otraTxt.trim()} onClick={usarOtra}>
                Usar
              </button>
            </div>
          )}
          <button className="ff-btn-sec" onClick={() => elegirPrenda(null)}>
            Sin nota, seguir ›
          </button>
        </>
      );
    } else if (flujo.paso === 'cant') {
      const c = parseInt(kp || '0', 10);
      cuerpo = (
        <>
          <h3 className="ff-sheet-title">¿Cuántas compro?</h3>
          <p className="ff-sheet-sub">La cantidad de ese renglón de la factura.</p>
          <div className={`ff-display ${kp ? '' : 'vacio'}`}>{kp ? c : '0'}</div>
          {teclado(false)}
          <button className="ff-btn-main" disabled={c <= 0} onClick={listoCantidad}>
            Siguiente ›
          </button>
        </>
      );
    } else if (flujo.paso === 'costo') {
      const v = parseInt(kp || '0', 10);
      cuerpo = (
        <>
          <h3 className="ff-sheet-title">¿A cómo las compro?</h3>
          <p className="ff-sheet-sub">Cada una.</p>
          <div className={`ff-display ${kp ? '' : 'vacio'}`}>{kp ? fmt(v) : '$0'}</div>
          <div className="ff-cuenta">
            {d.cant} × {fmt(v)} = <b>{fmt(d.cant * v)}</b>
          </div>
          {costoBajo ? (
            <div className="ff-confirmar">
              <div>¿De verdad cada una cuesta {fmt(v)}? Parece que faltan ceros.</div>
              <div className="ff-fila-btns">
                <button
                  className="ff-btn-main"
                  onClick={() => {
                    setCostoBajo(false);
                    setKp('');
                  }}
                >
                  No, corregirlo
                </button>
                <button className="ff-btn-sec" onClick={() => listoCosto(true)}>
                  Sí, cuesta {fmt(v)}
                </button>
              </div>
            </div>
          ) : (
            <>
              {teclado(true)}
              <button className="ff-btn-main" disabled={v <= 0} onClick={() => listoCosto(false)}>
                {flujo.edit != null ? 'Guardar renglón' : 'Agregar a la factura'}
              </button>
            </>
          )}
        </>
      );
    }

    return (
      <>
        <div className="ff-flujo-top">
          <button className="ff-flujo-atras" onClick={atras}>
            {i === 0 ? 'Cancelar' : '‹ Atrás'}
          </button>
          <div className="ff-flujo-pasos" aria-label={`Paso ${i + 1} de ${ps.length}`}>
            {ps.map((p, j) => (
              <i key={p} className={j <= i ? 'hecho' : ''} />
            ))}
          </div>
        </div>
        {cuerpo}
      </>
    );
  }

  function contenidoHoja() {
    if (hoja.tipo === 'flujo' && flujo) return hojaFlujo();

    if (hoja.tipo === 'renglon') {
      const l = abierta?.lineas[hoja.i];
      if (!l) return null;
      return (
        <>
          <h3 className="ff-sheet-title">
            {l.cant} {descLinea(l)}
          </h3>
          <p className="ff-sheet-sub">
            {subLinea(l)} = {fmt(l.cant * l.costo)}
          </p>
          <div className="ff-fila-btns">
            <button
              className="ff-btn-main"
              onClick={() => {
                setAbierta((a) => ({ ...a, lineas: a.lineas.filter((_, j) => j !== hoja.i) }));
                irAPaso(
                  { d: { refId: l.refId, prenda: l.prenda || null, cant: l.cant, costo: l.costo }, edit: hoja.i, orig: l },
                  'ref'
                );
              }}
            >
              Corregir este renglón
            </button>
            <button
              className="ff-btn-sec peligro"
              onClick={() => {
                setAbierta((a) => ({ ...a, lineas: a.lineas.filter((_, j) => j !== hoja.i) }));
                setHoja(null);
              }}
            >
              Quitar renglón
            </button>
            <button className="ff-btn-sec" onClick={() => setHoja(null)}>
              Dejarlo así
            </button>
          </div>
        </>
      );
    }

    if (hoja.tipo === 'descartar') {
      const corrigiendo = !!abierta?.compraId;
      return (
        <>
          <h3 className="ff-sheet-title">{corrigiendo ? '¿Cancelar la corrección?' : '¿Descartar esta factura?'}</h3>
          <p className="ff-sheet-sub">
            {corrigiendo ? 'La factura queda como estaba guardada antes.' : 'Se borran los renglones que llevas y no se guarda nada.'}
          </p>
          <div className="ff-fila-btns">
            <button className="ff-btn-main peligro" onClick={descartarFactura}>
              {corrigiendo ? 'Sí, cancelar' : 'Sí, descartar'}
            </button>
            <button className="ff-btn-sec" onClick={() => setHoja(null)}>
              No
            </button>
          </div>
        </>
      );
    }

    return null;
  }

  return (
    <div className="ff-page">
      {toast && <div className="ff-toast">{toast}</div>}
      {vista === 'factura' && abierta ? vistaFactura() : vistaHoy()}
      {hoja && (
        <>
          <div className="ff-scrim" onClick={() => (flujo ? cerrarFlujo() : setHoja(null))} />
          <div className="ff-sheet" role="dialog" aria-modal="true">
            <div className="ff-asa" />
            {contenidoHoja()}
          </div>
        </>
      )}
    </div>
  );
}
