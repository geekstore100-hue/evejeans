import { useEffect, useMemo, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import {
  hoyStr,
  sumarDias,
  parseFecha,
  fechaStr,
  fechaLarga,
  fechaConDia,
  DIAS,
  fmt,
  corto,
  horaAMinutos,
  suscribirVentasRango,
  suscribirGastosRango,
  suscribirEntregasRango,
} from '../lib/reportes';
import { Columnas, Barras, Tarjeta } from '../components/Graficos';
import PreguntaIA from '../components/PreguntaIA';

// "Cómo va el negocio" (solo Nelson): cuánto se vende y se gana contra el
// período anterior, por qué cambió la ganancia (en pesos, factor por factor)
// y gráficos de cómo se vende.
// Todo en vivo: si entra una venta mientras está abierto, se actualiza solo.

const MESES_CORTOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function periodos(hoy) {
  const d = parseFecha(hoy);
  const lunes = sumarDias(hoy, -((d.getDay() + 6) % 7));
  const iniMes = fechaStr(new Date(d.getFullYear(), d.getMonth(), 1));
  const iniMesAnt = fechaStr(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const finMesAnt = fechaStr(new Date(d.getFullYear(), d.getMonth(), 0));
  const iniMesAntAnt = fechaStr(new Date(d.getFullYear(), d.getMonth() - 2, 1));
  const finMesAntAnt = fechaStr(new Date(d.getFullYear(), d.getMonth() - 1, 0));
  // Los mismos días del mes pasado (si hoy es 31 y el mes pasado tuvo 30, hasta el 30).
  const ultimoMesAnt = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
  const mismoDiaMesAnt = fechaStr(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), ultimoMesAnt)));
  const mesAnt = MESES_CORTOS[new Date(d.getFullYear(), d.getMonth() - 1, 1).getMonth()];
  const mesAntAnt = MESES_CORTOS[new Date(d.getFullYear(), d.getMonth() - 2, 1).getMonth()];
  return {
    semana: {
      nombre: 'Esta semana',
      desde: lunes,
      hasta: hoy,
      ant: { desde: sumarDias(lunes, -7), hasta: sumarDias(hoy, -7), txt: 'los mismos días de la semana pasada' },
    },
    mes: {
      nombre: 'Este mes',
      desde: iniMes,
      hasta: hoy,
      ant: { desde: iniMesAnt, hasta: mismoDiaMesAnt, txt: `los mismos días de ${mesAnt}` },
    },
    mesPasado: {
      nombre: 'Mes pasado',
      desde: iniMesAnt,
      hasta: finMesAnt,
      ant: { desde: iniMesAntAnt, hasta: finMesAntAnt, txt: mesAntAnt },
    },
    d90: {
      nombre: 'Últimos 90 días',
      desde: sumarDias(hoy, -89),
      hasta: hoy,
      ant: { desde: sumarDias(hoy, -179), hasta: sumarDias(hoy, -90), txt: 'los 90 días anteriores' },
    },
  };
}

function entre(s, a, b) {
  return s >= a && s <= b;
}
function costoItem(i, costoPorId) {
  return i.costoCompra !== undefined ? i.costoCompra : costoPorId[i.id] || 0;
}
function resumen(ventas, desde, hasta, costoPorId) {
  const vs = ventas.filter((v) => v.tipo === 'venta' && !v.anulada && entre(v.fecha, desde, hasta));
  let total = 0;
  let costo = 0;
  let prendas = 0;
  let desc = 0;
  vs.forEach((v) => {
    total += v.total || 0;
    desc += v.descuento || 0;
    (v.items || []).forEach((i) => {
      costo += costoItem(i, costoPorId) * i.qty;
      prendas += i.qty;
    });
  });
  return { vs, total, costo, ganancia: total - costo, prendas, n: vs.length, ticket: vs.length ? total / vs.length : 0, desc };
}
function horaTexto(h) {
  const a = (x) => `${x % 12 || 12} ${x < 12 || x === 24 ? 'a. m.' : 'p. m.'}`;
  return `${a(h)} a ${a(h + 1)}`;
}
function pctTxt(p) {
  return Math.abs(p).toLocaleString('es-CO', { maximumFractionDigits: 0 }) + '%';
}

