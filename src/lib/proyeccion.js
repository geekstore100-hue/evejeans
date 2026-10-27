import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { fechaStr, parseFecha, sumarDias, MESES } from './reportes';

// Proyección de ventas y de compras por referencia, para que la IA pueda
// responder cosas como "¿cuántas Sef debo tener compradas para el 1 de
// diciembre?". Se calcula aquí (no la IA) para que las cuentas sean exactas:
//
// 1. Cuánto se va a vender cada día de aquí a fin del mes que viene + uno:
//    lo que se vendió ese mismo día el año pasado (historial del Excel o del
//    sistema) × cuánto ha crecido o bajado la tienda (últimas 4 semanas contra
//    las mismas 4 semanas de hace un año).
// 2. De esa plata, cuánto le toca a cada referencia: su parte de la venta en
//    los últimos 60 días, dividido por su precio promedio = prendas.
// 3. Contra el stock de hoy más lo que viene en facturas sin recibir: cuándo
//    se acabaría y cuántas faltan para cubrir cada mes.

const DIAS_MEZCLA = 60;

function totalesPorDia(historicos, ventas) {
  const dias = {};
  historicos.forEach((h) =>
    Object.entries(h.dias || {}).forEach(([f, v]) => {
      if (typeof v === 'number') dias[f] = v;
    })
  );
  const sistema = {};
  ventas.forEach((v) => {
    if (v.tipo !== 'venta' || v.anulada) return;
    sistema[v.fecha] = (sistema[v.fecha] || 0) + (v.total || 0);
  });
  Object.entries(sistema).forEach(([f, v]) => {
    dias[f] = dias[f] != null ? Math.max(dias[f], v) : v;
  });
  return dias;
}

const MESES_ADELANTE = 5; // de este mes hasta 5 meses después (ej. octubre → marzo)
const ANIOS_ATRAS = 3;

function haceAnios(fecha, y) {
  const d = parseFecha(fecha);
  const x = new Date(d.getFullYear() - y, d.getMonth(), d.getDate());
  // 29 de febrero -> 28
  return x.getMonth() === d.getMonth() ? fechaStr(x) : fechaStr(new Date(d.getFullYear() - y, d.getMonth() + 1, 0));
}
const haceUnAnio = (f) => haceAnios(f, 1);

