import { useEffect, useState } from 'react';
import { suscribirPedidosPendientes } from '../lib/compras';
import { suscribirPlanillasPendientes } from '../lib/planillas';

// Menú de Nelson: en vez de todas las pestañas en una sola fila, 5 grupos con su
// submenú. En el computador los grupos van arriba; en el celular van abajo,
// en una barra que se alcanza con el pulgar, y "Cambiar de turno" y "Bloquear
// tienda" pasan a un botón "⋯". Las vendedoras siguen con su menú de siempre
// (ver App.jsx). Cada grupo recuerda el último submenú que se usó.

// Los "id" de cada submenú son los mismos de "vista" en App.jsx.
const GRUPOS = [
  {
    id: 'ventas',
    nombre: 'Ventas',
    subs: [
      { id: 'vender', nombre: 'Vender' },
      { id: 'cambios', nombre: 'Cambios' },
      { id: 'movimientos', nombre: 'Historial de ventas' },
    ],
  },
  {
    id: 'caja',
    nombre: 'Caja',
    subs: [
      { id: 'cierre', nombre: 'Cierre del día' },
      { id: 'gastos', nombre: 'Gastos' },
      { id: 'sobres', nombre: 'Entrega de dinero' },
    ],
  },
  {
    id: 'mercancia',
    nombre: 'Mercancía',
    subs: [
      { id: 'compras', nombre: 'Compras' },
      { id: 'recibir', nombre: 'Recibir mercancía' },
      { id: 'inventario', nombre: 'Inventario' },
      { id: 'entradasSalidas', nombre: 'Entradas y salidas' },
    ],
  },
  {
    id: 'finanzas',
    nombre: 'Finanzas',
    subs: [
      { id: 'ganancia', nombre: 'Ganancia' },
      { id: 'capital', nombre: 'Capital disponible' },
      { id: 'conciliacion', nombre: 'Conciliación' },
      { id: 'nequi', nombre: 'Números de Nequi' },
    ],
  },
  {
    id: 'reportes',
    nombre: 'Reportes',
    subs: [
      { id: 'reporteNegocio', nombre: 'Cómo va el negocio' },
      { id: 'libroDiario', nombre: 'Libro diario' },
      { id: 'fechasEspeciales', nombre: 'Fechas especiales' },
    ],
  },
];

function Icono({ grupo }) {
  const comun = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  if (grupo === 'ventas')
    return (
      <svg {...comun}>
        <path d="M6 8h12l-1 12H7L6 8z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
    );
  if (grupo === 'caja')
    return (
      <svg {...comun}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 9v.01M18 15v.01" />
      </svg>
    );
  if (grupo === 'mercancia')
    return (
      <svg {...comun}>
        <path d="M3 7l9-4 9 4-9 4-9-4z" />
        <path d="M3 7v10l9 4 9-4V7" />
        <path d="M12 11v10" />
      </svg>
    );
  if (grupo === 'reportes')
    return (
      <svg {...comun}>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6M8 17v-3M12 17v-6M16 17v-2" />
      </svg>
    );
  return (
    <svg {...comun}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

const CLAVE_ULTIMO = 'evejeans_menu_nelson_ultimo';
function leerUltimo() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_ULTIMO) || '{}') || {};
  } catch {
    return {};
  }
}
function guardarUltimo(datos) {
  try {
    localStorage.setItem(CLAVE_ULTIMO, JSON.stringify(datos));
  } catch {
    // no pasa nada: solo no se recuerda el último submenú
  }
}

function Punto({ n }) {
  if (!n) return null;
  return (
    <span className="mn-punto" aria-label={`${n} pendientes`}>
      {n}
    </span>
  );
}

