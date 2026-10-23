import { useEffect, useState } from 'react';
import { suscribirAvisoRefuerzo } from '../lib/refuerzo';
import { hoyStr, sumarDias, fechaConDia, fmt } from '../lib/reportes';

// Franja de aviso arriba de la app (Nelson y Fausto): "podrían necesitar otra
// vendedora" cuando en los próximos días viene uno que en años anteriores
// vendió $2.500.000 o más (ver lib/refuerzo.js). Se puede cerrar; vuelve a salir
// cuando ya falten 2 días o menos, como recordatorio.

function cuando(faltan) {
  return faltan === 0 ? 'hoy' : faltan === 1 ? 'mañana' : `en ${faltan} días`;
}
function mayuscula(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// "del domingo 13 al martes 22 de diciembre" (o con los dos meses si cambian).
function rango(desde, hasta) {
  const a = fechaConDia(desde);
  const b = fechaConDia(hasta);
  const mesA = a.split(' de ')[1];
  const mesB = b.split(' de ')[1];
  return mesA === mesB ? `del ${a.split(' de ')[0]} al ${b}` : `del ${a} al ${b}`;
}
function fase(d) {
  return `${d.fecha}:${d.faltan <= 2 ? 'cerca' : 'lejos'}`;
}

// Días seguidos se juntan: "del lunes 15 al miércoles 24 de diciembre".
function agrupar(dias) {
  const grupos = [];
  dias.forEach((d) => {
    const ult = grupos[grupos.length - 1];
    if (ult && sumarDias(ult[ult.length - 1].fecha, 1) === d.fecha) ult.push(d);
    else grupos.push([d]);
  });
  return grupos;
}

function leerVistos(clave) {
  try {
    return JSON.parse(localStorage.getItem(clave) || '[]') || [];
  } catch {
    return [];
  }
}

export default function AvisoRefuerzo({ usuario }) {
  const [hoy, setHoy] = useState(hoyStr());
  const [dias, setDias] = useState([]);
  const clave = `evejeans_refuerzo_visto_${usuario.id}`;
  const [vistos, setVistos] = useState(() => leerVistos(clave));

  useEffect(() => {
    const t = setInterval(() => setHoy(hoyStr()), 60000);
    return () => clearInterval(t);
  }, []);
  // Si algo falla (por ejemplo sin internet), simplemente no se muestra.
  useEffect(() => suscribirAvisoRefuerzo(hoy, setDias, () => setDias([])), [hoy]);

  const pendientes = dias.filter((d) => !vistos.includes(fase(d)));
  if (!pendientes.length) return null;
  const grupos = agrupar(pendientes).slice(0, 3);

  function cerrar() {
    // Se guardan solo los avisos de días que todavía no han pasado.
    const nuevos = [...vistos.filter((v) => v.slice(0, 10) >= hoy), ...pendientes.map(fase)];
    setVistos(nuevos);
    try {
      localStorage.setItem(clave, JSON.stringify(nuevos));
    } catch {
      // sin almacenamiento: el aviso vuelve a salir al recargar, nada más
    }
  }

  return (
    <div className="av-refuerzo" role="status">
      <div className="av-icono" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="7" r="3" />
          <path d="M3 21v-1a6 6 0 0 1 12 0v1" />
          <path d="M19 8v6M16 11h6" />
        </svg>
      </div>
      <div className="av-texto">
        <b>Podrían necesitar otra vendedora</b>
        <ul>
          {grupos.map((g) => {
            const pico = g.reduce((a, b) => (b.esperado > a.esperado ? b : a));
            // El año más reciente como ejemplo; si hay varios, también el promedio.
            const ejemplo = pico.referencias[0];
            const anios = pico.referencias.map((r) => r.fecha.slice(0, 4)).reverse();
            const primero = g[0];
            const ultimo = g[g.length - 1];
            return (
              <li key={primero.fecha}>
                <span className="av-dias">
                  {mayuscula(g.length === 1 ? fechaConDia(primero.fecha) : rango(primero.fecha, ultimo.fecha))}
                </span>{' '}
                <span className="av-cuando">· {g.length === 1 ? cuando(primero.faltan) : `empieza ${cuando(primero.faltan)}`}</span>
                <small>
                  El {fechaConDia(ejemplo.fecha)} de {ejemplo.fecha.slice(0, 4)} se vendieron {fmt(ejemplo.venta)}
                  {pico.referencias.length > 1 ? ` (promedio de ${anios.join(' y ')}: ${fmt(pico.esperado)})` : ''}.
                </small>
              </li>
            );
          })}
        </ul>
      </div>
      <button className="av-cerrar" onClick={cerrar}>
        Entendido
      </button>
    </div>
  );
}
