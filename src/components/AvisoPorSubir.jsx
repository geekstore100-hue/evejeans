import { useEffect, useState } from 'react';
import { escucharPorSubir, quitarPorSubir, revisarPorSubir } from '../lib/porSubir';

// Franja para TODOS (vendedoras, Nelson, Fausto) con lo que se guardó sin
// internet en este computador (ver lib/porSubir.js):
// - Mientras espera subir: aviso de que no se cierre sesión ni se borre nada.
// - Si el servidor lo rechazó: aviso rojo con el detalle, para registrarlo otra vez.

function contar(lista) {
  const n = { ventas: 0, otros: 0 };
  lista.forEach((x) => {
    if (/^(Venta|Cambio)/.test(x.que)) n.ventas++;
    else n.otros++;
  });
  const partes = [];
  if (n.ventas) partes.push(`${n.ventas} ${n.ventas === 1 ? 'venta o cambio' : 'ventas o cambios'}`);
  if (n.otros) partes.push(`${n.otros} ${n.otros === 1 ? 'registro más' : 'registros más'}`);
  return partes.join(' y ');
}

export default function AvisoPorSubir() {
  const [lista, setLista] = useState([]);
  const [enLinea, setEnLinea] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  useEffect(() => escucharPorSubir(setLista), []);
  useEffect(() => {
    const on = () => {
      setEnLinea(true);
      revisarPorSubir();
    };
    const off = () => setEnLinea(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    revisarPorSubir();
    // Mientras haya algo esperando, se vuelve a revisar cada minuto.
    const t = setInterval(revisarPorSubir, 60000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(t);
    };
  }, []);

  const rechazadas = lista.filter((x) => x.estado === 'rechazada');
  const esperando = lista.filter((x) => x.estado === 'esperando');
  if (!rechazadas.length && !esperando.length) return null;

  return (
    <div className="ps">
      {rechazadas.length > 0 && (
        <div className="ps-rechazo" role="alert">
          <b>⚠️ Esto NO quedó guardado. Hay que registrarlo otra vez:</b>
          <ul>
            {rechazadas.map((x) => (
              <li key={x.clave}>
                <div>
                  <b>{x.que}</b> · {x.fecha} {x.hora}
                  <small>{x.detalle}</small>
                  {x.motivo && <small className="ps-motivo">{x.motivo}</small>}
                </div>
                <button onClick={() => quitarPorSubir(x.clave)}>Ya lo registré de nuevo</button>
              </li>
            ))}
          </ul>
          <span className="ps-nota">
            Se hizo sin internet y, al volver la señal, el servidor no lo aceptó. Si es una venta, la plata está en la caja pero la venta no
            aparece: regístrala otra vez y avísale a Nelson.
          </span>
        </div>
      )}
      {esperando.length > 0 && (
        <div className="ps-espera" role="status">
          <b>{enLinea ? '⏳ Subiendo lo que se guardó sin internet…' : '📡 Sin internet'}</b>
          <span>
            {contar(esperando)} {esperando.length === 1 ? 'está guardado' : 'están guardados'} solo en este computador, esperando subir. Hasta que
            suban: no cierres sesión, no borres el historial del navegador y no uses otro computador para cobrar.
          </span>
        </div>
      )}
    </div>
  );
}
