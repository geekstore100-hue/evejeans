import { parseFecha, fechaStr, sumarDias, suscribirHistoricos, suscribirVentasRango } from './reportes';

// Aviso de "podríamos necesitar otra vendedora" (lo ven Nelson y Fausto).
// No depende de ninguna fecha especial ni de "cuántas veces un día normal":
// lo que importa es cuánta plata se mueve en el día. Si ese mismo día, en
// años anteriores, se vendió UMBRAL_PESOS o más, avisa unos días antes.

export const DIAS_ANTES = 10; // con cuánta anticipación avisar
export const UMBRAL_PESOS = 2500000; // desde aquí una sola vendedora no da abasto (lo definió Nelson)
const ANIOS_ATRAS = 3;

function promedio(lista) {
  return lista.reduce((s, x) => s + x.venta, 0) / lista.length;
}

// Para un día que viene se miran, en los años anteriores, dos cosas:
//  - la misma fecha (lo que pega por fecha, como el 24 de diciembre), y
//  - el mismo día de la semana más cercano (lo que pega por día, como "el
//    sábado antes del Día de la Madre" o el viernes de Black Friday).
// De cada una se saca el promedio de los años que haya, y se queda la mayor.
export function pronosticoDia(dias, fecha) {
  const d = parseFecha(fecha);
  const porFecha = [];
  const porDia = [];
  for (let y = 1; y <= ANIOS_ATRAS; y++) {
    const misma = new Date(d.getFullYear() - y, d.getMonth(), d.getDate());
    if (misma.getMonth() !== d.getMonth()) continue; // 29 de febrero
    const mismaStr = fechaStr(misma);
    const desfase = ((d.getDay() - misma.getDay() + 10) % 7) - 3; // entre -3 y 3
    const mismoDia = sumarDias(mismaStr, desfase);
    if (dias[mismaStr] != null) porFecha.push({ fecha: mismaStr, venta: dias[mismaStr] });
    if (dias[mismoDia] != null) porDia.push({ fecha: mismoDia, venta: dias[mismoDia] });
  }
  const opciones = [porFecha, porDia].filter((l) => l.length).map((l) => ({ esperado: promedio(l), referencias: l }));
  if (!opciones.length) return null;
  const mejor = opciones.reduce((a, b) => (b.esperado > a.esperado ? b : a));
  return { fecha, ...mejor };
}

export function diasFuertesProximos(dias, hoy, adelante = DIAS_ANTES, umbral = UMBRAL_PESOS) {
  const res = [];
  for (let i = 0; i <= adelante; i++) {
    const p = pronosticoDia(dias, sumarDias(hoy, i));
    if (p && p.esperado >= umbral) res.push({ ...p, faltan: i });
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
    // Los mismos días del año (con margen para el "mismo día de la semana").
    rangos.push({ y, desde: sumarDias(haceY, -4), hasta: sumarDias(haceY, DIAS_ANTES + 4) });
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
