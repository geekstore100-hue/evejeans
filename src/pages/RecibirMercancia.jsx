import { useEffect, useMemo, useRef, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { suscribirPedidosPendientes, confirmarRecepcion, claveLinea } from '../lib/compras';
import { leerBorrador, guardarBorrador, borrarBorrador, limpiarBorradoresHuerfanos } from '../lib/recepcionBorrador';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function RecibirMercancia({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [pendientes, setPendientes] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [aviso, setAviso] = useState('');
  const [errorCarga, setErrorCarga] = useState('');
  // El pedido que ESTA persona está confirmando ahora mismo — para no
  // confundir "lo confirmé yo" con "lo confirmó alguien más" cuando el pedido
  // desaparece de la lista.
  const confirmandoRef = useRef(null);

  useEffect(() => {
    const quitar = suscribirInventario(setInventario);
    return quitar;
  }, []);

  // En vivo: si Fausto o Nelson registran un pedido nuevo (o lo corrigen, o lo
  // eliminan) mientras esta pestaña está abierta, aparece solo — ya no hace
  // falta salir y volver a entrar para verlo.
  useEffect(() => {
    const quitar = suscribirPedidosPendientes(
      (lista, { desdeCache }) => {
        setPendientes(lista);
        // Solo con la respuesta real del servidor (no con lo guardado en el
        // computador, que puede estar incompleto): se borran los borradores
        // de pedidos que ya no existen, para que no quede el aviso de
        // "confirmación a medias" en Ventas de un pedido que ya se confirmó.
        if (!desdeCache) limpiarBorradoresHuerfanos(lista.map((p) => p.id));
      },
      (err) => setErrorCarga('No se pudo leer los pedidos: ' + err.message)
    );
    return quitar;
  }, []);

  // Si el pedido que se estaba contando deja de estar pendiente sin que esta
  // persona lo haya confirmado (lo confirmó alguien más en otro computador, o
  // Nelson lo eliminó), se cierra el formulario y se avisa por qué.
  useEffect(() => {
    if (!abierto || !pendientes) return;
    if (pendientes.some((p) => p.id === abierto)) return;
    if (confirmandoRef.current !== abierto) {
      setAviso('El pedido que estabas contando ya no está pendiente: alguien más lo confirmó o Nelson lo eliminó.');
    }
    confirmandoRef.current = null;
    setAbierto(null);
  }, [pendientes, abierto]);

  const porId = useMemo(() => {
    const m = {};
    (inventario || []).forEach((i) => (m[i.id] = i));
    return m;
  }, [inventario]);

  // Agrupar por proveedor para que se vea junto lo mismo que llega junto.
  // "Sin proveedor" para los pedidos que no lo preguntan (ej. Fausto).
  const porProveedor = {};
  (pendientes || []).forEach((p) => {
    const clave = p.proveedor || 'Sin proveedor';
    porProveedor[clave] = porProveedor[clave] || [];
    porProveedor[clave].push(p);
  });

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h2>Recibir mercancía</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
        Cuando llegue un pedido, cuenta cada referencia y confírmalo aquí. El stock solo sube
        con lo que de verdad contaste — si algo no coincide con lo pedido, queda registrado.
      </p>

      {aviso && (
        <div className="msg bad" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{aviso}</span>
          <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setAviso('')}>
            Entendido
          </button>
        </div>
      )}
      {errorCarga && <div className="msg bad">{errorCarga}</div>}

      {!pendientes ? (
        <div className="empty-lines">Cargando…</div>
      ) : pendientes.length === 0 ? (
        <div className="empty-lines">No hay pedidos pendientes de recibir.</div>
      ) : (
        Object.entries(porProveedor).map(([proveedor, lista]) => (
          <div key={proveedor} style={{ marginTop: 14 }}>
            <div className="split-label">{proveedor}</div>
            {lista.map((p) =>
              abierto === p.id ? (
                <FormularioConfirmar
                  key={p.id}
                  pedido={p}
                  porId={porId}
                  usuario={usuario}
                  onCancelar={() => setAbierto(null)}
                  onEmpezar={() => (confirmandoRef.current = p.id)}
                  onListo={() => {
                    confirmandoRef.current = null;
                    setAbierto(null);
                  }}
                  onFallo={() => (confirmandoRef.current = null)}
                />
              ) : (
                <div className="gasto-item" key={p.id}>
                  <div>
                    <div className="gasto-nombre">
                      {p.facturaNum ? `Factura ${p.facturaNum} · ` : ''}
                      {p.fecha} {p.hora}
                    </div>
                    <div className="gasto-sub">
                      {p.items.map((i) => `${i.name}${i.nota ? ` (${i.nota})` : ''}`).join(', ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="gasto-monto">{fmt(p.totalGeneral)}</span>
                    <button
                      className="btn ghost sm"
                      style={{ width: 'auto' }}
                      onClick={() => {
                        setAviso('');
                        setAbierto(p.id);
                      }}
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        ))
      )}
    </div>
  );
}

function FormularioConfirmar({ pedido, porId, usuario, onCancelar, onListo, onEmpezar, onFallo }) {
  // Se agrupa por referencia + nota, no por línea: si Fausto registró la
  // misma prenda en más de una línea (por ejemplo, porque llegó a distintos
  // costos de compra), a quien recibe le llega todo mezclado físicamente y no
  // tiene cómo distinguir una línea de otra con solo mirarla — pedirle un
  // número por línea la obligaría a adivinar cómo repartirlo. Por eso cuenta
  // el total de esa prenda UNA sola vez, y si coincide con la suma de lo
  // pedido en esas líneas, se reparte tal cual estaba registrado cada línea
  // (cada una conserva su propio costo para la contabilidad).
  const grupos = useMemo(() => {
    const mapa = {};
    const orden = [];
    pedido.items.forEach((i) => {
      // La nota se normaliza (sin mayúsculas/minúsculas ni espacios de más)
      // solo para AGRUPAR — así "Chaqueta jean" y "chaqueta jean " quedan en
      // el mismo cuadro. Para el texto que se muestra se usa la nota tal cual
      // se escribió la primera vez.
      const notaNormalizada = (i.nota || '').trim().toLowerCase();
      const clave = `${i.id}|${notaNormalizada}`;
      if (!mapa[clave]) {
        mapa[clave] = { clave, name: i.name, nota: i.nota, lineas: [], cantidadPedida: 0 };
        orden.push(clave);
      }
      mapa[clave].lineas.push(i);
      mapa[clave].cantidadPedida += i.cantidadPedida;
    });
    return orden.map((clave) => mapa[clave]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);

  // Vacío a propósito: cuentan cuántas hay de verdad sin ver cuánto pidió
  // Fausto, para que sea un conteo real y no solo confirmar el número que ya
  // estaba escrito. Si ya había un borrador guardado de este pedido (porque
  // lo dejó a medias antes), se recupera en vez de empezar en blanco.
  const [cantidades, setCantidades] = useState(() => {
    const borrador = leerBorrador(pedido.id);
    const inicial = {};
    grupos.forEach((g) => (inicial[g.clave] = borrador?.[g.clave] ?? ''));
    return inicial;
  });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  // Cada vez que escribe algo, se guarda de una vez como borrador — así, si
  // llega una venta y toca cambiar de pestaña a medio conteo, no se pierde.
  useEffect(() => {
    guardarBorrador(pedido.id, cantidades);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cantidades]);

  // "vacío" (todavía no escribió nada ahí) es distinto de "distinto" (ya
  // escribió un número, pero no coincide con lo pedido) — así el campo no se
  // ve como un error antes de que alcance a contar esa referencia.
  const gruposConEstado = grupos.map((g) => {
    // "?? ''": si Nelson corrige el pedido mientras se está contando (ahora
    // se actualiza en vivo), puede aparecer una referencia nueva que todavía
    // no tiene número escrito — cuenta como vacía, no como error.
    const crudo = cantidades[g.clave] ?? '';
    const vacio = crudo === '';
    const valor = parseInt(crudo);
    const distinto = !vacio && (isNaN(valor) || valor !== g.cantidadPedida);
    return { ...g, vacio, distinto };
  });
  const faltan = gruposConEstado.some((g) => g.vacio);
  const hayDiferencias = gruposConEstado.some((g) => g.distinto);
  const todoCoincide = !faltan && !hayDiferencias;

  async function confirmar() {
    if (!todoCoincide) return;
    setMsg('');
    setGuardando(true);
    onEmpezar?.();
    try {
      // El grupo ya coincidió con el total pedido en esas líneas, así que
      // cada línea recibe exactamente lo que tenía registrado.
      const itemsConfirmados = [];
      grupos.forEach((g) => {
        g.lineas.forEach((i) => {
          itemsConfirmados.push({
            lineaId: claveLinea(i),
            cantidadRecibida: i.cantidadPedida,
            stockActual: porId[i.id]?.stock || 0,
          });
        });
      });
      await confirmarRecepcion(pedido.id, pedido, itemsConfirmados, usuario);
      borrarBorrador(pedido.id);
      onListo();
    } catch (e) {
      onFallo?.();
      setMsg('No se pudo confirmar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  // Cancelar sí es una decisión de descartar el conteo — ahí sí se borra el
  // borrador, para que la próxima vez empiece limpio.
  function cancelar() {
    borrarBorrador(pedido.id);
    onCancelar();
  }

  return (
    <div className="card modo-prueba" style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>
        Confirmar recepción — {pedido.facturaNum ? `Factura ${pedido.facturaNum} del ` : ''}
        {pedido.fecha}
      </div>
      {gruposConEstado.map((g) => (
        <div className="field" key={g.clave} style={{ marginBottom: 8 }}>
          <label>
            {g.name}
            {g.nota ? ` (${g.nota})` : ''}
          </label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={cantidades[g.clave] ?? ''}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCantidades((c) => ({ ...c, [g.clave]: e.target.value }))}
            style={g.distinto ? { borderColor: 'var(--danger)', background: 'var(--danger-soft)' } : {}}
          />
        </div>
      ))}

      {hayDiferencias && (
        <div
          style={{
            background: 'var(--danger-soft)',
            border: '2px solid var(--danger)',
            borderRadius: 10,
            padding: '12px 14px',
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 19, fontWeight: 900, color: 'var(--danger)', textTransform: 'uppercase' }}>
            ⚠️ La cantidad no coincide
          </div>
          <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 4 }}>
            Vuelve a contar; si de verdad falta algo, dile a Nelson para que ajuste el pedido
            desde Compras — mientras tanto, no se puede confirmar.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn ghost sm" style={{ width: 'auto' }} onClick={cancelar}>Cancelar</button>
        <button className="btn sm" style={{ width: 'auto' }} disabled={guardando || !todoCoincide} onClick={confirmar}>
          {guardando ? 'Guardando…' : 'Confirmar entrada'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}