function Kpi({ label, valor, a, b, sub }) {
  const hayAntes = b > 0;
  const p = hayAntes ? ((a - b) / b) * 100 : 0;
  const sube = p >= 0;
  return (
    <div className="rp-kpi">
      <div className="rp-kpi-label">{label}</div>
      <div className="rp-kpi-valor">{valor}</div>
      {hayAntes ? (
        <span className={`rp-kpi-delta ${sube ? 'sube' : 'baja'}`}>
          {sube ? '▲' : '▼'} {pctTxt(p)}
        </span>
      ) : (
        <span className="rp-kpi-delta neutro">sin datos para comparar</span>
      )}
      <div className="rp-kpi-sub">{sub}</div>
    </div>
  );
}

// ---------- ¿Por qué cambió la ganancia? ----------
// La ganancia bruta es: prendas × lo que deja cada prenda − descuentos. El
// cambio entre los dos períodos se reparte, en pesos y sin que sobre ni falte
// nada, en cuatro causas:
//  1. Cantidad: se vendieron más o menos prendas.
//  2. Mezcla: se vendieron más de las referencias que dejan poco (o al revés).
//  3. Costo y precio: la misma referencia costó más o se vendió a otro precio.
//  4. Descuentos: se dieron más o menos descuentos.
function porReferencia(r, costoPorId, porId) {
  const refs = {};
  let desc = 0;
  r.vs.forEach((v) => {
    const sub = (v.items || []).reduce((s, i) => s + (i.price || 0) * i.qty, 0);
    desc += sub - (v.total || 0);
    (v.items || []).forEach((i) => {
      const a = (refs[i.id] = refs[i.id] || { nombre: porId[i.id]?.name || i.name, u: 0, venta: 0, costo: 0 });
      a.u += i.qty;
      a.venta += (i.price || 0) * i.qty;
      a.costo += costoItem(i, costoPorId) * i.qty;
    });
  });
  return { refs, desc };
}

function explicarGanancia(act, ant, costoPorId, porId) {
  const A = porReferencia(act, costoPorId, porId);
  const B = porReferencia(ant, costoPorId, porId);
  const U1 = Object.values(A.refs).reduce((s, r) => s + r.u, 0);
  const U0 = Object.values(B.refs).reduce((s, r) => s + r.u, 0);
  if (!U0) return null;
  const deja = (r) => (r.venta - r.costo) / r.u;
  const promedio0 = Object.values(B.refs).reduce((s, r) => s + r.venta - r.costo, 0) / U0;

  const ids = [...new Set([...Object.keys(A.refs), ...Object.keys(B.refs)])];
  const filas = ids.map((id) => {
    const a = A.refs[id];
    const b = B.refs[id];
    const m1 = a ? deja(a) : null;
    const m0 = b ? deja(b) : m1; // referencia nueva: se compara contra sí misma
    const u1 = a ? a.u : 0;
    const u0 = b ? b.u : 0;
    const deMas = u1 - (U1 * u0) / U0; // prendas de más (o de menos) frente a la mezcla de antes
    return {
      id,
      nombre: (a || b).nombre,
      m0,
      deMas,
      mezcla: deMas * (m0 - promedio0),
      costoPrecio: a ? u1 * (m1 - m0) : 0,
      c0: b ? b.costo / b.u : null,
      c1: a ? a.costo / a.u : null,
      p0: b ? b.venta / b.u : null,
      p1: a ? a.venta / a.u : null,
    };
  });

  const volumen = (U1 - U0) * promedio0;
  const mezcla = filas.reduce((s, f) => s + f.mezcla, 0);
  const costoPrecio = filas.reduce((s, f) => s + f.costoPrecio, 0);
  const descuentos = -(A.desc - B.desc);
  const enDireccion = (campo, signo) =>
    filas
      .filter((f) => Math.sign(f[campo]) === signo && Math.abs(f[campo]) >= 1)
      .sort((x, y) => Math.abs(y[campo]) - Math.abs(x[campo]))
      .slice(0, 2);

  const dif = U1 - U0;
  const factores = [
    {
      id: 'cantidad',
      nombre: 'Cantidad de prendas',
      valor: volumen,
      texto:
        dif === 0
          ? `Se vendieron las mismas ${U1} prendas que antes.`
          : `Se vendieron ${U1} prendas, ${Math.abs(dif)} ${dif < 0 ? 'menos' : 'más'} que antes (${U0}). Cada prenda dejaba en promedio ${fmt(promedio0)}.`,
    },
    {
      id: 'mezcla',
      nombre: 'Qué referencias se vendieron',
      valor: mezcla,
      texto: (() => {
        const top = enDireccion('mezcla', Math.sign(mezcla));
        if (!top.length) return 'Se vendió la misma mezcla de referencias que antes.';
        return (
          `Se vendió una mezcla que deja ${mezcla < 0 ? 'menos' : 'más'}: ` +
          top
            .map((f) => `${f.deMas < 0 ? 'menos' : 'más'} ${f.nombre} (deja ${fmt(f.m0)} por prenda)`)
            .join(' y ') +
          `. El promedio era ${fmt(promedio0)} por prenda.`
        );
      })(),
    },
    {
      id: 'costo',
      nombre: 'Costo y precio de cada referencia',
      valor: costoPrecio,
      texto: (() => {
        const top = enDireccion('costoPrecio', Math.sign(costoPrecio));
        if (!top.length) return 'Cada referencia costó y se vendió igual que antes.';
        return (
          top
            .map((f) => {
              const partes = [];
              if (f.c0 != null && Math.round(f.c1) !== Math.round(f.c0)) partes.push(`costó ${fmt(f.c1)} por prenda (antes ${fmt(f.c0)})`);
              if (f.p0 != null && Math.round(f.p1) !== Math.round(f.p0)) partes.push(`se vendió a ${fmt(f.p1)} (antes ${fmt(f.p0)})`);
              return `${f.nombre} ${partes.join(' y ') || 'cambió poco'}`;
            })
            .join('; ') + '.'
        );
      })(),
    },
    {
      id: 'descuentos',
      nombre: 'Descuentos',
      valor: descuentos,
      texto: `Diste ${fmt(A.desc)} en descuentos (antes ${fmt(B.desc)}).`,
    },
  ];
  return { total: act.ganancia - ant.ganancia, factores };
}

