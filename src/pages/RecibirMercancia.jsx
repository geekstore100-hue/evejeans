import { useEffect, useMemo, useRef, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { suscribirPedidosPendientes, suscribirConfirmadasDelDia, confirmarRecepcion, claveLinea, hoyStr } from '../lib/compras';
import { leerBorrador, guardarBorrador, borrarBorrador, limpiarBorradoresHuerfanos } from '../lib/recepcionBorrador';

// Recibir mercancía: todas las facturas pendientes vienen ya abiertas, listas
// para escribir lo que se contó, cada una en su propia tarjeta con un color
// distinto (para que no se confundan los renglones de una factura con los de
// la siguiente). A la derecha, las que ya se confirmaron hoy. Todo en vivo.

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(f) {
  if (!f) return '';
  const [, m, d] = f.split('-').map(Number);
  return `${d} ${MESES[m - 1]}`;
}
function ordenFacturas(a, b) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  return (a.facturaNum || 0) - (b.facturaNum || 0);
}
function nombreFactura(p) {
  return p.facturaNum ? `Factura ${p.facturaNum}` : 'Factura';
}
// Seis colores bien distintos, según el número de la factura: cada factura
// conserva su color aunque se confirme la de al lado, y facturas seguidas
// nunca quedan del mismo color.
const COLORES = 6;

