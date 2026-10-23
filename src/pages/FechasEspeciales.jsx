import { useEffect, useMemo, useState } from 'react';
import {
  hoyStr,
  sumarDias,
  parseFecha,
  fechaStr,
  fechaLarga,
  fechaConDia,
  diaCorto,
  diasEntre,
  DIAS,
  MESES,
  fmt,
  corto,
  suscribirVentasRango,
  suscribirHistoricos,
  guardarHistorico,
  parsearExcelPegado,
  primeraFechaDelSistema,
  ventasPorDia,
} from '../lib/reportes';
import { Columnas } from '../components/Graficos';

// Fechas especiales (solo Nelson): mira cuánto se vendió cada día alrededor
// de cada fecha fuerte en años anteriores, cuántas veces fue eso un día
// normal, y ubica esos mismos días en el calendario de este año — para saber
// qué días llamar a otra vendedora a hacer turno.
//
// Las ventas por día de antes del sistema salen del Excel que Nelson llevaba
// (se pega una sola vez en "Cargar años anteriores"); de ahí en adelante, del
// sistema mismo.

function nSemana(anio, mes, dow, n) {
  const d = new Date(anio, mes, 1);
  const off = (dow - d.getDay() + 7) % 7;
  return new Date(anio, mes, 1 + off + (n - 1) * 7);
}

// dia(anio): el día "centro" de la fecha. desde/hasta: los días de la
// temporada, contados desde ese centro.
const FECHAS = [
  { id: 'mujer', nombre: 'Día de la Mujer', regla: '8 de marzo', dia: (a) => new Date(a, 2, 8), desde: -7, hasta: 0 },
  { id: 'madre', nombre: 'Día de la Madre', regla: '2.º domingo de mayo', dia: (a) => nSemana(a, 4, 0, 2), desde: -10, hasta: 0 },
  {
    id: 'primaJunio',
    nombre: 'Prima de mitad de año',
    regla: 'se paga a más tardar el 30 de junio',
    dia: (a) => new Date(a, 5, 30),
    desde: -10,
    hasta: 7,
  },
  { id: 'amor', nombre: 'Amor y Amistad', regla: '3.er sábado de septiembre', dia: (a) => nSemana(a, 8, 6, 3), desde: -9, hasta: 0 },
  {
    id: 'black',
    nombre: 'Black Friday',
    regla: 'viernes después del 4.º jueves de noviembre',
    dia: (a) => {
      const d = nSemana(a, 10, 4, 4);
      d.setDate(d.getDate() + 1);
      return d;
    },
    desde: -3,
    hasta: 3,
  },
  {
    id: 'navidad',
    nombre: 'Navidad, prima de diciembre y Año Nuevo',
    regla: 'todo diciembre · la prima se paga antes del 20',
    dia: (a) => new Date(a, 11, 24),
    desde: -23,
    hasta: 7,
  },
];

