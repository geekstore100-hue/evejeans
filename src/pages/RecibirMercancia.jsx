import { useEffect, useMemo, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import { pedidosPendientes, confirmarRecepcion, claveLinea } from '../lib/compras';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function RecibirMercancia({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [pendientes, setPendientes] = useState(null);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    const quitar = suscribirInventario(setInventario);
    return quitar;
  }, []);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setPendientes(await pedidosPendientes());
  }

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
                  onListo={async () => {
                    setAbierto(null);
                    await cargar();
                  }}
                />
              ) : (
                <div className="gasto-item" key={p.id}>
                  <div>
                    <div className="gasto-nombre">{p.fecha} {p.hora}</div>
                    <div className="gasto-sub">
                      {p.items.map((i) => `${i.name}${i.nota ? ` (${i.nota})` : ''}`).join(', ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="gasto-monto">{fmt(p.totalGeneral)}</span>
                    <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setAbierto(p.id)}>
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

function FormularioConfirmar({ pedido, porId, usuario, onCancelar, onListo }) {
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
      const clave = `${i.id}|${i.nota || ''}`;
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
  // estaba escrito.
  const [cantidades, setCantidades] = useState(() => {
    const inicial = {};
    grupos.forEach((g) => (inicial[g.clave] = ''));
    return inicial;
  });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  // "vacío" (todavía no escribió nada ahí) es distinto de "distinto" (ya
  // escribió un número, pero no coincide con lo pedido) — así el campo no se
  // ve como un error antes de que alcance a contar esa referencia.
  const gruposConEstado = grupos.map((g) => {
    const crudo = cantidades[g.clave];
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
      onListo();
    } catch (e) {
      setMsg('No se pudo confirmar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card modo-prueba" style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>
        Confirmar recepción — {pedido.fecha}
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
            value={cantidades[g.clave]}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCantidades((c) => ({ ...c, [g.clave]: e.target.value }))}
            style={g.distinto ? { borderColor: 'var(--danger)', background: 'var(--danger-soft)' } : {}}
          />
        </div>
      ))}

      {hayDiferencias && (
        <div className="msg bad" style={{ textAlign: 'left' }}>
          No coincide con lo pedido. Vuelve a contar; si de verdad falta algo, dile a Nelson
          para que ajuste el pedido desde Compras — mientras tanto, no se puede confirmar.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn ghost sm" style={{ width: 'auto' }} onClick={onCancelar}>Cancelar</button>
        <button className="btn sm" style={{ width: 'auto' }} disabled={guardando || !todoCoincide} onClick={confirmar}>
          {guardando ? 'Guardando…' : 'Confirmar entrada'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}
