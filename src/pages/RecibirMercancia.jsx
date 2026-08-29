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
  // Vacío a propósito: cuentan cuántas hay de verdad sin ver cuánto pidió
  // Fausto, para que sea un conteo real y no solo confirmar el número que ya
  // estaba escrito.
  const [cantidades, setCantidades] = useState(() => {
    const inicial = {};
    pedido.items.forEach((i) => (inicial[claveLinea(i)] = ''));
    return inicial;
  });
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  // "vacío" (todavía no escribió nada ahí) es distinto de "distinto" (ya
  // escribió un número, pero no coincide con lo pedido) — así el campo no se
  // ve como un error antes de que alcance a contar esa referencia.
  const items = pedido.items.map((i) => {
    const crudo = cantidades[claveLinea(i)];
    const vacio = crudo === '';
    const valor = parseInt(crudo);
    const distinto = !vacio && (isNaN(valor) || valor !== i.cantidadPedida);
    return { ...i, vacio, distinto };
  });
  const faltan = items.some((i) => i.vacio);
  const hayDiferencias = items.some((i) => i.distinto);
  const todoCoincide = !faltan && !hayDiferencias;

  async function confirmar() {
    if (!todoCoincide) return;
    setMsg('');
    setGuardando(true);
    try {
      const itemsConfirmados = pedido.items.map((i) => ({
        lineaId: claveLinea(i),
        cantidadRecibida: parseInt(cantidades[claveLinea(i)]) || 0,
        stockActual: porId[i.id]?.stock || 0,
      }));
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
      {items.map((i) => (
        <div className="field" key={claveLinea(i)} style={{ marginBottom: 8 }}>
          <label>
            {i.name}
            {i.nota ? ` (${i.nota})` : ''}
          </label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={cantidades[claveLinea(i)]}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCantidades((c) => ({ ...c, [claveLinea(i)]: e.target.value }))}
            style={i.distinto ? { borderColor: 'var(--danger)', background: 'var(--danger-soft)' } : {}}
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
