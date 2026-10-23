import { parseFecha, fechaStr, sumarDias, suscribirHistoricos, suscribirVentasRango } from './reportes';

// Aviso de "podríamos necesitar otra vendedora" (lo ven Nelson y Fausto).
// No depende de ninguna fecha especial: mira, para cada uno de los próximos
// días, cómo se vendió ese mismo día en años anteriores comparado con un día
// normal. Si fue el doble o más, avisa unos días antes.

export const DIAS_ANTES = 10; // con cuánta anticipación avisar
export const UMBRAL = 2; // "muy por encima": el doble o más de un día normal
const ANIOS_ATRAS = 3;

function mediana(vals) {
  const v = [...vals].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Un día normal: la mediana del mismo día de la semana en las 8 semanas
// anteriores (sin días cerrados). La mediana no se deja jalar por los picos.
function normalDe(dias, fecha) {
  const vals = [];
  for (let k = 1; k <= 8; k++) {
    const v = dias[sumarDias(fecha, -7 * k)];
    if (v > 0) vals.push(v);
  }
  return vals.length >= 3 ? mediana(vals) : null;
}
function vecesDe(dias, fecha) {
  const v = dias[fecha];
  if (v == null) return null;
  const n = normalDe(dias, fecha);
  return n ? { fecha, venta: v, veces: v / n } : null;
}

// Para un día que viene: en cada año anterior se miran dos días — la misma
// fecha (sirve para las fechas fijas, como el 24 de diciembre) y el mismo día
// de la semana más cercano (sirve para lo que cae "el segundo sábado", "la
// quincena del viernes"…) — y se queda el más alto de los dos.
export function pronosticoDia(dias, fecha) {
  const d = parseFecha(fecha);
  const porAnio = [];
  for (let y = 1; y <= ANIOS_ATRAS; y++) {
    const misma = new Date(d.getFullYear() - y, d.getMonth(), d.getDate());
    if (misma.getMonth() !== d.getMonth()) continue; // 29 de febrero
    const mismaStr = fechaStr(misma);
    const desfase = ((d.getDay() - misma.getDay() + 10) % 7) - 3; // entre -3 y 3
    const candidatos = [vecesDe(dias, mismaStr), vecesDe(dias, sumarDias(mismaStr, desfase))].filter(Boolean);
    if (!candidatos.length) continue;
    porAnio.push(candidatos.reduce((a, b) => (b.veces > a.veces ? b : a)));
  }
  if (!porAnio.length) return null;
  return { fecha, veces: porAnio.reduce((s, x) => s + x.veces, 0) / porAnio.length, porAnio };
}

export function diasFuertesProximos(dias, hoy, adelante = DIAS_ANTES) {
  const res = [];
  for (let i = 0; i <= adelante; i++) {
    const p = pronosticoDia(dias, sumarDias(hoy, i));
    if (p && p.veces >= UMBRAL) res.push({ ...p, faltan: i });
  }
  return res;
}

// Escucha lo necesario para el aviso: el historial (un documento por año) y,
// del sistema, solo las ventas alrededor de estas mismas fechas en años
// anteriores (no todo el año), para que abrir la app no lea miles de ventas.
export function suscribirAvisoRefuerzo(hoy, callback, onError) {
  const estado = { historicos: null, ventas: {} };
  const rangos = [];
  for (let y = 1; y <= ANIOS_ATRAS; y++) {
    const base = parseFecha(hoy);
    const haceY = fechaStr(new Date(base.getFullYear() - y, base.getMonth(), base.getDate()));
    // 8 semanas antes (para el día normal) hasta los días que se miran, con margen.
    rangos.push({ y, desde: sumarDias(haceY, -60), hasta: sumarDias(haceY, DIAS_ANTES + 4) });
  }
  function avisar() {
    if (!estado.historicos || rangos.some((r) => !estado.ventas[r.y])) return;
    const dias = {};
    estado.historicos.forEach((h) =>
      Object.entries(h.dias || {}).forEach(([f, v]) => {
        if (typeof v === 'number') dias[f] = v;
      })
    );
    const sistema = {};
    rangos.forEach((r) =>
      estado.ventas[r.y].forEach((v) => {
        if (v.tipo !== 'venta' || v.anulada) return;
        sistema[v.fecha] = (sistema[v.fecha] || 0) + (v.total || 0);
      })
    );
    Object.entries(sistema).forEach(([f, v]) => {
      dias[f] = dias[f] != null ? Math.max(dias[f], v) : v;
    });
    callback(diasFuertesProximos(dias, hoy));
  }
  const quitar = [
    suscribirHistoricos((h) => {
      estado.historicos = h;
      avisar();
    }, onError),
    ...rangos.map((r) =>
      suscribirVentasRango(
        r.desde,
        r.hasta,
        (lista) => {
          estado.ventas[r.y] = lista;
          avisar();
        },
        onError
      )
    ),
  ];
  return () => quitar.forEach((q) => q());
}