function inicioTemp(fe, anio) {
  return sumarDias(fechaStr(fe.dia(anio)), fe.desde);
}
function finTemp(fe, anio) {
  return sumarDias(fechaStr(fe.dia(anio)), fe.hasta);
}
function prom(lista) {
  return lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : null;
}
function nivel(v) {
  if (v == null) return '';
  if (v === 0) return 'cerrado';
  return v >= 2 ? 'fuerte' : v >= 1.5 ? 'movido' : '';
}
function veces(v) {
  return '×' + v.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function analizar(dias, hoy) {
  // Días que caen dentro de alguna temporada: no cuentan como "día normal".
  const temporada = new Set();
  const anioHoy = parseFecha(hoy).getFullYear();
  for (let a = anioHoy - 6; a <= anioHoy + 1; a++) {
    FECHAS.forEach((fe) => {
      for (let s = inicioTemp(fe, a); s <= finTemp(fe, a); s = sumarDias(s, 1)) temporada.add(s);
    });
  }
  // Un "día normal": el mismo día de la semana, en las 4 semanas antes de
  // `antesDe`, sin días de temporada ni días cerrados.
  function normalDe(dow, antesDe) {
    const vals = [];
    for (let s = sumarDias(antesDe, -28); s < antesDe; s = sumarDias(s, 1)) {
      if (parseFecha(s).getDay() === dow && !temporada.has(s) && dias[s] > 0) vals.push(dias[s]);
    }
    return prom(vals);
  }
  function promedioDe(desde, hasta) {
    const vals = [];
    for (let s = desde; s <= hasta; s = sumarDias(s, 1)) if (!temporada.has(s) && dias[s] > 0) vals.push(dias[s]);
    return vals.length >= 8 ? prom(vals) : null;
  }

  // Cuánto ha crecido la tienda: las últimas 4 semanas contra las mismas 4
  // semanas de hace un año (364 días, para que caigan en el mismo día de la semana).
  const reciente = promedioDe(sumarDias(hoy, -28), sumarDias(hoy, -1));
  const haceUnAnio = promedioDe(sumarDias(hoy, -28 - 364), sumarDias(hoy, -1 - 364));
  const crecimiento = reciente && haceUnAnio ? reciente / haceUnAnio : null;

  const lista = FECHAS.map((fe) => {
    const anio = finTemp(fe, anioHoy) >= hoy ? anioHoy : anioHoy + 1;
    const centro = fechaStr(fe.dia(anio));
    // Años anteriores con la temporada completa y datos para comparar.
    const anios = [];
    for (let a = anio - 1; a >= anio - 6 && anios.length < 3; a--) {
      const ini = inicioTemp(fe, a);
      const fin = finTemp(fe, a);
      if (fin >= hoy) continue;
      let conDato = 0;
      let total = 0;
      for (let s = ini; s <= fin; s = sumarDias(s, 1)) {
        total++;
        if (dias[s] != null) conDato++;
      }
      if (conDato >= total * 0.7 && normalDe(parseFecha(ini).getDay(), ini) != null) anios.unshift(a);
    }
    const ultimo = anios[anios.length - 1];
    const filas = [];
    for (let o = fe.desde; o <= fe.hasta; o++) {
      const fecha = sumarDias(centro, o);
      const dow = parseFecha(fecha).getDay();
      const porAnio = anios.map((a) => {
        const f = sumarDias(fechaStr(fe.dia(a)), o);
        const n = normalDe(parseFecha(f).getDay(), inicioTemp(fe, a));
        const v = dias[f];
        return { anio: a, fecha: f, venta: v, veces: n && v != null ? v / n : null };
      });
      const conVeces = porAnio.filter((x) => x.veces != null);
      const vProm = conVeces.length ? prom(conVeces.map((x) => x.veces)) : null;
      // Lo que se espera este año: un día normal (el mismo día de la semana,
      // antes de la temporada del último año), ajustado por cuánto ha crecido
      // la tienda, por las veces que se vendió en años anteriores.
      let base = null;
      if (ultimo) {
        const n = normalDe(dow, inicioTemp(fe, ultimo));
        if (n) base = n * (crecimiento || 1);
      }
      if (!base) base = normalDe(dow, hoy);
      filas.push({ o, fecha, porAnio, veces: vProm, esperado: base && vProm != null ? base * vProm : null });
    }
    return { fe, anio, centro, anios, filas };
  });
  lista.sort((a, b) => (a.centro < b.centro ? -1 : 1));
  return { lista, crecimiento };
}

function rangosFuertes(filas) {
  const r = [];
  let act = null;
  filas.forEach((x) => {
    if (x.veces != null && x.veces >= 2) {
      if (act && sumarDias(act.hasta, 1) === x.fecha) act.hasta = x.fecha;
      else {
        act = { desde: x.fecha, hasta: x.fecha };
        r.push(act);
      }
    } else act = null;
  });
  return r.map((x) => (x.desde === x.hasta ? diaCorto(x.desde) : `${diaCorto(x.desde)} a ${diaCorto(x.hasta)}`));
}

// ---------- Cargar años anteriores (pegar desde Excel) ----------
function CargarAnios({ usuario, historicos }) {
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);
  const leido = useMemo(() => (texto.trim() ? parsearExcelPegado(texto) : null), [texto]);
  const anios = leido ? Object.keys(leido.anios).sort() : [];
  const yaEstan = new Set(historicos.map((h) => String(h.anio)));

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    try {
      for (const a of anios) await guardarHistorico(Number(a), leido.anios[a], usuario);
      setMsg({ ok: true, t: `Listo: ${anios.length === 1 ? `quedó guardado ${anios[0]}` : `quedaron guardados ${anios.join(' y ')}`}.` });
      setTexto('');
    } catch (e) {
      setMsg({ ok: false, t: 'No se pudo guardar: ' + e.message });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rp-cargar">
      <p>
        En tu Excel, selecciona las dos columnas (la fecha y la venta del día), <b>con el renglón del año arriba</b> (por ejemplo{' '}
        <code>$ 2.025</code>), cópialas y pégalas aquí. Puedes pegar varios años seguidos.
      </p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={7}
        placeholder={'$ 2.025\n1-ene.   $ -\n2-ene.   $ 585.000\n3-ene.   $ 712.000\n…'}
        aria-label="Ventas por día copiadas del Excel"
        spellCheck={false}
      />
      {leido && (
        <div className="rp-cargar-vista">
          {anios.length === 0 && <p className="msg bad">No se encontró ningún día. Revisa que hayas copiado también el renglón del año.</p>}
          {anios.map((a) => {
            const d = leido.anios[a];
            const vals = Object.values(d);
            const cerrados = vals.filter((v) => v === 0).length;
            return (
              <div key={a} className="rp-cargar-anio">
                <b>{a}</b>
                <span>
                  {vals.length} {vals.length === 1 ? 'día' : 'días'} · {fmt(vals.reduce((s, v) => s + v, 0))} en total
                  {cerrados ? ` · ${cerrados} ${cerrados === 1 ? 'día' : 'días'} sin venta` : ''}
                </span>
                {yaEstan.has(a) && <em>reemplaza lo que ya estaba cargado de {a}</em>}
              </div>
            );
          })}
          {leido.avisos.length > 0 && (
            <ul className="rp-cargar-avisos">
              {leido.avisos.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          {anios.length > 0 && (
            <button className="rp-btn" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : `Guardar ${anios.join(' y ')}`}
            </button>
          )}
        </div>
      )}
      {msg && <p className={`msg ${msg.ok ? 'good' : 'bad'}`}>{msg.t}</p>}
    </div>
  );
}

export default function FechasEspeciales({ usuario }) {
  const [hoy, setHoy] = useState(hoyStr());
  const [historicos, setHistoricos] = useState(null);
  const [primera, setPrimera] = useState(undefined); // undefined = cargando, null = el sistema no tiene ventas
  const [ventas, setVentas] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [verCargar, setVerCargar] = useState(false);
  const esNelson = usuario?.id === 'nelson';
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setInterval(() => setHoy(hoyStr()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => suscribirHistoricos(setHistoricos, (e) => setError('No se pudo cargar: ' + e.message)), []);
  useEffect(() => {
    primeraFechaDelSistema()
      .then(setPrimera)
      .catch((e) => setError('No se pudo cargar: ' + e.message));
  }, []);

  // Del sistema solo hace falta algo más de un año hacia atrás: lo de antes
  // sale del historial.
  const ventasDesde = primera ? [primera, sumarDias(hoy, -400)].sort()[1] : null;
  useEffect(() => {
    if (primera === undefined) return;
    if (!primera) {
      setVentas([]);
      return;
    }
    return suscribirVentasRango(ventasDesde, hoy, setVentas, (e) => setError('No se pudo cargar: ' + e.message));
  }, [primera, ventasDesde, hoy]);

  const resultado = useMemo(() => {
    if (!historicos || !ventas) return null;
    const dias = ventasPorDia(historicos, ventas, primera, ventasDesde);
    return analizar(dias, hoy);
  }, [historicos, ventas, primera, ventasDesde, hoy]);

  if (error) return <div className="rp"><p className="msg bad">{error}</p></div>;
  if (!resultado) return <div className="rp"><p className="rp-cargando">Cargando…</p></div>;

  const { lista, crecimiento } = resultado;
  const hayDatos = lista.some((x) => x.anios.length > 0);
  const abiertaId = abierta === null ? lista[0]?.fe.id : abierta;
  const aniosCargados = [...historicos].sort((a, b) => a.anio - b.anio);

  return (
    <div className="rp">
      <div className="rp-fuente">
        <div>
          <b>Así se calcula:</b> para cada fecha se mira cuánto se vendió cada día alrededor de ella en años anteriores, y cuántas veces fue eso
          un día normal (el mismo día de la semana, en las 4 semanas antes de la temporada). Con eso se ubican los mismos días en el calendario de
          este año.
          {crecimiento && (
            <>
              {' '}
              Lo esperado se ajusta a cómo va la tienda hoy:{' '}
              <b>
                vende un {Math.abs((crecimiento - 1) * 100).toFixed(0)}% {crecimiento >= 1 ? 'más' : 'menos'}
              </b>{' '}
              que hace un año.
            </>
          )}
          <div className="rp-fuente-anios">
            {aniosCargados.length
              ? `Años cargados del Excel: ${aniosCargados.map((h) => h.anio).join(', ')}.`
              : 'Todavía no hay años anteriores cargados.'}
            {primera ? ` Del ${fechaLarga(primera)} de ${primera.slice(0, 4)} en adelante, las ventas salen del sistema.` : ''}
          </div>
        </div>
        {/* Cargar el Excel es solo de Nelson (Fausto ve la pantalla, pero no carga). */}
        {esNelson && (
          <button className="rp-btn sec" onClick={() => setVerCargar((v) => !v)} aria-expanded={verCargar || !hayDatos}>
            {verCargar ? 'Cerrar' : 'Cargar años anteriores (Excel)'}
          </button>
        )}
      </div>

      {esNelson && (verCargar || !hayDatos) && <CargarAnios usuario={usuario} historicos={historicos} />}

      <div className="rp-leyenda">
        <span>
          <i className="fuerte" />
          Fuerte: el doble o más de un día normal · llamar refuerzo
        </span>
        <span>
          <i className="movido" />
          Movido: entre 1,5 y 2 veces
        </span>
        <span>
          <i />
          Normal
        </span>
      </div>

      {lista.map((an, idx) => {
        const { fe } = an;
        const esAbierta = abiertaId === fe.id;
        const faltan = diasEntre(hoy, an.centro);
        const empezo = inicioTemp(fe, an.anio) <= hoy;
        const fuertes = rangosFuertes(an.filas);
        const conEsperado = an.filas.filter((x) => x.esperado != null);
        const totTemp = conEsperado.reduce((s, x) => s + x.esperado, 0);
        const ult = an.anios[an.anios.length - 1];
        const tempAnt = an.filas.reduce((s, x) => {
          const p = x.porAnio.find((y) => y.anio === ult);
          return s + (p && p.venta ? p.venta : 0);
        }, 0);
        const dCentro = parseFecha(an.centro);
        return (
          <section key={fe.id} className={`rp-fecha ${idx === 0 ? 'proxima' : ''}`}>
            <button className="rp-fecha-top" onClick={() => setAbierta(esAbierta ? '' : fe.id)} aria-expanded={esAbierta}>
              <span className="rp-fecha-cuando">
                {idx === 0 && <em>La próxima</em>}
                <b>{dCentro.getDate()}</b>
                {MESES[dCentro.getMonth()].slice(0, 3)}
              </span>
              <span className="rp-fecha-info">
                <span className="rp-fecha-nombre">
                  {fe.nombre}
                  <span className="rp-flecha">›</span>
                </span>
                <span className="rp-fecha-sub">
                  {DIAS[dCentro.getDay()]} {fechaLarga(an.centro)} de {an.anio} · {fe.regla} ·{' '}
                  {faltan === 0 ? 'es hoy' : empezo && faltan > 0 ? `ya empezó la temporada, faltan ${faltan} días` : faltan > 0 ? `faltan ${faltan} días` : 'ya pasó el día, sigue la temporada'}
                </span>
                <span className="rp-fecha-refuerzo">
                  {!an.anios.length ? (
                    'Sin datos de años anteriores para esta fecha'
                  ) : fuertes.length ? (
                    <>
                      Llamar refuerzo: <b>{fuertes.join(', ')}</b>
                    </>
                  ) : (
                    'Sin días fuertes; con el personal de siempre alcanza'
                  )}
                </span>
              </span>
              {an.anios.length > 0 && (
                <span className="rp-fecha-plata">
                  <b>{totTemp ? corto(totTemp) : '—'}</b>
                  <small>
                    esperado en la temporada · en {ult} fueron {corto(tempAnt)}
                  </small>
                </span>
              )}
            </button>

            {esAbierta && an.anios.length > 0 && (
              <div className="rp-fecha-detalle">
                <p className="rp-lectura">
                  Cada barra es un día de la temporada de {an.anio}, con las veces que se vendió un día normal en{' '}
                  {an.anios.length === 1 ? an.anios[0] : `años anteriores (promedio de ${an.anios.join(', ').replace(/, (\d+)$/, ' y $1')})`}. La
                  línea oscura marca un día normal.
                </p>
                <Columnas
                  datos={an.filas.map((x) => ({
                    label: fechaConDia(x.fecha),
                    corto: diaCorto(x.fecha),
                    valor: x.veces || 0,
                    nivel: nivel(x.veces),
                    x,
                  }))}
                  aria={`Veces un día normal, ${fe.nombre}`}
                  eje={(v) => '×' + v.toLocaleString('es-CO', { maximumFractionDigits: 1 })}
                  tip={(d) =>
                    d.x.veces == null
                      ? 'sin datos'
                      : d.x.veces === 0
                        ? 'cerrado en años anteriores'
                        : `${veces(d.x.veces)} un día normal${d.x.esperado ? ` · se esperan ${corto(d.x.esperado)}` : ''}`
                  }
                  modo="niveles"
                  linea={1}
                  alto={200}
                />
                <TablaDias an={an} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TablaDias({ an }) {
  const dest = an.filas.filter((x) => ['fuerte', 'movido', 'cerrado'].includes(nivel(x.veces)));
  if (!dest.length) return <p className="rp-lectura">Ningún día de esta temporada llegó a 1,5 veces un día normal.</p>;
  const etiqueta = { fuerte: 'Fuerte', movido: 'Movido', cerrado: 'Cerrado' };
  return (
    <div className="rp-tabla-wrap">
      <table className="rp-diario rp-fechas-tabla">
        <thead>
          <tr>
            <th>{an.anio}</th>
            {an.anios.map((a) => (
              <th key={a}>En {a}</th>
            ))}
            <th className="num">Veces normal</th>
            <th className="num">Se espera</th>
          </tr>
        </thead>
        <tbody>
          {dest.map((x) => (
            <tr key={x.fecha}>
              <td>
                <span className={`rp-pildora ${nivel(x.veces)}`}>{etiqueta[nivel(x.veces)]}</span> <b>{fechaConDia(x.fecha)}</b>
              </td>
              {x.porAnio.map((p) => (
                <td key={p.anio}>
                  {diaCorto(p.fecha)} de {MESES[parseFecha(p.fecha).getMonth()]}
                  <br />
                  <small>
                    {p.venta == null ? 'sin dato' : p.venta === 0 ? 'cerrado' : corto(p.venta)} · {p.veces ? veces(p.veces) : '—'}
                  </small>
                </td>
              ))}
              <td className="num">
                <b>{x.veces ? veces(x.veces) : '—'}</b>
              </td>
              <td className="num">{x.esperado ? corto(x.esperado) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
