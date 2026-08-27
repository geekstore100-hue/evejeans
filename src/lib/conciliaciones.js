import { collection, doc, setDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// ---------- CONFIGURACIÓN ----------
// Pega aquí la URL del Apps Script (appsscript/subir-extracto.js) una vez lo
// despliegues, y el mismo TOKEN_SUBIDA que pusiste allá. Mientras esto no esté
// lleno, la conciliación sigue funcionando igual — solo no se podrá adjuntar
// el PDF (se guarda el número que escribas, sin el archivo).
const URL_SUBIDA_EXTRACTO = 'https://script.google.com/macros/s/AKfycbzzSbDw6eanxG0WblR3WcLTmghiVuf6raw9D7zTsiUDM89FoMeejdUITJ9rwkwXWss3nA/exec'; // <-- pega aquí la URL que termina en /exec
const TOKEN_SUBIDA_EXTRACTO = 'Solliml4+'; // <-- el mismo TOKEN_SUBIDA del Apps Script
// ------------------------------------

// Medios de pago que se pueden conciliar contra un extracto de la entidad.
// Efectivo no está acá porque ese ya se controla con Entrega de dinero.
export const MEDIOS_CONCILIABLES = ['Nequi', 'Addi', 'Datáfono', 'Sistecrédito', 'PTM'];

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export function subidaConfigurada() {
  return Boolean(URL_SUBIDA_EXTRACTO && TOKEN_SUBIDA_EXTRACTO);
}

// Total que el sistema calculó para ese medio de pago en un mes completo (todas
// las ventas del mes por ese medio, sin contar las anuladas). Se trae por rango
// de fecha (sin filtro adicional) para no necesitar ningún índice compuesto en
// Firestore, y se filtra tipo/anulada ya en el computador.
export async function totalSistemaPorMedio(medio, mesStr) {
  const [anio, mes] = mesStr.split('-').map(Number);
  const desde = `${mesStr}-01`;
  const ultimoDia = new Date(anio, mes, 0).getDate(); // día 0 del mes siguiente = último día de este mes
  const hasta = `${mesStr}-${String(ultimoDia).padStart(2, '0')}`;

  const q = query(collection(db, 'ventas'), where('fecha', '>=', desde), where('fecha', '<=', hasta));
  const snap = await getDocs(q);
  let total = 0;
  snap.docs.forEach((d) => {
    const v = d.data();
    if (v.tipo === 'venta' && v.anulada === false) {
      total += (v.pagos || {})[medio] || 0;
    } else if (v.tipo === 'cambio' && v.anulada === false && v.diferencia > 0 && v.pago === medio) {
      total += v.diferencia;
    }
  });
  return total;
}

// Sube el PDF del extracto a Google Drive (gratis, vía el Apps Script), que de
// paso le pide a una IA que lea el total del periodo. Devuelve { url,
// totalDetectado, razon } — totalDetectado puede venir null si la IA no está
// configurada en el Apps Script o no logró identificar el total con certeza.
// Lanza un error claro si todavía no se ha configurado la URL/TOKEN, o si el
// Apps Script rechaza la subida.
export async function subirExtractoPDF(file, medio, mes) {
  if (!subidaConfigurada()) {
    throw new Error('Todavía no está configurada la subida de PDF (falta la URL/TOKEN en src/lib/conciliaciones.js).');
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });

  const resp = await fetch(URL_SUBIDA_EXTRACTO, {
    method: 'POST',
    // Content-Type "text/plain" a propósito: evita que el navegador mande una
    // petición previa (preflight) que Apps Script no sabe responder bien.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token: TOKEN_SUBIDA_EXTRACTO,
      medio,
      mes,
      tipo: file.type || 'application/pdf',
      contenidoBase64: base64,
    }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || 'No se pudo subir el archivo.');
  // totalDetectado viene del análisis con IA (si está configurado en el Apps
  // Script) — puede venir null si no se configuró o si no logró leer el total.
  return { url: data.url, totalDetectado: data.totalDetectado ?? null, razon: data.razon || null };
}

// comisionPct es opcional: el % que te cobró la entidad ese mes (varía, así que
// se escribe cada vez en vez de quedar guardado fijo). Si se da, el total que
// se compara contra el extracto es el del sistema YA descontando esa comisión
// (totalEsperado) — así una diferencia real no se confunde con la comisión.
// Si se deja en blanco, se compara contra el total crudo del sistema, igual
// que antes.
export async function registrarConciliacion({ medio, mes, totalSistema, comisionPct, totalExtracto, pdfUrl, nota, usuario }) {
  const totalEsperado =
    comisionPct != null && !isNaN(comisionPct) ? totalSistema * (1 - comisionPct / 100) : totalSistema;
  const diferencia = Math.round(totalExtracto - totalEsperado);
  const ref = doc(collection(db, 'conciliaciones'));
  await setDoc(ref, {
    medio,
    mes,
    totalSistema,
    comisionPct: comisionPct != null && !isNaN(comisionPct) ? comisionPct : null,
    totalEsperado: Math.round(totalEsperado),
    totalExtracto,
    diferencia,
    pdfUrl: pdfUrl || null,
    nota: nota || null,
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    fecha: hoyStr(),
    hora: ahoraStr(),
    creadoEn: serverTimestamp(),
  });
  return { diferencia, totalEsperado: Math.round(totalEsperado) };
}

export async function conciliacionesRecientes(limite = 30) {
  const snap = await getDocs(collection(db, 'conciliaciones'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
    .slice(0, limite);
}
