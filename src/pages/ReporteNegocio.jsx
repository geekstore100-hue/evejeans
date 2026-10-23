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
  suscribirComprasRango,
  suscribirEntregasRango,
} from '../lib/reportes';
import { Columnas, Barras, Tarjeta } from '../components/Graficos';

// "Cómo va el negocio" (solo Nelson): cuánto se vende y se gana contra el
// período anterior, avisos para adelantarse (lo que se va a acabar, lo que
// no se mueve, compras contra ventas, la caja) y gráficos de cómo se vende.
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

function Alerta({ clase, estado, titulo, children }) {
  return (
    <div className={`rp-alerta ${clase}`}>
      <div className="rp-alerta-top">
        <span className="rp-estado">{estado}</span>
        <h3>{titulo}</h3>
      </div>
      {children}
    </div>
  );
}

export default function ReporteNegocio() {
  const [periodo, setPeriodo] = useState('mes');
  const [hoy, setHoy] = useState(hoyStr());
  const [ventas, setVentas] = useState(null);
  const [gastos, setGastos] = useState([]);
  const [compras, setCompras] = useState([]);
  const [entregas, setEntregas] = useState([]);
  const [inventario, setInventario] = useState(null);
  const [error, setError] = useState('');

  // Si queda abierto de un día para otro, el "hoy" se corre solo.
  useEffect(() => {
    const t = setInterval(() => setHoy(hoyStr()), 60000);
    return () => clearInterval(t);
  }, []);

  const P = useMemo(() => periodos(hoy)[periodo], [hoy, periodo]);
  const desdeEscucha = [P.ant.desde, sumarDias(hoy, -29)].sort()[0];

  useEffect(() => {
    setVentas(null);
    const err = (e) => setError('No se pudo cargar: ' + e.message);
    const q1 = suscribirVentasRango(desdeEscucha, hoy, setVentas, err);
    const q2 = suscribirGastosRango(desdeEscucha, hoy, setGastos, err);
    const q3 = suscribirComprasRango(P.desde, P.hasta, setCompras, err);
    const q4 = suscribirEntregasRango(P.desde, P.hasta, setEntregas, err);
    return () => {
      q1();
      q2();
      q3();
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

    // ---- Un paso adelante: ritmo de venta de los últimos 30 días ----
    const desde30 = sumarDias(hoy, -29);
    const vel = {};
    ventas.forEach((v) => {
      if (v.tipo !== 'venta' || v.anulada || !entre(v.fecha, desde30, hoy)) return;
      (v.items || []).forEach((i) => {
        vel[i.id] = (vel[i.id] || 0) + i.qty;
      });
    });
    const visibles = inventario.filter((it) => !it.oculto);
    const seAcaban = visibles
      .map((it) => {
        const pd = (vel[it.id] || 0) / 30;
        const stock = it.stock || 0;
        return { it, pd, stock, dias: pd ? stock / pd : Infinity };
      })
      .filter((x) => x.pd > 0 && x.dias < 14)
      .sort((a, b) => a.dias - b.dias);
    const quietas = visibles
      .filter((it) => (vel[it.id] || 0) <= 2 && (it.stock || 0) >= 10)
      .map((it) => ({ it, vendidas: vel[it.id] || 0, plata: (it.stock || 0) * (it.costoCompra || 0) }))
      .sort((a, b) => b.plata - a.plata);
    const parado = quietas.reduce((s, x) => s + x.plata, 0);
    const comprasPeriodo = compras.filter((c) => entre(c.fecha, P.desde, P.hasta)).reduce((s, c) => s + (c.totalGeneral || 0), 0);
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

    return {
      act,
      ant,
      seAcaban,
      quietas,
      parado,
      comprasPeriodo,
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
  }, [ventas, inventario, gastos, compras, entregas, P, hoy]);

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
  const ratio = act.costo ? d.comprasPeriodo / act.costo : 0;
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
          sub={`Margen del ${margen.toFixed(0)}% · antes ${corto(ant.ganancia)}`}
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

      <h2 className="rp-seccion-tit">Un paso adelante</h2>
      <div className="rp-alertas">
        {d.seAcaban.length > 0 ? (
          <Alerta clase="critica" estado="⚠ Pedir ya" titulo="Se van a acabar">
            <p>Al ritmo que se vendieron en los últimos 30 días, estas referencias se acaban en menos de dos semanas.</p>
            <ul>
              {d.seAcaban.slice(0, 8).map((x) => (
                <li key={x.it.id}>
                  <span>
                    <b>{x.it.name}</b> · {x.stock === 0 ? 'ya no hay' : `quedan ${x.stock}`}
                  </span>
                  <span>
                    {x.stock === 0
                      ? `se vendían ${x.pd.toLocaleString('es-CO', { maximumFractionDigits: 1 })} al día`
                      : `se acaba en ~${Math.max(1, Math.round(x.dias))} ${Math.max(1, Math.round(x.dias)) === 1 ? 'día' : 'días'} (${x.pd.toLocaleString('es-CO', { maximumFractionDigits: 1 })} al día)`}
                  </span>
                </li>
              ))}
            </ul>
          </Alerta>
        ) : (
          <Alerta clase="info" estado="✓ Bien" titulo="Se van a acabar">
            <p>Ninguna referencia se acaba en las próximas dos semanas al ritmo de venta de los últimos 30 días.</p>
          </Alerta>
        )}

        {d.quietas.length > 0 ? (
          <Alerta clase="cuidado" estado="● Plata quieta" titulo="Mercancía que no se mueve">
            <p>
              Casi no se vendieron en 30 días y tienen <b>{corto(d.parado)}</b> invertidos (a precio de compra). Candidatas a promoción o a no
              volver a comprar.
            </p>
            <ul>
              {d.quietas.slice(0, 6).map((x) => (
                <li key={x.it.id}>
                  <span>
                    <b>{x.it.name}</b> · {x.it.stock} en stock
                  </span>
                  <span>
                    {x.vendidas === 1 ? '1 vendida' : `${x.vendidas} vendidas`} en 30 días · {corto(x.plata)}
                  </span>
                </li>
              ))}
            </ul>
          </Alerta>
        ) : (
          <Alerta clase="info" estado="✓ Bien" titulo="Mercancía que no se mueve">
            <p>No hay referencias con mucho stock quietas en los últimos 30 días.</p>
          </Alerta>
        )}

        <Alerta clase="info" estado="◆ Compras" titulo="Lo que entra contra lo que sale">
          <p>
            En este período compraste <b>{corto(d.comprasPeriodo)}</b> en mercancía y vendiste prendas que te habían costado{' '}
            <b>{corto(act.costo)}</b>.{' '}
            {!act.costo
              ? ''
              : ratio > 1.15
                ? 'Estás comprando más de lo que vendes: el inventario está creciendo.'
                : ratio < 0.85
                  ? 'Estás vendiendo más de lo que repones: el inventario está bajando.'
                  : 'Compras y ventas van parejas.'}
          </p>
        </Alerta>

        <Alerta clase={d.faltaTot ? 'cuidado' : 'info'} estado={d.faltaTot ? '● Revisar' : '✓ Bien'} titulo="Control de caja">
          <p>
            {d.faltaTot ? (
              <>
                En <b>{d.faltas.length}</b> {d.faltas.length === 1 ? 'entrega' : 'entregas'} de efectivo faltó plata: <b>{fmt(d.faltaTot)}</b> en total.
              </>
            ) : d.nEntregas ? (
              `Las ${d.nEntregas} entregas de efectivo del período cuadraron.`
            ) : (
              'Todavía no hay entregas de efectivo recibidas en este período.'
            )}
          </p>
          {d.faltas.length > 0 && (
            <ul>
              {d.faltas.slice(0, 4).map((e) => (
                <li key={e.id}>
                  <span>
                    Efectivo del {fechaLarga(e.fecha)}
                    {e.entregoNombre ? ` · ${e.entregoNombre}` : ''}
                  </span>
                  <span>faltaron {fmt(-e.difEntrega)}</span>
                </li>
              ))}
            </ul>
          )}
        </Alerta>
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

