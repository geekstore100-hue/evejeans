import { useEffect, useRef } from 'react';

// Botón "atrás" del celular. La app es una sola página: sin esto, el atrás
// del teléfono se salía de la app (o la cerraba) en vez de devolverse.
//
// Cómo funciona: siempre se deja una "entrada de guarda" en el historial del
// navegador. Cuando se oprime atrás, el navegador la gasta; en ese momento la
// app decide qué hacer (cerrar la hoja abierta, volver a la pantalla
// anterior…) y vuelve a poner la guarda. Si ya no hay nada a dónde volver,
// avisa "Presiona atrás otra vez para salir", y solo sale si se oprime otra
// vez enseguida.
//
// Cada pantalla registra lo que quiere hacer con usarAtras(fn, prioridad):
// fn() devuelve true si manejó el atrás. Primero se pregunta a la de mayor
// prioridad (las hojas y pantallas internas van por encima de la navegación
// general de App.jsx, que usa prioridad 0).

const manejadores = [];
let iniciado = false;
let ultimoAviso = 0;
let contador = 0;

function ponerGuarda() {
  try {
    window.history.pushState({ evejeans: 'guarda' }, '');
  } catch {
    // sin historial disponible: no pasa nada
  }
}

function mostrarAviso(texto) {
  const viejo = document.getElementById('atras-aviso');
  if (viejo) viejo.remove();
  const el = document.createElement('div');
  el.id = 'atras-aviso';
  el.className = 'atras-aviso';
  el.setAttribute('role', 'status');
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

export function iniciarAtras() {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  try {
    window.history.replaceState({ evejeans: 'base' }, '');
  } catch {
    return;
  }
  ponerGuarda();
  window.addEventListener('popstate', () => {
    const orden = [...manejadores].sort((a, b) => b.prioridad - a.prioridad || b.n - a.n);
    for (const m of orden) {
      let manejado = false;
      try {
        manejado = m.fn.current();
      } catch (e) {
        console.error('Atrás:', e);
      }
      if (manejado) {
        ponerGuarda();
        return;
      }
    }
    const ahora = Date.now();
    if (ahora - ultimoAviso < 2500) {
      // Segundo atrás seguido: ahora sí sale.
      window.history.back();
      return;
    }
    ultimoAviso = ahora;
    mostrarAviso('Presiona atrás otra vez para salir');
    ponerGuarda();
  });
}

// Hook: fn() devuelve true si manejó el atrás (y entonces no se sale).
export function usarAtras(fn, prioridad = 10) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const m = { fn: ref, prioridad, n: ++contador };
    manejadores.push(m);
    return () => {
      const i = manejadores.indexOf(m);
      if (i >= 0) manejadores.splice(i, 1);
    };
  }, [prioridad]);
}