function PorQue({ explicacion, txtAntes }) {
  if (!explicacion) {
    return (
      <Tarjeta ancha titulo="¿Por qué cambió la ganancia?" lectura={`No hay ventas en ${txtAntes} para comparar.`} />
    );
  }
  const { total, factores } = explicacion;
  const orden = [...factores].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const max = Math.max(1, ...factores.map((f) => Math.abs(f.valor)));
  const principal = orden.find((f) => Math.sign(f.valor) === Math.sign(total));
  const signo = (v) => (Math.round(v) === 0 ? '' : v < 0 ? '−' : '+');
  return (
    <Tarjeta
      ancha
      titulo="¿Por qué cambió la ganancia?"
      lectura={
        Math.round(total) === 0 ? (
          `La ganancia bruta quedó igual que en ${txtAntes}.`
        ) : (
          <>
            La ganancia bruta <b>{total < 0 ? 'bajó' : 'subió'} {fmt(Math.abs(total))}</b> frente a {txtAntes}.
            {principal && (
              <>
                {' '}
                Lo que más pesó: <b>{principal.nombre.toLowerCase()}</b>.
              </>
            )}
          </>
        )
      }
    >
      <div className="rp-porque">
        {orden.map((f) => (
          <div className="rp-porque-fila" key={f.id}>
            <div className="rp-porque-texto">
              <b>{f.nombre}</b>
              <small>{f.texto}</small>
            </div>
            <div className="rp-porque-pista" aria-hidden="true">
              <div
                className={`rp-porque-barra ${f.valor < 0 ? 'baja' : 'sube'}`}
                style={{ width: `${(Math.abs(f.valor) / max) * 50}%`, [f.valor < 0 ? 'right' : 'left']: '50%' }}
              />
            </div>
            <div className={`rp-porque-valor ${Math.round(f.valor) === 0 ? '' : f.valor < 0 ? 'baja' : 'sube'}`}>
              {signo(f.valor)}
              {fmt(Math.abs(f.valor))}
            </div>
          </div>
        ))}
        <div className="rp-porque-fila total">
          <div className="rp-porque-texto">
            <b>Cambio total de la ganancia bruta</b>
          </div>
          <div />
          <div className={`rp-porque-valor ${Math.round(total) === 0 ? '' : total < 0 ? 'baja' : 'sube'}`}>
            {signo(total)}
            {fmt(Math.abs(total))}
          </div>
        </div>
      </div>
    </Tarjeta>
  );
}