export default function RecibirMercancia({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [pendientes, setPendientes] = useState(null);
  const [confirmadas, setConfirmadas] = useState([]);
  const [hoy, setHoy] = useState(hoyStr());
  const [aviso, setAviso] = useState('');
  const [errorCarga, setErrorCarga] = useState('');
  // Las facturas que ESTA persona está confirmando ahora mismo — para no
  // confundir "la confirmé yo" con "la confirmó alguien más" cuando
  // desaparece de la lista.
  const confirmandoRef = useRef(new Set());
  const anterioresRef = useRef(null);

  useEffect(() => suscribirInventario(setInventario), []);

  useEffect(() => {
    const t = setInterval(() => setHoy(hoyStr()), 60000);
    return () => clearInterval(t);
  }, []);

  // En vivo: si Fausto o Nelson registran una factura nueva (o la corrigen, o
  // la eliminan) mientras esta pestaña está abierta, aparece sola.
  useEffect(() => {
    return suscribirPedidosPendientes(
      (lista, { desdeCache }) => {
        const ids = new Set(lista.map((p) => p.id));
        // Si una factura en la que esta persona ya había escrito algo se va
        // sin que ella la haya confirmado, es que la confirmó alguien más o
        // Nelson la eliminó: se avisa.
        if (!desdeCache && anterioresRef.current) {
          const seFueron = [...anterioresRef.current].filter((id) => !ids.has(id) && !confirmandoRef.current.has(id));
          if (seFueron.some((id) => leerBorrador(id))) {
            setAviso('Una factura que estabas contando ya no está pendiente: alguien más la confirmó o Nelson la eliminó.');
          }
          seFueron.forEach((id) => confirmandoRef.current.delete(id));
        }
        if (!desdeCache) anterioresRef.current = ids;
        setPendientes([...lista].sort(ordenFacturas));
        // Solo con la respuesta real del servidor: se borran los borradores
        // de facturas que ya no existen.
        if (!desdeCache) limpiarBorradoresHuerfanos(lista.map((p) => p.id));
      },
      (err) => setErrorCarga('No se pudo leer las facturas: ' + err.message)
    );
  }, []);

  useEffect(
    () => suscribirConfirmadasDelDia(hoy, (l) => setConfirmadas([...l].sort(ordenFacturas)), () => setConfirmadas([])),
    [hoy]
  );

  const porId = useMemo(() => {
    const m = {};
    (inventario || []).forEach((i) => (m[i.id] = i));
    return m;
  }, [inventario]);

  return (
    <div className="rc">
      <div className="rc-col">
        <h2 className="rc-titulo">Recibir mercancía</h2>
        <p className="rc-ayuda">
          Cuenta cada referencia y escribe cuántas llegaron. Cada factura se confirma por separado; el stock solo sube con lo que de verdad
          contaste.
        </p>

        {aviso && (
          <div className="rc-aviso">
            <span>{aviso}</span>
            <button onClick={() => setAviso('')}>Entendido</button>
          </div>
        )}
        {errorCarga && <div className="msg bad">{errorCarga}</div>}

        {!pendientes ? (
          <div className="empty-lines">Cargando…</div>
        ) : pendientes.length === 0 ? (
          <div className="rc-vacio">No hay facturas pendientes de recibir.</div>
        ) : (
          <>
            <div className="rc-cuantas">
              {pendientes.length === 1 ? '1 factura por recibir' : `${pendientes.length} facturas por recibir`}
            </div>
            {pendientes.map((p, idx) => (
              <TarjetaFactura
                key={p.id}
                pedido={p}
                color={((p.facturaNum || idx + 1) - 1) % COLORES}
                porId={porId}
                usuario={usuario}
                onEmpezar={() => confirmandoRef.current.add(p.id)}
                onFallo={() => confirmandoRef.current.delete(p.id)}
              />
            ))}
          </>
        )}
      </div>

      <aside className="rc-lado" aria-label="Confirmadas hoy">
        <h3>
          Confirmadas hoy <span>{confirmadas.length}</span>
        </h3>
        {confirmadas.length === 0 ? (
          <p className="rc-lado-vacio">Todavía no se ha confirmado ninguna factura hoy.</p>
        ) : (
          confirmadas.map((c) => <Confirmada key={c.id} compra={c} />)
        )}
      </aside>
    </div>
  );
}

// Se agrupa por referencia + nota, no por línea: si Fausto registró la misma
// prenda en más de una línea (por ejemplo a distintos costos), a quien recibe
// le llega todo mezclado y no tiene cómo distinguir una línea de otra. Por
// eso cuenta el total de esa prenda UNA sola vez, y si coincide con la suma
// de lo pedido en esas líneas, se reparte tal cual estaba registrado.
function agrupar(items) {
  const mapa = {};
  const orden = [];
  items.forEach((i) => {
    const clave = `${i.id}|${(i.nota || '').trim().toLowerCase()}`;
    if (!mapa[clave]) {
      mapa[clave] = { clave, id: i.id, name: i.name, nota: i.nota, lineas: [], cantidadPedida: 0 };
      orden.push(clave);
    }
    mapa[clave].lineas.push(i);
    mapa[clave].cantidadPedida += i.cantidadPedida;
  });
  return orden.map((c) => mapa[c]);
}

function TarjetaFactura({ pedido, color, porId, usuario, onEmpezar, onFallo }) {
  const grupos = useMemo(() => agrupar(pedido.items || []), [pedido]);
  const inputs = useRef([]);
  const botonRef = useRef(null);

  // Vacío a propósito: cuentan cuántas hay de verdad sin ver cuánto pidió
  // Fausto. Si ya había un borrador guardado (lo dejó a medias), se recupera.
  const [cantidades, setCantidades] = useState(() => {
    const borrador = leerBorrador(pedido.id) || {};
    const inicial = {};
    grupos.forEach((g) => (inicial[g.clave] = borrador[g.clave] ?? ''));
    return inicial;
  });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  // Cada vez que escribe algo se guarda como borrador — si llega una venta y
  // toca cambiar de pestaña a medio conteo, no se pierde.
  useEffect(() => {
    guardarBorrador(pedido.id, cantidades);
  }, [pedido.id, cantidades]);

  // "vacío" (todavía no escribió nada) es distinto de "distinto" (escribió un
  // número que no coincide) — así no se ve como error antes de contar.
  const conEstado = grupos.map((g) => {
    const crudo = cantidades[g.clave] ?? '';
    const vacio = crudo === '';
    const valor = parseInt(crudo, 10);
    return { ...g, vacio, distinto: !vacio && (isNaN(valor) || valor !== g.cantidadPedida) };
  });
  const faltan = conEstado.filter((g) => g.vacio).length;
  const hayDiferencias = conEstado.some((g) => g.distinto);
  const todoCoincide = !faltan && !hayDiferencias;
  const algoEscrito = conEstado.some((g) => !g.vacio);
  const prendas = grupos.reduce((s, g) => s + g.cantidadPedida, 0);

  async function confirmar() {
    if (!todoCoincide || guardando) return;
    setMsg('');
    setGuardando(true);
    onEmpezar?.();
    try {
      const itemsConfirmados = [];
      grupos.forEach((g) =>
        g.lineas.forEach((i) =>
          itemsConfirmados.push({ lineaId: claveLinea(i), cantidadRecibida: i.cantidadPedida, stockActual: porId[i.id]?.stock || 0 })
        )
      );
      await confirmarRecepcion(pedido.id, pedido, itemsConfirmados, usuario);
      borrarBorrador(pedido.id);
    } catch (e) {
      onFallo?.();
      setMsg('No se pudo confirmar: ' + e.message);
      setGuardando(false);
    }
  }

  function limpiar() {
    borrarBorrador(pedido.id);
    const vacio = {};
    grupos.forEach((g) => (vacio[g.clave] = ''));
    setCantidades(vacio);
    inputs.current[0]?.focus();
  }

  // Enter pasa a la siguiente referencia; en la última, al botón de confirmar.
  function siguiente(e, k) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const sig = inputs.current[k + 1];
    if (sig) sig.focus();
    else botonRef.current?.focus();
  }

  const titulo = nombreFactura(pedido);
  return (
    <section className={`rc-factura c${color}`} aria-label={`${titulo} del ${fechaCorta(pedido.fecha)}`}>
      <header className="rc-factura-top">
        <span className="rc-factura-izq">
          <span className="rc-chip">{titulo}</span>
          <span className="rc-factura-info">
            {fechaCorta(pedido.fecha)} · {pedido.hora}
            {pedido.usuarioNombre ? ` · la registró ${pedido.usuarioNombre}` : ''}
            {pedido.proveedor ? ` · ${pedido.proveedor}` : ''}
          </span>
        </span>
        {/* El valor de la factura bien grande: es lo que está escrito en el papel
            y sirve para saber de un vistazo cuál es la que se va a recibir. */}
        <span className="rc-factura-total">
          <b>{fmt(pedido.totalGeneral)}</b>
          <small>
            {prendas} {prendas === 1 ? 'prenda' : 'prendas'}
          </small>
        </span>
      </header>

      <div className="rc-renglones">
        {conEstado.map((g, k) => {
          const it = porId[g.id];
          const etiqueta = it?.tipo === 'precio' ? `Ref ${g.name}` : g.name;
          return (
            <label key={g.clave} className={`rc-renglon ${g.distinto ? 'mal' : !g.vacio ? 'bien' : ''}`}>
              <span className="rc-ref">
                {etiqueta}
                {g.nota && <small>{g.nota}</small>}
              </span>
              <input
                ref={(el) => (inputs.current[k] = el)}
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="¿cuántas?"
                aria-label={`Cuántas llegaron de ${etiqueta}${g.nota ? ` (${g.nota})` : ''}`}
                value={cantidades[g.clave] ?? ''}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => siguiente(e, k)}
                onChange={(e) => setCantidades((c) => ({ ...c, [g.clave]: e.target.value.replace(/[^\d]/g, '') }))}
              />
            </label>
          );
        })}
      </div>

      {hayDiferencias && (
        <div className="rc-no-coincide">
          <b>⚠️ La cantidad no coincide</b>
          <span>Vuelve a contar. Si de verdad falta algo, dile a Nelson para que corrija la factura; mientras tanto no se puede confirmar.</span>
        </div>
      )}

      <footer className="rc-factura-pie">
        <span className="rc-estado">
          {todoCoincide ? '✓ Todo coincide' : faltan ? `Faltan ${faltan} por contar` : ''}
        </span>
        {algoEscrito && !guardando && (
          <button className="rc-btn sec" onClick={limpiar}>
            Borrar lo contado
          </button>
        )}
        <button ref={botonRef} className="rc-btn" disabled={guardando || !todoCoincide} onClick={confirmar}>
          {guardando ? 'Guardando…' : `Confirmar ${titulo.toLowerCase()}`}
        </button>
      </footer>
      {msg && <div className="msg bad">{msg}</div>}
    </section>
  );
}

function Confirmada({ compra }) {
  const grupos = agrupar(compra.items || []);
  const prendas = grupos.reduce((s, g) => s + g.lineas.reduce((x, i) => x + (i.cantidadRecibida ?? 0), 0), 0);
  return (
    <div className="rc-hecha">
      <div className="rc-hecha-top">
        <span className="rc-check" aria-hidden="true">
          ✓
        </span>
        <b>{nombreFactura(compra)}</b>
        <span className="rc-hecha-de">del {fechaCorta(compra.fecha)}</span>
        <span className="rc-hecha-valor">{fmt(compra.totalGeneral)}</span>
      </div>
      <div className="rc-hecha-items">{grupos.map((g) => `${g.name}${g.nota ? ` (${g.nota})` : ''} ×${g.cantidadPedida}`).join(' · ')}</div>
      <div className="rc-hecha-quien">
        {prendas} {prendas === 1 ? 'prenda' : 'prendas'}
        {compra.confirmadoPor ? ` · confirmó ${compra.confirmadoPor}` : ''}
      </div>
    </div>
  );
}
