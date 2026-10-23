import { useEffect, useRef, useState } from 'react';

// Gráficos sencillos de la sección Reportes, hechos a mano en SVG (sin
// librerías). Una sola serie en rosa fuerte; lo que es "contexto" va en gris.
// Al pasar el mouse (o tocar, en el celular) cada barra muestra su valor.

const ROSA = '#c05f89';
const ROSA_MEDIO = '#e2a3bf';
const GRIS = '#d9cdd5';
const GRILLA = '#f1e8ee';
const TINTA = '#3d3548';
const TINTA_SUAVE = '#9a8fa4';

function useAncho() {
  const ref = useRef(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setAncho(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAncho(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho];
}

// datos: [{ label, corto, valor, nivel?: 'fuerte'|'movido', destacado?: bool }]
// modo: 'simple' (todas rosa) | 'destacar' (rosa solo las destacadas) | 'niveles'
// linea: valor donde dibujar una línea de referencia (ej. 1 = "día normal")
export function Columnas({ datos, eje, tip, alto = 190, modo = 'simple', etiquetaMax = false, linea = null, lineaTexto = null, aria }) {
  const [ref, anchoCont] = useAncho();
  const [activo, setActivo] = useState(null);
  const W = Math.max(280, anchoCont || 600);
  const H = alto;
  const mL = 48;
  const mR = 8;
  const mT = 22;
  const mB = 26;

  const max = Math.max(linea || 0, ...datos.map((d) => d.valor || 0)) || 1;
  const base = Math.pow(10, Math.floor(Math.log10(max / 3)));
  let paso = base;
  [1, 2, 2.5, 5, 10].some((k) => {
    paso = k * base;
    return max / paso <= 4;
  });
  const tope = Math.ceil(max / paso) * paso;
  const ticks = [];
  for (let t = 0; t <= tope + 1e-9; t += paso) ticks.push(t);

  const pw = W - mL - mR;
  const ph = H - mT - mB;
  const n = datos.length || 1;
  const banda = pw / n;
  const bw = Math.min(24, banda * 0.66);
  const cadaN = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 36))));
  let imax = 0;
  datos.forEach((d, i) => {
    if (d.valor > datos[imax].valor) imax = i;
  });
  const y = (v) => mT + ph - (v / tope) * ph;

  function color(d) {
    if (modo === 'niveles') return d.nivel === 'fuerte' ? ROSA : d.nivel === 'movido' ? ROSA_MEDIO : GRIS;
    if (modo === 'destacar') return d.destacado ? ROSA : GRIS;
    return ROSA;
  }

  const dAct = activo != null ? datos[activo] : null;
  const escala = anchoCont ? anchoCont / W : 1;

  return (
    <div className="rp-plot" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} onPointerLeave={() => setActivo(null)}>
        {ticks.map((t) => {
          const esLinea = linea != null && !lineaTexto && Math.abs(t - linea) < 1e-9;
          return (
            <g key={t}>
              <line x1={mL} x2={W - mR} y1={y(t)} y2={y(t)} stroke={t === 0 ? GRIS : GRILLA} strokeWidth="1" />
              <text x={mL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={esLinea ? TINTA : TINTA_SUAVE} fontWeight={esLinea ? 700 : 400}>
                {esLinea ? 'normal' : eje(t)}
              </text>
            </g>
          );
        })}
        {datos.map((d, i) => {
          const x = mL + banda * i + (banda - bw) / 2;
          const hgt = Math.max(0, ((d.valor || 0) / tope) * ph);
          const yy = mT + ph - hgt;
          const rr = Math.min(4, hgt, bw / 2);
          const piso = mT + ph;
          return (
            <g key={i}>
              {hgt > 0 && (
                <path
                  d={`M${x},${piso}V${yy + rr}Q${x},${yy} ${x + rr},${yy}H${x + bw - rr}Q${x + bw},${yy} ${x + bw},${yy + rr}V${piso}Z`}
                  fill={color(d)}
                  opacity={activo != null && activo !== i ? 0.75 : 1}
                />
              )}
              {(i % cadaN === 0 || i === n - 1) && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={TINTA_SUAVE}>
                  {d.corto ?? d.label}
                </text>
              )}
              {etiquetaMax && i === imax && d.valor > 0 && (
                <text x={x + bw / 2} y={yy - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill={TINTA}>
                  {eje(d.valor)}
                </text>
              )}
              <rect
                x={mL + banda * i}
                y={mT}
                width={banda}
                height={ph}
                fill="transparent"
                onPointerEnter={() => setActivo(i)}
                onClick={() => setActivo(i)}
              />
            </g>
          );
        })}
        {linea != null && <line x1={mL} x2={W - mR} y1={y(linea)} y2={y(linea)} stroke={TINTA} strokeWidth="1" pointerEvents="none" />}
        {linea != null && lineaTexto && (
          <text x={W - mR} y={y(linea) - 5} textAnchor="end" fontSize="11" fontWeight="700" fill={TINTA} pointerEvents="none">
            {lineaTexto}
          </text>
        )}
      </svg>
      {dAct && (
        <div
          className="rp-tip"
          style={{
            // Que no se salga por los bordes en las primeras y últimas barras.
            left: Math.min(Math.max((mL + banda * activo + banda / 2) * escala, 80), Math.max(80, (anchoCont || W) - 80)),
            top: (mT - 4) * escala,
          }}
        >
          {dAct.label}
          <br />
          <b>{tip(dAct)}</b>
        </div>
      )}
    </div>
  );
}

// filas: [{ nombre, sub?, valor, txt, txt2?, gris? }]
export function Barras({ filas }) {
  if (!filas.length) return <p className="rp-vacio">Todavía no hay datos en este período.</p>;
  const max = Math.max(...filas.map((r) => r.valor)) || 1;
  return (
    <div className="rp-hbarras">
      {filas.map((r, i) => (
        <div className="rp-hb" key={r.nombre + i}>
          <div className="rp-hb-nombre">
            {r.nombre}
            {r.sub && <small>{r.sub}</small>}
          </div>
          <div className="rp-hb-pista">
            <div className={`rp-hb-barra ${r.gris ? 'gris' : ''}`} style={{ width: `${Math.max(0, (r.valor / max) * 100)}%` }} />
          </div>
          <div className="rp-hb-valor">
            {r.txt}
            {r.txt2 && <small>{r.txt2}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Tarjeta con título, una frase que se lee de una, el gráfico, y (opcional)
// el botón "Ver datos" que muestra la misma información en tabla.
export function Tarjeta({ titulo, lectura, ancha, tabla, children }) {
  const [verDatos, setVerDatos] = useState(false);
  return (
    <section className={`rp-tarjeta ${ancha ? 'ancha' : ''}`}>
      <div className="rp-tarjeta-top">
        <h3>{titulo}</h3>
        {tabla && (
          <button className="rp-ver-datos" onClick={() => setVerDatos((v) => !v)} aria-expanded={verDatos}>
            {verDatos ? 'Ocultar datos' : 'Ver datos'}
          </button>
        )}
      </div>
      {lectura && <p className="rp-lectura">{lectura}</p>}
      {children}
      {tabla && verDatos && (
        <table className="rp-tabla-datos">
          <thead>
            <tr>
              <th>{tabla.cab[0]}</th>
              <th>{tabla.cab[1]}</th>
            </tr>
          </thead>
          <tbody>
            {tabla.filas.map((r, i) => (
              <tr key={i}>
                <td>{r[0]}</td>
                <td>{r[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