// Lo que se le manda a la IA: solo números agregados del período y del
// anterior. Las vendedoras van como "Vendedora 1", "Vendedora 2"… (sin
// nombres de personas) y en pantalla se vuelven a poner los nombres reales.
function armarResumenIA(x) {
  const r = Math.round;
  const tot = (s) => ({
    ventas: r(s.total),
    ganancia_bruta: r(s.ganancia),
    costo_de_lo_vendido: r(s.costo),
    margen_pct: s.total ? r((s.ganancia / s.total) * 100) : null,
    prendas: s.prendas,
    numero_de_ventas: s.n,
    venta_promedio: r(s.ticket),
    descuentos: r(s.desc),
  });
  const A = porReferencia(x.act, x.costoPorId, x.porId);
  const B = porReferencia(x.ant, x.costoPorId, x.porId);
  const stock = {};
  x.inventario.forEach((it) => {
    if (!it.oculto) stock[it.id] = it.stock || 0;
  });
  const ref = (q) =>
    q
      ? { prendas: q.u, ventas: r(q.venta), ganancia: r(q.venta - q.costo), precio_promedio: r(q.venta / q.u), costo_promedio: r(q.costo / q.u) }
      : { prendas: 0 };
  const referencias = [...new Set([...Object.keys(A.refs), ...Object.keys(B.refs), ...Object.keys(stock)])]
    .map((id) => ({
      referencia: (A.refs[id] || B.refs[id])?.nombre || x.porId[id]?.name || id,
      este_periodo: ref(A.refs[id]),
      periodo_anterior: ref(B.refs[id]),
      stock_hoy: stock[id] ?? null,
      costo_de_compra_hoy: x.porId[id] ? r(x.porId[id].costoCompra || 0) : null,
    }))
    .filter((q) => q.este_periodo.prendas || q.periodo_anterior.prendas || q.stock_hoy)
    .sort((a, b) => (b.este_periodo.ganancia || 0) - (a.este_periodo.ganancia || 0));
  const nombres = {};
  const vendedoras = Object.entries(x.porV)
    .sort((a, b) => b[1].t - a[1].t)
    .map(([nombre, a], i) => {
      const alias = `Vendedora ${i + 1}`;
      nombres[alias] = nombre;
      return { vendedora: alias, ventas: r(a.t), numero_de_ventas: a.n, prendas: a.p, venta_promedio: r(a.t / a.n) };
    });
  const resumen = {
    periodo: { nombre: x.P.nombre, desde: x.P.desde, hasta: x.P.hasta },
    comparado_con: { descripcion: x.P.ant.txt, desde: x.P.ant.desde, hasta: x.P.ant.hasta },
    hoy: x.hoy,
    totales: { este_periodo: tot(x.act), periodo_anterior: tot(x.ant) },
    por_que_cambio_ganancia: x.porQue
      ? { cambio_total: r(x.porQue.total), causas: x.porQue.factores.map((f) => ({ causa: f.nombre, pesos: r(f.valor), detalle: f.texto })) }
      : null,
    referencias,
    ventas_por_dia: x.porDia.map((q) => ({ fecha: q.fecha, ventas: r(q.valor) })),
    promedio_por_dia_de_la_semana: x.sem.map((q) => ({ dia: q.label, promedio: r(q.valor), dias_con_ventas: q.n })),
    ventas_por_hora: x.porHora.map((q) => ({ hora: q.label, numero_de_ventas: q.valor })),
    medios_de_pago: x.medios.map(([m, v]) => ({ medio: m, pesos: r(v) })),
    vendedoras,
    gastos_por_categoria: Object.entries(x.porCat).map(([c, v]) => ({ categoria: c, pesos: r(v) })),
    retiros_de_socios: r(x.retiros),
    cambios_de_prendas: x.nCambios,
    ventas_anuladas: { cantidad: x.anuladas.length, pesos: r(x.anuladas.reduce((s, v) => s + (v.total || 0), 0)) },
    ventas_con_descuento: x.conDesc,
    faltantes_en_entregas_de_efectivo: { entregas: x.faltas.length, pesos: r(x.faltaTot) },
  };
  return { resumen, nombres };
}

