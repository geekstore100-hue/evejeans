import { useEffect, useState } from 'react';
import { suscribirSolicitudesPedidas, aprobarEntregaHoy, rechazarEntregaHoy } from '../lib/planillas';

// Aviso arriba de la app de Nelson: Fausto pide recoger el efectivo del MISMO
// día. Nelson lo aprueba (y ahí queda registrado como recibido) o lo rechaza.
// En vivo: aparece apenas Fausto lo pide (si la app de Nelson está abierta).

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

function Solicitud({ sol, usuario }) {
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState('');
  const dif = sol.recibido - sol.efectivoCalculado;

  async function aprobar() {
    setTrabajando(true);
    setMsg('');
    try {
      await aprobarEntregaHoy(sol, usuario);
    } catch (e) {
      setMsg('No se pudo aprobar: ' + e.message);
      setTrabajando(false);
    }
  }
  async function rechazar() {
    setTrabajando(true);
    setMsg('');
    try {
      await rechazarEntregaHoy(sol, motivo.trim(), usuario);
    } catch (e) {
      setMsg('No se pudo rechazar: ' + e.message);
      setTrabajando(false);
    }
  }

  return (
    <div className="ae-sol">
      <div className="ae-texto">
        <b>
          {sol.pedidoPorNombre} quiere llevarse el efectivo de HOY: {fmt(sol.recibido)}
        </b>
        <small>
          Lo pidió a las {sol.pedidoHora} · lo entrega {sol.entregoNombre || '—'} · el sistema calcula {fmt(sol.efectivoCalculado)} hasta ese momento
          {dif !== 0 ? ` (${dif > 0 ? 'sobran' : 'faltan'} ${fmt(Math.abs(dif))})` : ''}
          {sol.nota ? ` · "${sol.nota}"` : ''}
        </small>
        {msg && <small className="ae-error">{msg}</small>}
      </div>
      {rechazando ? (
        <div className="ae-acciones">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            aria-label="Motivo para no aprobar"
          />
          <button className="ae-btn sec" disabled={trabajando} onClick={() => setRechazando(false)}>
            Volver
          </button>
          <button className="ae-btn no" disabled={trabajando} onClick={rechazar}>
            No aprobar
          </button>
        </div>
      ) : (
        <div className="ae-acciones">
          <button className="ae-btn sec" disabled={trabajando} onClick={() => setRechazando(true)}>
            No aprobar
          </button>
          <button className="ae-btn" disabled={trabajando} onClick={aprobar}>
            {trabajando ? 'Aprobando…' : 'Aprobar'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AvisoEntregaHoy({ usuario }) {
  const [solicitudes, setSolicitudes] = useState([]);
  useEffect(() => suscribirSolicitudesPedidas(setSolicitudes, () => setSolicitudes([])), []);
  if (!solicitudes.length) return null;
  return (
    <div className="ae" role="status">
      {solicitudes.map((s) => (
        <Solicitud key={s.id} sol={s} usuario={usuario} />
      ))}
    </div>
  );
}