export default function MenuNelson({ usuario, vista, setVista, panicoActivo, onCambiarTurno, onBloquear, onDesbloquear }) {
  const [ultimo, setUltimo] = useState(leerUltimo);
  const [menuAbierto, setMenuAbierto] = useState(false);
  // Avisos en vivo: facturas que faltan por recibir en la tienda, y días de
  // efectivo que la vendedora ya avisó que están listos para recoger.
  const [porRecibir, setPorRecibir] = useState(0);
  const [porRecoger, setPorRecoger] = useState(0);

  useEffect(() => {
    const quitarCompras = suscribirPedidosPendientes((lista) => setPorRecibir(lista.length), () => {});
    const quitarPlanillas = suscribirPlanillasPendientes(
      (lista) => setPorRecoger(lista.filter((p) => p.habilitada).length),
      () => {}
    );
    return () => {
      quitarCompras();
      quitarPlanillas();
    };
  }, []);

  useEffect(() => {
    if (!menuAbierto) return;
    const cerrar = () => setMenuAbierto(false);
    window.addEventListener('click', cerrar);
    return () => window.removeEventListener('click', cerrar);
  }, [menuAbierto]);

  const avisos = { recibir: porRecibir, sobres: porRecoger };
  const grupoActual = GRUPOS.find((g) => g.subs.some((s) => s.id === vista)) || GRUPOS[0];
  const avisosDe = (g) => g.subs.reduce((n, s) => n + (avisos[s.id] || 0), 0);

  function irAGrupo(g) {
    const recordado = g.subs.find((s) => s.id === ultimo[g.id]);
    setVista((recordado || g.subs[0]).id);
    setMenuAbierto(false);
    window.scrollTo(0, 0);
  }
  function irASub(g, s) {
    const nuevo = { ...ultimo, [g.id]: s.id };
    setUltimo(nuevo);
    guardarUltimo(nuevo);
    setVista(s.id);
    window.scrollTo(0, 0);
  }

  const botonPanico = panicoActivo ? (
    <button className="panic-btn desbloquear" onClick={onDesbloquear}>
      🔓 Desbloquear tienda
    </button>
  ) : (
    <button className="panic-btn bloquear" onClick={onBloquear}>
      🔒 Bloquear tienda
    </button>
  );

  return (
    <>
      <div className="topbar mn-topbar">
        <div className="brand">
          <img src="/logo.png" alt="Eve Jeans" className="brand-logo" />
          <span className="mn-solo-pc">· punto de venta</span>
        </div>
        <div className="spacer" />
        <div className="who">
          <span className="mn-solo-pc">Turno de </span>
          <b>{usuario.nombreDefault}</b>
        </div>
        <button className="link-btn mn-solo-pc" onClick={onCambiarTurno}>
          Cambiar de turno
        </button>
        <div className="topbar-divider mn-solo-pc" />
        <span className="mn-solo-pc">{botonPanico}</span>
        <button
          className="mn-tres mn-solo-cel"
          aria-label="Más opciones"
          aria-expanded={menuAbierto}
          onClick={(e) => {
            e.stopPropagation();
            setMenuAbierto((v) => !v);
          }}
        >
          ⋯
        </button>
        {menuAbierto && (
          <div className="mn-menu-cuenta" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                setMenuAbierto(false);
                onCambiarTurno();
              }}
            >
              Cambiar de turno
            </button>
            <button
              className={panicoActivo ? 'verde' : 'rojo'}
              onClick={() => {
                setMenuAbierto(false);
                if (panicoActivo) onDesbloquear();
                else onBloquear();
              }}
            >
              {panicoActivo ? '🔓 Desbloquear tienda' : '🔒 Bloquear tienda'}
            </button>
          </div>
        )}
      </div>

      <nav className="mn-grupos" aria-label="Menú">
        {GRUPOS.map((g) => (
          <button
            key={g.id}
            className={`mn-grupo ${g.id === grupoActual.id ? 'on' : ''}`}
            aria-current={g.id === grupoActual.id ? 'page' : undefined}
            onClick={() => irAGrupo(g)}
          >
            <Icono grupo={g.id} />
            <span>{g.nombre}</span>
            <Punto n={avisosDe(g)} />
          </button>
        ))}
      </nav>

      <nav className="mn-subs" aria-label={`Submenú de ${grupoActual.nombre}`}>
        {grupoActual.subs.map((s) => (
          <button
            key={s.id}
            className={`mn-sub ${s.id === vista ? 'on' : ''}`}
            aria-current={s.id === vista ? 'page' : undefined}
            onClick={() => irASub(grupoActual, s)}
          >
            {s.nombre}
            <Punto n={avisos[s.id]} />
          </button>
        ))}
      </nav>
    </>
  );
}
