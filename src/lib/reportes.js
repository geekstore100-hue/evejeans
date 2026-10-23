import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';

// Todo lo de la sección Reportes (solo Nelson): escuchas en vivo por rango de
// fechas, utilidades de fechas y plata, y el historial de ventas por día de
// años anteriores (el Excel que Nelson llevaba antes del sistema).

// ---------- Fechas ----------
export function fechaStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function hoyStr() {
  return fechaStr(new Date());
}
export function parseFecha(s) {
  const [a, m, d] = s.split('-').map(Number);
  return new Date(a, m - 1, d);
}
export function sumarDias(s, n) {
  const d = parseFecha(s);
  d.setDate(d.getDate() + n);
  return fechaStr(d);
}
export function diasEntre(a, b) {
  return Math.round((parseFecha(b) - parseFecha(a)) / 864e5);
}
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function fechaLarga(s) {
  const d = parseFecha(s);
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}
export function fechaConDia(s) {
  const d = parseFecha(s);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}
export function diaCorto(s) {
  const d = parseFecha(s);
  return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()}`;
}

// "02:32 p. m." -> minutos desde la medianoche (para ordenar por hora).
export function horaAMinutos(horaStr) {
  if (!horaStr) return 0;
  const m = String(horaStr).match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (/p\.?\s*m\.?/i.test(horaStr) && h !== 12) h += 12;
  if (/a\.?\s*m\.?/i.test(horaStr) && h === 12) h = 0;
  return h * 60 + min;
}

// ---------- Plata ----------
export function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}
// Corto para gráficos y tarjetas: "$1,2 M", "$450 mil".
export function corto(n) {
  const a = Math.abs(n || 0);
  if (a >= 1e6) return '$' + (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3).toLocaleString('es-CO') + ' mil';
  return fmt(n);
}

// ---------- Escuchas en vivo ----------
// Un solo campo de rango (fecha) por consulta, a propósito: así Firestore no
// pide crear índices compuestos. Los demás filtros (tipo, anulada…) se hacen
// aquí en el computador.
function suscribirRango(coleccion, campo, desde, hasta, callback, onError) {
  const q = query(collection(db, coleccion), where(campo, '>=', desde), where(campo, '<=', hasta));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    (err) => {
      console.error(`Error leyendo ${coleccion}:`, err);
      if (onError) onError(err);
    }
  );
}

// Ventas y cambios (los dos viven en "ventas", con tipo 'venta' | 'cambio').
export function suscribirVentasRango(desde, hasta, cb, onError) {
  return suscribirRango('ventas', 'fecha', desde, hasta, cb, onError);
}
export function suscribirGastosRango(desde, hasta, cb, onError) {
  return suscribirRango('gastos', 'fecha', desde, hasta, cb, onError);
}
export function suscribirComprasRango(desde, hasta, cb, onError) {
  return suscribirRango('compras', 'fecha', desde, hasta, cb, onError);
}
export function suscribirMovimientosRango(desde, hasta, cb, onError) {
  return suscribirRango('entradasSalidas', 'fecha', desde, hasta, cb, onError);
}
// Entregas de efectivo a Fausto: por la fecha en que se RECIBIÓ la plata (no
// la del día de ventas al que corresponde).
export function suscribirEntregasRango(desde, hasta, cb, onError) {
  return suscribirRango('planillas', 'recibidoFecha', desde, hasta, cb, onError);
}

// Fecha de la primera venta que se hizo en el sistema: de ahí para atrás, las
// ventas por día salen del historial (Excel); de ahí en adelante, del sistema.
export async function primeraFechaDelSistema() {
  const snap = await getDocs(query(collection(db, 'ventas'), orderBy('fecha'), limit(1)));
  return snap.empty ? null : snap.docs[0].data().fecha;
}

// ---------- Historial de años anteriores ----------
// Un documento por año: { anio, dias: { 'AAAA-MM-DD': venta }, ... }.
// Un 0 quiere decir que ese día no se vendió nada (cerrado).
export function suscribirHistoricos(callback, onError) {
  return onSnapshot(
    collection(db, 'ventasHistoricas'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    (err) => {
      console.error('Error leyendo ventas de años anteriores:', err);
      if (onError) onError(err);
    }
  );
}

export async function guardarHistorico(anio, dias, usuario) {
  await setDoc(doc(db, 'ventasHistoricas', String(anio)), {
    anio,
    dias,
    cargadoPorId: usuario.id,
    cargadoPorNombre: usuario.nombreDefault,
    cargadoEn: serverTimestamp(),
  });
}

// Lee lo que se copia del Excel y se pega en la app. Acepta el formato que
// Nelson ya usa:
//
//      $ 2.025            <- el año, solo en su renglón
//   1-ene.   $ -          <- "$ -" = no se vendió nada
//   2-ene.   $ 585.000
//
// y también fechas completas ("2/01/2025", "2025-01-02") por si acaso. Las
// fechas que no existen (ej. 29 de febrero en un año que no es bisiesto) se
// ignoran y se avisan.
const MES_ABREV = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11 };

function valorPesos(txt) {
  const t = String(txt || '').replace(/\s/g, '');
  if (!t || /^\$?-+$/.test(t)) return 0;
  const digitos = t.replace(/[^\d]/g, '');
  return digitos ? parseInt(digitos, 10) : null;
}
function fechaValida(anio, mes, dia) {
  const d = new Date(anio, mes, dia);
  return d.getFullYear() === anio && d.getMonth() === mes && d.getDate() === dia ? fechaStr(d) : null;
}

export function parsearExcelPegado(texto) {
  const anios = {}; // { 2025: { '2025-01-02': 585000 } }
  const avisos = [];
  let anioActual = null;
  let sinAnio = 0;
  const lineas = String(texto || '').split(/\r?\n/);

  lineas.forEach((linea, idx) => {
    const l = linea.replace(/ /g, ' ').trim();
    if (!l) return;

    // Renglón con solo el año: "$ 2.025", "2025", "Año 2025".
    const soloAnio = l.match(/^(?:a[ñn]o\s*)?\$?\s*(2\.?0\d\d)\s*$/i);
    if (soloAnio) {
      anioActual = parseInt(soloAnio[1].replace('.', ''), 10);
      anios[anioActual] = anios[anioActual] || {};
      return;
    }

    let fecha = null;
    let resto = '';
    let m;
    if ((m = l.match(/^(\d{1,2})\s*[-/ ]\s*([a-záéíóú]{3})[a-záéíóú]*\.?\s*(.*)$/i))) {
      const mes = MES_ABREV[m[2].toLowerCase().slice(0, 3)];
      if (mes === undefined) return;
      if (!anioActual) {
        sinAnio++;
        return;
      }
      fecha = fechaValida(anioActual, mes, parseInt(m[1], 10));
      resto = m[3];
      if (!fecha) {
        avisos.push(`El ${m[1]} de ${MESES[mes]} no existe en ${anioActual}: se ignoró ese renglón.`);
        return;
      }
    } else if ((m = l.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(.*)$/))) {
      fecha = fechaValida(+m[1], +m[2] - 1, +m[3]);
      resto = m[4];
    } else if ((m = l.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(.*)$/))) {
      const a = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      fecha = fechaValida(a, +m[2] - 1, +m[1]);
      resto = m[4];
    } else {
      return; // títulos, totales u otras cosas que no son un día
    }
    if (!fecha) {
      avisos.push(`El renglón ${idx + 1} tiene una fecha que no existe: se ignoró.`);
      return;
    }
    const valor = valorPesos(resto.split('\t').filter((x) => x.trim())[0] ?? resto);
    if (valor === null) {
      avisos.push(`No se entendió el valor del ${fechaLarga(fecha)} de ${fecha.slice(0, 4)}: se ignoró.`);
      return;
    }
    const anio = parseInt(fecha.slice(0, 4), 10);
    anios[anio] = anios[anio] || {};
    anios[anio][fecha] = valor;
  });

  if (sinAnio) avisos.unshift(`${sinAnio === 1 ? 'Hay 1 día' : `Hay ${sinAnio} días`} sin año arriba. Copia también el renglón del año (por ejemplo "$ 2.025").`);
  Object.keys(anios).forEach((a) => {
    if (!Object.keys(anios[a]).length) delete anios[a];
  });
  return { anios, avisos };
}

// Ventas por día, juntando el historial (antes del sistema) con lo que ya
// registró el sistema. ventas: documentos de "ventas" desde ventasDesde.
// Hoy no se incluye (el día todavía no termina).
export function ventasPorDia(historicos, ventas, primeraFecha, ventasDesde) {
  const dias = {};
  historicos.forEach((h) => {
    Object.entries(h.dias || {}).forEach(([f, v]) => {
      if (typeof v === 'number') dias[f] = v;
    });
  });
  if (!primeraFecha) return dias;
  const sistema = {};
  ventas.forEach((v) => {
    if (v.tipo !== 'venta' || v.anulada) return;
    sistema[v.fecha] = (sistema[v.fecha] || 0) + (v.total || 0);
  });
  const hoy = hoyStr();
  const inicio = ventasDesde && ventasDesde > primeraFecha ? ventasDesde : primeraFecha;
  for (let f = inicio; f < hoy; f = sumarDias(f, 1)) {
    const s = sistema[f] || 0;
    // El primer día del sistema pudo empezar a mitad de día: si el Excel ya
    // tenía ese día completo, se queda el mayor de los dos.
    dias[f] = f === primeraFecha && dias[f] != null ? Math.max(dias[f], s) : s;
  }
  return dias;
}
