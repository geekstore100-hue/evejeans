import { useEffect, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import {
  registrarMovimiento,
  anularMovimiento,
  movimientosPorFecha,
  hoyStr,
  SALIDA_CATEGORIAS,
  ENTRADA_CATEGORIAS,
} from '../lib/entradasSalidas';

function fechaBonita(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function EntradasSalidas({ usuario }) {
  const [inventario, setInventario] = useState(null);
  const [fecha, setFecha] = useState(hoyStr());
  const [lista, setLista] = useState(null);
  const [errorLista, setErrorLista] = useState('');

  const [tipo, setTipo] = useState('salida'); // salida | entrada
  const [itemId, setItemId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [categoria, setCategoria] = useState('');
  const [detalle, setDetalle] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });

  const esHoy = fecha === hoyStr();
  const categorias = tipo === 'salida' ? SALIDA_CATEGORIAS : ENTRADA_CATEGORIAS;

  useEffect(() => {
    const quitar = suscribirInventario(setInventario, () => {});
    return quitar;
  }, []);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  async function cargar() {
    setLista(null);
    setErrorLista('');
    try {
      const m = await movimientosPorFecha(fecha);
      setLista(m);
    } catch (e) {
      setErrorLista('No se pudo cargar: ' + e.message);
    }
  }

  async function onAnular(m) {
    const etiqueta = `el movimiento N.º ${m.num} (${m.itemNombre})`;
    const motivo = window.prompt(`¿Por qué se anula ${etiqueta}?`);
    if (!motivo || !motivo.trim()) return;
    try {
      await anularMovimiento(m, motivo.trim(), usuario);
      await cargar();
      if (m.fecha === hoyStr()) {
        alert(`Listo, se anuló ${etiqueta}.`);
      } else {
        // Ese día ya se sincronizó con el Excel (el sincronizado automático solo
        // toca el día de hoy), así que sin este aviso el número viejo se quedaría
        // ahí sin que nadie se dé cuenta.
        alert(
          `Listo, se anuló ${etiqueta}.\n\n` +
            `OJO: este movimiento era del ${m.fecha}, un día que ya se sincronizó con tu Excel. ` +
            `Para que el Excel quede al día, entra al script (Apps Script), pon FECHA_MANUAL_R = "${m.fecha}" ` +
            `y corre sincronizarFechaManual.`
        );
      }
    } catch (e) {
      alert('No se pudo anular: ' + e.message);
    }
  }

  function cambiarTipo(t) {
    setTipo(t);
    setCategoria('');
  }

  function limpiar() {
    setItemId('');
    setCantidad('');
    setCategoria('');
    setDetalle('');
  }

  async function guardar() {
    setMsg({ tipo: '', texto: '' });
    const item = (inventario || []).find((i) => i.id === itemId);
    if (!item) {
      setMsg({ tipo: 'bad', texto: 'Falta elegir la referencia.' });
      return;
    }
    const cantidadNum = parseInt(cantidad) || 0;
    if (cantidadNum <= 0) {
      setMsg({ tipo: 'bad', texto: 'Falta escribir la cantidad.' });
      return;
    }
    if (!categoria) {
      setMsg({ tipo: 'bad', texto: 'Falta elegir el motivo.' });
      return;
    }
    setGuardando(true);
    try {
      await registrarMovimiento({
        usuario,
        tipo,
        itemId: item.id,
        itemNombre: item.name,
        cantidad: cantidadNum,
        categoria,
        detalle: detalle.trim(),
      });
      setMsg({ tipo: 'good', texto: 'Movimiento registrado.' });
      limpiar();
      if (esHoy) cargar();
    } catch (e) {
      setMsg({ tipo: 'bad', texto: e.message || 'No se pudo registrar.' });
    } finally {
      setGuardando(false);
    }
  }

  if (!inventario) {
    return <div className="loading">Cargando…</div>;
  }

  const itemsOrdenados = [...inventario].sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return (
    <div className="sale-grid">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>
            Entradas y salidas {esHoy ? 'de hoy' : `· ${fechaBonita(fecha)}`}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="date"
              value={fecha}
              max={hoyStr()}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
            />
            {!esHoy && (
              <button className="btn ghost sm" onClick={() => setFecha(hoyStr())}>
                Hoy
              </button>
            )}
          </div>
        </div>

        {errorLista && <div className="msg bad">{errorLista}</div>}

        {!lista ? (
          <div className="empty-lines">Cargando…</div>
        ) : lista.length === 0 ? (
          <div className="empty-lines">{esHoy ? 'Todavía no hay nada hoy.' : 'Ningún movimiento ese día.'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="num">N.º</th>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Referencia</th>
                <th className="num">Cant.</th>
                <th>Motivo</th>
                <th>Quién</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id} className={m.anulada ? 'void' : ''}>
                  <td className="num">{m.num}</td>
                  <td>{m.hora}</td>
                  <td>
                    <span
                      className="pill"
                      style={
                        m.tipo === 'salida'
                          ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
                          : { background: 'var(--cian-suave)', color: 'var(--cian-fuerte)' }
                      }
                    >
                      {m.tipo === 'salida' ? 'salida' : 'entrada'}
                    </span>
                    {m.anulada && (
                      <span
                        className="pill anul"
                        style={{ marginLeft: 6, cursor: 'help' }}
                        title={`Motivo: ${m.motivoAnulacion || '—'}${m.anuladaPor ? ` · anuló: ${m.anuladaPor}` : ''}`}
                      >
                        anulado
                      </span>
                    )}
                  </td>
                  <td>{m.itemNombre}</td>
                  <td className="num">{m.cantidad}</td>
                  <td className="dim">{m.categoria}{m.detalle ? ` · ${m.detalle}` : ''}</td>
                  <td>{m.usuarioNombre}</td>
                  <td>
                    {!m.anulada && usuario.id === 'nelson' && (
                      <button className="btn ghost sm" onClick={() => onAnular(m)}>
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Nuevo movimiento</h2>

          <div className="chips" style={{ marginBottom: 12 }}>
            <button className={`chip ${tipo === 'salida' ? 'on' : ''}`} onClick={() => cambiarTipo('salida')}>
              Salida
            </button>
            <button className={`chip ${tipo === 'entrada' ? 'on' : ''}`} onClick={() => cambiarTipo('entrada')}>
              Entrada
            </button>
          </div>

          <div className="field">
            <label>Referencia</label>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Elige una referencia…</option>
              {itemsOrdenados.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} (stock: {i.stock || 0})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Cantidad</label>
            <input
              type="number"
              inputMode="numeric"
              placeholder="0"
              className="monto-grande"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </div>

          <div className="paso">
            <span className="paso-n">·</span> ¿Por qué?
          </div>
          <div className="chips">
            {categorias.map((c) => (
              <button key={c} className={`chip ${categoria === c ? 'on' : ''}`} onClick={() => setCategoria(c)}>
                {c}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Detalle (opcional)"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            style={{ marginTop: 12 }}
          />

          <button
            className="btn"
            disabled={guardando}
            style={tipo === 'salida' ? { background: 'var(--danger)' } : {}}
            onClick={guardar}
          >
            {guardando ? 'Guardando…' : tipo === 'salida' ? 'Registrar salida' : 'Registrar entrada'}
          </button>

          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      </div>
    </div>
  );
}