export function calcularProyeccion({ historicos, ventasRecientes, ventasAnioPasado, inventario, pendientes, hoy, mesesAdelante = MESES_ADELANTE }) {
  const dias = totalesPorDia(historicos, [...ventasRecientes, ...ventasAnioPasado]);

  // ---- Crecimiento: últimas 4 semanas contra las mismas de hace 1, 2 y 3
  // años (364 días por año: mismo día de la semana). Si a un día del año
  // pasado le falta el dato, se usa el de hace 2 años con su propio crecimiento.
  function crecimientoContra(y) {
    let reciente = 0;
    let antes = 0;
    let conDato = 0;
    for (let i = 1; i <= 28; i++) {
      const f = sumarDias(hoy, -i);
      const g = sumarDias(f, -364 * y);
      if (dias[f] != null && dias[g] != null) {
        reciente += dias[f];
        antes += dias[g];
        conDato++;
      }
    }
    return conDato >= 20 && antes > 0 ? reciente / antes : null;
  }
  const crecimientos = {};
  for (let y = 1; y <= ANIOS_ATRAS; y++) crecimientos[y] = crecimientoContra(y);
  const crecimiento = crecimientos[1];

  // ---- Mezcla: qué parte de la venta se lleva cada referencia (últimos 60 días) ----
  const desdeMezcla = sumarDias(hoy, -DIAS_MEZCLA);
  const refs = {};
  let totalMezcla = 0;
  ventasRecientes.forEach((v) => {
    if (v.tipo !== 'venta' || v.anulada || v.fecha < desdeMezcla || v.fecha >= hoy) return;
    (v.items || []).forEach((i) => {
      const r = (refs[i.id] = refs[i.id] || { id: i.id, nombre: i.name, u: 0, plata: 0 });
      r.u += i.qty;
      r.plata += (i.price || 0) * i.qty;
      totalMezcla += (i.price || 0) * i.qty;
    });
  });
  const porId = {};
  inventario.forEach((it) => {
    porId[it.id] = it;
    if (!it.oculto && (it.stock || 0) > 0 && !refs[it.id]) refs[it.id] = { id: it.id, nombre: it.name, u: 0, plata: 0 };
  });
  const enCamino = {};
  pendientes.forEach((c) =>
    (c.items || []).forEach((i) => {
      enCamino[i.id] = (enCamino[i.id] || 0) + (i.cantidadPedida || 0);
    })
  );

  // ---- Venta esperada día por día hasta el fin del último mes ----
  const h = parseFecha(hoy);
  const finPeriodo = fechaStr(new Date(h.getFullYear(), h.getMonth() + mesesAdelante + 1, 0));
  const meses = [];
  const mesDe = (f) => f.slice(0, 7);
  const diasFuturos = [];
  for (let f = hoy; f <= finPeriodo; f = sumarDias(f, 1)) {
    let esperado = null;
    let base = null;
    for (let y = 1; y <= ANIOS_ATRAS && esperado == null; y++) {
      const ref = dias[haceAnios(f, y)];
      if (ref != null) {
        esperado = ref * (crecimientos[y] || 1);
        base = y;
      }
    }
    diasFuturos.push({ fecha: f, esperado, base });
  }
  // Días sin dato del año pasado: el promedio de los días con dato de ese mes.
  const promMes = {};
  diasFuturos.forEach((d) => {
    if (d.esperado == null) return;
    const m = (promMes[mesDe(d.fecha)] = promMes[mesDe(d.fecha)] || { s: 0, n: 0 });
    m.s += d.esperado;
    m.n++;
  });
  diasFuturos.forEach((d) => {
    if (d.esperado == null) d.esperado = promMes[mesDe(d.fecha)] ? promMes[mesDe(d.fecha)].s / promMes[mesDe(d.fecha)].n : 0;
  });
  diasFuturos.forEach((d) => {
    let m = meses.find((x) => x.clave === mesDe(d.fecha));
    if (!m) {
      const p = parseFecha(d.fecha);
      m = { clave: mesDe(d.fecha), mes: `${MESES[p.getMonth()]} ${p.getFullYear()}`, desde: d.fecha, hasta: d.fecha, venta_esperada: 0, venta_mismos_dias_anio_pasado: 0, bases: {} };
      meses.push(m);
    }
    m.hasta = d.fecha;
    m.venta_esperada += d.esperado;
    m.venta_mismos_dias_anio_pasado += dias[haceUnAnio(d.fecha)] || 0;
    const b = d.base ? `hace ${d.base} ${d.base === 1 ? 'año' : 'años'}` : 'sin dato (promedio del mes)';
    m.bases[b] = (m.bases[b] || 0) + 1;
  });

  // ---- Por referencia ----
  const referencias = Object.values(refs)
    .map((r) => {
      const parte = totalMezcla ? r.plata / totalMezcla : 0;
      const precio = r.u ? r.plata / r.u : porId[r.id]?.price || 0;
      const stock = porId[r.id]?.stock || 0;
      const camino = enCamino[r.id] || 0;
      let acumulado = 0;
      let seAcaba = null;
      const porMes = {};
      diasFuturos.forEach((d) => {
        const u = precio ? (d.esperado * parte) / precio : 0;
        acumulado += u;
        porMes[mesDe(d.fecha)] = (porMes[mesDe(d.fecha)] || 0) + u;
        if (!seAcaba && acumulado > stock + camino) seAcaba = d.fecha;
      });
      let acum = 0;
      const meses_ = meses.map((m) => {
        acum += porMes[m.clave] || 0;
        return {
          mes: m.mes,
          prendas_esperadas: Math.round(porMes[m.clave] || 0),
          faltan_comprar_para_cubrir_hasta_fin_de_mes: Math.max(0, Math.round(acum - stock - camino)),
          quedarian_al_final_del_mes_sin_comprar_mas: Math.max(0, Math.round(stock + camino - acum)),
        };
      });
      return {
        referencia: porId[r.id]?.name || r.nombre,
        parte_de_la_venta_pct: Math.round(parte * 1000) / 10,
        vendidas_ultimos_60_dias: Math.round(r.u),
        precio_promedio: Math.round(precio),
        costo_de_compra_hoy: Math.round(porId[r.id]?.costoCompra || 0),
        stock_hoy: stock,
        en_facturas_sin_recibir: camino,
        alcanzaria_hasta: seAcaba || `más allá del ${finPeriodo}`,
        por_mes: meses_,
      };
    })
    .filter((r) => r.vendidas_ultimos_60_dias || r.stock_hoy)
    .sort((a, b) => b.parte_de_la_venta_pct - a.parte_de_la_venta_pct);

  return {
    como_se_calculo:
      'Venta esperada de cada día = lo que se vendió el mismo día del año pasado × el crecimiento de la tienda desde entonces. ' +
      'Si falta el dato del año pasado (por ejemplo enero a julio de 2026, que no está cargado), se usa el de hace 2 años × el crecimiento desde hace 2 años; ' +
      '"calculado_con" dice cuántos días de cada mes salieron de cada año. Lo calculado con datos de hace 2 años es menos seguro. ' +
      `A cada referencia le toca su parte de la venta de los últimos ${DIAS_MEZCLA} días, al precio promedio al que se vendió. ` +
      'Supone que en estas fechas se vende la misma mezcla de referencias que en los últimos 60 días (en temporada puede cambiar). ' +
      '"faltan_comprar_para_cubrir_hasta_fin_de_mes" ya descuenta el stock de hoy y lo que viene en facturas sin recibir.',
    hoy,
    crecimiento_vs_anio_pasado_pct: crecimiento ? Math.round((crecimiento - 1) * 100) : null,
    crecimiento_vs_hace_2_anios_pct: crecimientos[2] ? Math.round((crecimientos[2] - 1) * 100) : null,
    nota_crecimiento: crecimiento ? null : 'No hay datos suficientes del año pasado para estas semanas; se supuso que la tienda vende igual que hace un año.',
    meses: meses.map((m) => ({
      mes: m.mes,
      desde: m.desde,
      hasta: m.hasta,
      venta_esperada: Math.round(m.venta_esperada),
      venta_mismos_dias_anio_pasado: Math.round(m.venta_mismos_dias_anio_pasado),
      calculado_con: Object.entries(m.bases).map(([k, n]) => `${n} días con datos de ${k}`).join(', '),
    })),
    referencias,
  };
}

async function leer(q) {
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Lee lo necesario (una sola vez, al hacer la primera pregunta) y calcula.
export async function cargarProyeccion(hoy) {
  // Del sistema, el año pasado por estas fechas (cuando ya haya un año de
  // sistema): desde 4 semanas antes de hoy hasta el final de la proyección.
  const finAnioPasado = sumarDias(hoy, -365 + 31 * (MESES_ADELANTE + 1));
  const [historicos, ventasRecientes, ventasAnioPasado, inventario, pendientes] = await Promise.all([
    leer(collection(db, 'ventasHistoricas')),
    leer(query(collection(db, 'ventas'), where('fecha', '>=', sumarDias(hoy, -DIAS_MEZCLA)), where('fecha', '<=', hoy))),
    leer(query(collection(db, 'ventas'), where('fecha', '>=', sumarDias(hoy, -400)), where('fecha', '<=', finAnioPasado))),
    leer(collection(db, 'inventario')),
    leer(query(collection(db, 'compras'), where('estado', '==', 'pendiente'))),
  ]);
  return calcularProyeccion({ historicos, ventasRecientes, ventasAnioPasado, inventario, pendientes, hoy });
}