export default function ReporteNegocio() {
  const [periodo, setPeriodo] = useState('mes');
  const [hoy, setHoy] = useState(hoyStr());
  const [ventas, setVentas] = useState(null);
  const [gastos, setGastos] = useState([]);
  const [entregas, setEntregas] = useState([]);
  const [inventario, setInventario] = useState(null);
  const [error, setError] = useState('');

  // Si queda abierto de un día para otro, el "hoy" se corre solo.
  useEffect(() => {
    const t = setInterval(() => setHoy(hoyStr()), 60000);
    return () => clearInterval(t);
  }, []);

  const P = useMemo(() => periodos(hoy)[periodo], [hoy, periodo]);
  const desdeEscucha = P.ant.desde;

  useEffect(() => {
    setVentas(null);
    const err = (e) => setError('No se pudo cargar: ' + e.message);
    const q1 = suscribirVentasRango(desdeEscucha, hoy, setVentas, err);
    const q2 = suscribirGastosRango(desdeEscucha, hoy, setGastos, err);
    const q4 = suscribirEntregasRango(P.desde, P.hasta, setEntregas, err);
    return () => {
      q1();
      q2();
      q4();
    };
  }, [desdeEscucha, hoy, P.desde, P.hasta]);

  useEffect(() => suscribirInventario(setInventario, (e) => setError('No se pudo cargar: ' + e.message)), []);

  const datos = useMemo(() => {
    if (!ventas || !inventario) return null;
    const costoPorId = {};
    const porId = {};
    inventario.forEach((it) => {
      costoPorId[it.id] = it.costoCompra || 0;
      porId[it.id] = it;
    });
    const act = resumen(ventas, P.desde, P.hasta, costoPorId);
    const ant = resumen(ventas, P.ant.desde, P.ant.hasta, costoPorId);

    // ---- Por qué cambió la ganancia ----
    const porQue = explicarGanancia(act, ant, costoPorId, porId);

    // ---- Entregas de efectivo con faltantes ----
    const recibidas = entregas.filter((e) => e.estado === 'recibido');
    const faltas = recibidas.filter((e) => (e.difEntrega || 0) < 0).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const faltaTot = faltas.reduce((s, e) => s - e.difEntrega, 0);

    // ---- Ventas por día ----
    const dias = [];
    for (let s = P.desde; s <= P.hasta; s = sumarDias(s, 1)) dias.push(s);
    const totDia = {};
    act.vs.forEach((v) => {
      totDia[v.fecha] = (totDia[v.fecha] || 0) + v.total;
    });
    const porDia = dias.map((s) => ({ fecha: s, label: fechaConDia(s), corto: String(parseFecha(s).getDate()), valor: totDia[s] || 0 }));
    const mejorDia = porDia.reduce((a, b) => (b.valor > a.valor ? b : a), porDia[0]);

    // ---- Día de la semana: promedio de los días que se abrió (con ventas) ----
    const sem = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
      const ds = dias.filter((s) => s !== hoy && parseFecha(s).getDay() === dow && totDia[s] > 0);
      const tot = ds.reduce((a, s) => a + totDia[s], 0);
      return { label: DIAS[dow], corto: DIAS[dow].slice(0, 3), valor: ds.length ? tot / ds.length : 0, n: ds.length };
    });
    const conDatos = sem.filter((d) => d.n > 0);
    const maxSem = conDatos.length ? conDatos.reduce((a, b) => (b.valor > a.valor ? b : a)) : null;
    const minSem = conDatos.length ? conDatos.reduce((a, b) => (b.valor < a.valor ? b : a)) : null;
    sem.forEach((d) => {
      d.destacado = d === maxSem;
    });

    // ---- Hora ----
    const porHoraCont = {};
    act.vs.forEach((v) => {
      const h = Math.floor(horaAMinutos(v.hora) / 60);
      porHoraCont[h] = (porHoraCont[h] || 0) + 1;
    });
    const horasCon = Object.keys(porHoraCont).map(Number);
    const hMin = horasCon.length ? Math.min(9, ...horasCon) : 9;
    const hMax = horasCon.length ? Math.max(19, ...horasCon) : 19;
    const porHora = [];
    for (let h = hMin; h <= hMax; h++) porHora.push({ label: horaTexto(h), corto: String(h % 12 || 12), valor: porHoraCont[h] || 0 });
    const pico = porHora.reduce((a, b) => (b.valor > a.valor ? b : a), porHora[0]);
    porHora.forEach((d) => {
      d.destacado = pico.valor > 0 && d.valor >= pico.valor * 0.85;
    });

    // ---- Las que más ganancia dejan ----
    const agg = {};
    act.vs.forEach((v) =>
      (v.items || []).forEach((i) => {
        const a = (agg[i.id] = agg[i.id] || { nombre: porId[i.id]?.name || i.name, und: 0, venta: 0, costo: 0 });
        a.und += i.qty;
        a.venta += (i.price || 0) * i.qty;
        a.costo += costoItem(i, costoPorId) * i.qty;
      })
    );
    // El descuento de cada venta se reparte entre sus prendas, para que la
    // ganancia por referencia sume lo mismo que la ganancia total.
    act.vs.forEach((v) => {
      const sub = (v.items || []).reduce((s, i) => s + (i.price || 0) * i.qty, 0);
      if (!v.descuento || !sub) return;
      (v.items || []).forEach((i) => {
        agg[i.id].venta -= (v.descuento * (i.price || 0) * i.qty) / sub;
      });
    });
    const top = Object.values(agg)
      .map((a) => ({ ...a, gan: a.venta - a.costo }))
      .sort((a, b) => b.gan - a.gan);

    // ---- Cómo pagan ----
    const porMedio = {};
    act.vs.forEach((v) => {
      const pagos = v.pagos || {};
      const suma = Object.values(pagos).reduce((s, x) => s + (x || 0), 0);
      Object.entries(pagos).forEach(([m, x]) => {
        porMedio[m] = (porMedio[m] || 0) + (suma ? ((x || 0) / suma) * v.total : 0);
      });
    });
    const medios = Object.entries(porMedio)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    // ---- Por vendedora ----
    const porV = {};
    act.vs.forEach((v) => {
      const a = (porV[v.usuarioNombre || '—'] = porV[v.usuarioNombre || '—'] || { t: 0, n: 0, p: 0 });
      a.t += v.total;
      a.n++;
      (v.items || []).forEach((i) => {
        a.p += i.qty;
      });
    });

    // ---- Gastos (todos los orígenes, sin los anulados; los retiros de socios aparte) ----
    const gs = gastos.filter((g) => !g.anulado && entre(g.fecha, P.desde, P.hasta));
    const porCat = {};
    let retiros = 0;
    gs.forEach((g) => {
      if (g.categoria === 'Socios') retiros += g.monto || 0;
      else porCat[g.categoria] = (porCat[g.categoria] || 0) + (g.monto || 0);
    });
    const gTot = Object.values(porCat).reduce((s, x) => s + x, 0);

    // ---- Para tener el ojo ----
    const nCambios = ventas.filter((v) => v.tipo === 'cambio' && !v.anulada && entre(v.fecha, P.desde, P.hasta)).length;
    const anuladas = ventas.filter((v) => v.anulada && entre(v.fecha, P.desde, P.hasta));
    const conDesc = act.vs.filter((v) => v.descuento > 0).length;

    const ia = armarResumenIA({
      P, hoy, act, ant, porQue, costoPorId, porId, inventario, porDia, sem, porHora, medios, porV, porCat, retiros, nCambios, anuladas, conDesc, faltas, faltaTot,
    });

    return {
      ia,
      act,
      ant,
      porQue,
      faltas,
      faltaTot,
      nEntregas: recibidas.length,
      porDia,
      mejorDia,
      sem,
      maxSem,
      minSem,
      porHora,
      pico,
      top,
      medios,
      porV,
      porCat,
      gTot,
      retiros,
      nCambios,
      anuladas,
      conDesc,
    };
  }, [ventas, inventario, gastos, entregas, P, hoy]);

  const filtros = (
    <div className="rp-filtros">
      {Object.entries(periodos(hoy)).map(([k, p]) => (
        <button key={k} className={`rp-chip ${k === periodo ? 'on' : ''}`} aria-pressed={k === periodo} onClick={() => setPeriodo(k)}>
          {p.nombre}
        </button>
      ))}
    </div>
  );

  if (error) return <div className="rp">{filtros}<p className="msg bad">{error}</p></div>;
  if (!datos) return <div className="rp">{filtros}<p className="rp-cargando">Cargando…</p></div>;

  const d = datos;
  const { act, ant } = d;
  const margen = act.total ? (act.ganancia / act.total) * 100 : 0;
  const margenAntes = ant.total ? (ant.ganancia / ant.total) * 100 : null;
  const efectivo = act.total ? ((d.medios.find(([m]) => m === 'Efectivo')?.[1] || 0) / act.total) * 100 : 0;

  return (
    <div className="rp">
      {filtros}
      <p className="rp-rango">
        Del <b>{fechaLarga(P.desde)}</b> al <b>{fechaLarga(P.hasta)}</b> · comparado con {P.ant.txt}.
      </p>

      <div className="rp-kpis">
        <Kpi label="Ventas" valor={corto(act.total)} a={act.total} b={ant.total} sub={`${act.n} ventas · antes ${corto(ant.total)}`} />
        <Kpi
          label="Ganancia bruta"
          valor={corto(act.ganancia)}
          a={act.ganancia}
          b={ant.ganancia}
          sub={`Antes ${corto(ant.ganancia)} · margen del ${margen.toFixed(0)}%${margenAntes != null ? ` (antes ${margenAntes.toFixed(0)}%)` : ''}`}
        />
        <Kpi
          label="Prendas vendidas"
          valor={act.prendas.toLocaleString('es-CO')}
          a={act.prendas}
          b={ant.prendas}
          sub={`Antes ${ant.prendas.toLocaleString('es-CO')}`}
        />
        <Kpi label="Venta promedio" valor={corto(act.ticket)} a={act.ticket} b={ant.ticket} sub={`Por cliente · antes ${corto(ant.ticket)}`} />
      </div>

      <div className="rp-porque-wrap">
        <PorQue explicacion={d.porQue} txtAntes={P.ant.txt} />
      </div>

      <div className="rp-porque-wrap">
        <PreguntaIA resumen={d.ia.resumen} nombres={d.ia.nombres} reiniciarCon={periodo} />
      </div>

      <h2 className="rp-seccion-tit">Cómo se vende</h2>
      <div className="rp-graficos">
        <Tarjeta
          ancha
          titulo="Ventas por día"
          lectura={
            d.mejorDia && d.mejorDia.valor > 0 ? (
              <>
                El mejor día del período fue el <b>{d.mejorDia.label}</b>, con <b>{fmt(d.mejorDia.valor)}</b>.
              </>
            ) : (
              'Todavía no hay ventas en este período.'
            )
          }
          tabla={{ cab: ['Día', 'Ventas'], filas: d.porDia.map((x) => [x.label, fmt(x.valor)]) }}
        >
          <Columnas datos={d.porDia} aria="Ventas por día" eje={corto} tip={(x) => fmt(x.valor)} etiquetaMax />
        </Tarjeta>

        <Tarjeta
          titulo="¿Qué día se vende más?"
          lectura={
            d.maxSem && d.minSem && d.maxSem !== d.minSem ? (
              <>
                En promedio, el <b>{d.maxSem.label}</b> se vende{' '}
                {(d.maxSem.valor / (d.minSem.valor || 1)).toLocaleString('es-CO', { maximumFractionDigits: 1 })} veces lo del <b>{d.minSem.label}</b>.
                Buen día para reforzar personal y vitrina.
              </>
            ) : (
              'Hace falta más de una semana de ventas para comparar los días.'
            )
          }
          tabla={{ cab: ['Día', 'Promedio'], filas: d.sem.map((x) => [x.label, x.n ? fmt(x.valor) : 'sin datos']) }}
        >
          <Columnas datos={d.sem} aria="Venta promedio por día de la semana" eje={corto} tip={(x) => `${fmt(x.valor)} en promedio`} modo="destacar" />
        </Tarjeta>

        <Tarjeta
          titulo="¿A qué hora se vende?"
          lectura={
            d.pico && d.pico.valor > 0 ? (
              <>
                La hora pico es de <b>{d.pico.label}</b>. Evita mandar a almorzar o hacer conteos en esa franja.
              </>
            ) : (
              'Todavía no hay ventas en este período.'
            )
          }
          tabla={{ cab: ['Hora', 'Ventas'], filas: d.porHora.map((x) => [x.label, `${x.valor} ventas`]) }}
        >
          <Columnas
            datos={d.porHora}
            aria="Ventas por hora del día"
            eje={(v) => String(Math.round(v))}
            tip={(x) => `${x.valor} ${x.valor === 1 ? 'venta' : 'ventas'}`}
            modo="destacar"
          />
        </Tarjeta>

        <Tarjeta
          titulo="Las que más ganancia dejan"
          lectura={
            d.top.length ? (
              <>
                Ordenadas por lo que te dejan, no por cuántas se venden. <b>{d.top[0].nombre}</b> es la que más aporta.
              </>
            ) : null
          }
        >
          <Barras
            filas={d.top.slice(0, 7).map((x) => ({
              nombre: x.nombre,
              sub: `${x.und} vendidas · margen ${x.venta ? Math.round((x.gan / x.venta) * 100) : 0}%`,
              valor: Math.max(0, x.gan),
              txt: corto(x.gan),
            }))}
          />
        </Tarjeta>

        <Tarjeta
          titulo="Cómo pagan"
          lectura={
            act.total ? (
              <>
                El <b>{efectivo.toFixed(0)}%</b> entra en efectivo; el resto llega a cuentas (datáfono, Nequi, Addi…).
              </>
            ) : null
          }
        >
          <Barras
            filas={d.medios.map(([m, v]) => ({ nombre: m, valor: v, txt: corto(v), txt2: `${((v / act.total) * 100).toFixed(0)}%` }))}
          />
        </Tarjeta>

        <Tarjeta
          titulo="Por vendedora"
          lectura="Lo que se vendió en el turno de cada una. Como no trabajan los mismos días, compara la venta promedio, no solo el total."
        >
          <Barras
            filas={Object.entries(d.porV)
              .sort((a, b) => b[1].t - a[1].t)
              .map(([k, a]) => ({
                nombre: k,
                sub: `${a.n} ventas · ${a.p} prendas`,
                valor: a.t,
                txt: corto(a.t),
                txt2: `promedio ${corto(a.t / a.n)}`,
              }))}
          />
        </Tarjeta>

        <Tarjeta
          titulo="En qué se va la plata"
          lectura={
            <>
              Gastos del período: <b>{corto(d.gTot)}</b>
              {act.ganancia > 0 ? `, el ${((d.gTot / act.ganancia) * 100).toFixed(0)}% de la ganancia bruta` : ''}.
              {d.retiros > 0 ? ` Aparte, retiros de socios por ${corto(d.retiros)}.` : ''}
            </>
          }
        >
          <Barras
            filas={Object.entries(d.porCat)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({ nombre: k, valor: v, txt: corto(v) }))}
          />
        </Tarjeta>

        <Tarjeta titulo="Para tener el ojo" lectura="Cosas que no son ventas pero mueven la plata.">
          <div className="rp-control">
            <div>
              <span>Descuentos dados</span>
              <b>{corto(act.desc)}</b>
              <small>
                en {d.conDesc} {d.conDesc === 1 ? 'venta' : 'ventas'}
                {act.n ? ` (${((d.conDesc / act.n) * 100).toFixed(0)}%)` : ''}
              </small>
            </div>
            <div>
              <span>Cambios</span>
              <b>{d.nCambios}</b>
              <small>{d.nCambios ? `uno cada ${Math.round(act.n / d.nCambios)} ventas` : 'ninguno'}</small>
            </div>
            <div>
              <span>Anuladas</span>
              <b>{d.anuladas.length}</b>
              <small>{corto(d.anuladas.reduce((s, v) => s + (v.total || 0), 0))}</small>
            </div>
            <div>
              <span>Faltantes en entregas</span>
              <b>{fmt(d.faltaTot)}</b>
              <small>
                {d.faltas.length} {d.faltas.length === 1 ? 'entrega' : 'entregas'}
              </small>
            </div>
          </div>
        </Tarjeta>
      </div>
    </div>
  );
}

