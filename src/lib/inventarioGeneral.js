import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  getDoc,
  getDocs,
  writeBatch,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from './firebase';
import { guardarSinBloquear } from './offlineWrite';
import { hoyStr, ahoraStr } from './entradasSalidas';

// Inventario general (doble conteo con papelitos):
// - El día anterior las vendedoras cuentan cada fila o espacio y dejan ahí un
//   papelito en físico con las referencias y cantidades.
// - El día del inventario Nelson cuenta cada espacio SIN mirar el papelito,
//   pone el total, y después pasa lo que dice el papelito. Cada espacio cuadra
//   solo: su conteo contra la suma de su papelito.
// - Cuando todo cuadra, se compara cada referencia contra el stock que tenía el
//   sistema al empezar, y al aprobar se ajusta solo la diferencia (increment),
//   así lo que se vendió después de empezar queda bien.
//
// Colecciones:
// - tiendaMuebles/{id}: los muebles y lugares de la tienda (se arman una vez).
// - inventariosGenerales/{id}: cada inventario (abierto / aprobado / cancelado),
//   con la foto del stock al empezar.
// - inventariosGenerales/{id}/espacios/{muebleId__i_j}: lo contado en cada
//   espacio y su papelito ({ itemId: cantidad }).

export const TIPOS = {
  estanteria: { nombre: 'Estantería', fila: 'Fila', filas: 'Filas', secc: 'Secciones por fila' },
  vitrina: { nombre: 'Vitrina', fila: 'Fila', filas: 'Filas', secc: 'Secciones por fila' },
  burro: { nombre: 'Burro', fila: 'Barra', filas: 'Barras', secc: 'Tramos por barra' },
  mesa: { nombre: 'Mesa', fila: 'Fila', filas: 'Filas', secc: 'Montones por fila' },
  maniqui: { nombre: 'Maniquíes', fila: 'Maniquí', filas: '', secc: 'Cuántos maniquíes' },
  bodega: { nombre: 'Bodega', fila: 'Fila', filas: 'Filas', secc: 'Secciones por fila' },
  lugar: { nombre: 'Bolsa o caja', fila: 'Todo', filas: '', secc: '' },
  deudas: { nombre: 'Deudas', fila: 'Cuaderno', filas: '', secc: '' },
};
// Lugares sin filas: se cuenta todo junto (apartados, cambios, lavandería) o,
// en deudas, solo se pasa el cuaderno (esas prendas no están en la tienda).
export const SIN_FILAS = { lugar: true, deudas: true };
const LETRAS = 'ABCDEF';

// Los mismos lugares del chequeo semanal (ver UBICACIONES en Vender.jsx), más
// deudas. Se ofrecen para crearlos de una cuando todavía no hay nada armado.
export const LUGARES_SEMANALES = [
  { nombre: 'Bodega', tipo: 'bodega', filas: 4, secc: 1 },
  { nombre: 'Exhibición', tipo: 'maniqui', filas: 1, secc: 3 },
  { nombre: 'Apartados', tipo: 'lugar', filas: 1, secc: 1 },
  { nombre: 'Cambios', tipo: 'lugar', filas: 1, secc: 1 },
  { nombre: 'Lavandería', tipo: 'lugar', filas: 1, secc: 1 },
  { nombre: 'Deudas', tipo: 'deudas', filas: 1, secc: 1 },
];

export function etiquetaEspacio(mueble, i, j) {
  const t = mueble.tipo;
  if (t === 'maniqui') return `Maniquí ${j + 1}`;
  if (t === 'lugar') return 'Todo lo que hay';
  if (t === 'deudas') return 'Del cuaderno';
  const base = `${TIPOS[t]?.fila || 'Fila'} ${i + 1}`;
  return mueble.secc > 1 ? `${base} · ${LETRAS[j]}` : base;
}

export function claveEspacio(muebleId, i, j) {
  return `${muebleId}__${i}_${j}`;
}

export function espaciosDe(mueble) {
  const lista = [];
  for (let i = 0; i < mueble.filas; i++) for (let j = 0; j < mueble.secc; j++) lista.push({ i, j });
  return lista;
}

export function sumaPapelito(pap) {
  return Object.values(pap || {}).reduce((t, v) => t + (Number(v) || 0), 0);
}

// Estado de un espacio: 'ok' (cuadra), 'mal' (no cuadra), 'papelito' (ya se
// contó, falta pasar el papelito) o null (sin contar).
export function estadoEspacio(mueble, e) {
  if (!e) return null;
  const refs = Object.keys(e.pap || {});
  if (mueble.tipo === 'deudas') return e.n === null || e.n === undefined ? null : 'ok';
  if (e.n === null || e.n === undefined) return null;
  if (!refs.length) return e.n === 0 ? 'ok' : 'papelito';
  return sumaPapelito(e.pap) === e.n ? 'ok' : 'mal';
}

// ---------- Muebles ----------
export function suscribirMuebles(callback, onError) {
  return onSnapshot(
    collection(db, 'tiendaMuebles'),
    (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      lista.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
      callback(lista);
    },
    (err) => {
      console.error('Error leyendo los muebles:', err);
      if (onError) onError(err);
    }
  );
}

function limpiarMueble(m) {
  const tipo = TIPOS[m.tipo] ? m.tipo : 'estanteria';
  let filas = Math.max(1, Math.min(10, parseInt(m.filas) || 1));
  let secc = Math.max(1, Math.min(6, parseInt(m.secc) || 1));
  if (tipo === 'maniqui') filas = 1;
  if (SIN_FILAS[tipo]) {
    filas = 1;
    secc = 1;
  }
  return { nombre: (m.nombre || '').trim() || 'Mueble sin nombre', tipo, filas, secc, orden: m.orden ?? 0 };
}

export async function crearMueble(m) {
  const ref = doc(collection(db, 'tiendaMuebles'));
  await guardarSinBloquear(setDoc(ref, { ...limpiarMueble(m), creadoEn: serverTimestamp() }), {
    contexto: 'nuevo mueble',
  });
  return ref.id;
}

export async function guardarMueble(id, m) {
  await guardarSinBloquear(updateDoc(doc(db, 'tiendaMuebles', id), limpiarMueble(m)), {
    contexto: 'editar mueble',
  });
}

export async function quitarMueble(id) {
  await guardarSinBloquear(deleteDoc(doc(db, 'tiendaMuebles', id)), { contexto: 'quitar mueble' });
}

export async function crearLugaresSemanales(existentes) {
  const nombres = new Set(existentes.map((m) => m.nombre.trim().toLowerCase()));
  const batch = writeBatch(db);
  let orden = existentes.reduce((mx, m) => Math.max(mx, m.orden ?? 0), 0);
  let n = 0;
  LUGARES_SEMANALES.forEach((l) => {
    if (nombres.has(l.nombre.toLowerCase())) return;
    orden += 1;
    n += 1;
    batch.set(doc(collection(db, 'tiendaMuebles')), { ...limpiarMueble({ ...l, orden }), creadoEn: serverTimestamp() });
  });
  if (n) await guardarSinBloquear(batch.commit(), { contexto: 'lugares del chequeo semanal' });
  return n;
}

// ---------- Inventarios ----------
export function suscribirInventarios(callback, onError) {
  return onSnapshot(
    collection(db, 'inventariosGenerales'),
    (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      lista.sort((a, b) => (b.creadoEn?.seconds || 9e12) - (a.creadoEn?.seconds || 9e12));
      callback(lista);
    },
    (err) => {
      console.error('Error leyendo los inventarios generales:', err);
      if (onError) onError(err);
    }
  );
}

// La foto del stock al empezar es contra lo que se compara lo contado. Por eso
// conviene empezar con la tienda cerrada (antes de abrir), cuando ya están los
// papelitos del día anterior y todavía no se ha vendido nada.
export async function empezarInventario(usuario, items) {
  const stockInicio = {};
  items.forEach((it) => {
    stockInicio[it.id] = it.stock || 0;
  });
  const ref = await addDoc(collection(db, 'inventariosGenerales'), {
    estado: 'abierto',
    fecha: hoyStr(),
    hora: ahoraStr(),
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    stockInicio,
    creadoEn: serverTimestamp(),
  });
  return ref.id;
}

export async function cancelarInventario(invId, usuario) {
  await updateDoc(doc(db, 'inventariosGenerales', invId), {
    estado: 'cancelado',
    canceladoPor: usuario.nombreDefault,
    canceladoEn: serverTimestamp(),
  });
}

export function suscribirEspacios(invId, callback, onError) {
  return onSnapshot(
    collection(db, 'inventariosGenerales', invId, 'espacios'),
    (snap) => {
      const mapa = {};
      snap.docs.forEach((d) => {
        mapa[d.id] = d.data();
      });
      callback(mapa);
    },
    (err) => {
      console.error('Error leyendo los espacios del inventario:', err);
      if (onError) onError(err);
    }
  );
}

export async function leerEspacios(invId) {
  const snap = await getDocs(collection(db, 'inventariosGenerales', invId, 'espacios'));
  const mapa = {};
  snap.docs.forEach((d) => {
    mapa[d.id] = d.data();
  });
  return mapa;
}

// Se guarda en cada cambio: sin internet queda en el celular y sube después.
export function guardarEspacio(invId, mueble, i, j, datos) {
  const ref = doc(db, 'inventariosGenerales', invId, 'espacios', claveEspacio(mueble.id, i, j));
  return guardarSinBloquear(
    setDoc(ref, {
      muebleId: mueble.id,
      i,
      j,
      n: datos.n ?? null,
      pap: datos.pap || {},
      actualizadoEn: serverTimestamp(),
    }),
    { contexto: `inventario general · ${mueble.nombre}` }
  );
}

// ---------- Cuadre ----------
export function calcularCuadre({ muebles, espacios, items, inv }) {
  const porMueble = muebles.map((m) => {
    let conteo = 0;
    let papelitos = 0;
    let malos = 0;
    let pendientes = 0;
    const lista = espaciosDe(m).map(({ i, j }) => {
      const e = espacios[claveEspacio(m.id, i, j)] || null;
      const estado = estadoEspacio(m, e);
      if (estado === 'mal') malos++;
      if (estado === null || estado === 'papelito') pendientes++;
      if (e && e.n !== null && e.n !== undefined) conteo += e.n;
      papelitos += sumaPapelito(e?.pap);
      return { i, j, e, estado, nombre: etiquetaEspacio(m, i, j) };
    });
    return { mueble: m, espacios: lista, conteo, papelitos, malos, pendientes, listo: malos === 0 && pendientes === 0 };
  });

  const contado = {};
  const donde = {};
  porMueble.forEach(({ mueble, espacios: lista }) => {
    const lugar = SIN_FILAS[mueble.tipo] || mueble.tipo === 'bodega' || mueble.tipo === 'maniqui' ? mueble.nombre : 'Muebles';
    lista.forEach(({ e }) => {
      Object.entries(e?.pap || {}).forEach(([id, c]) => {
        contado[id] = (contado[id] || 0) + (Number(c) || 0);
        donde[id] = donde[id] || {};
        donde[id][lugar] = (donde[id][lugar] || 0) + (Number(c) || 0);
      });
    });
  });

  const stockInicio = inv?.stockInicio || {};
  const porRef = items
    .filter((it) => (stockInicio[it.id] ?? it.stock ?? 0) !== 0 || (contado[it.id] || 0) !== 0)
    .map((it) => {
      const inicio = stockInicio[it.id] ?? it.stock ?? 0;
      const c = contado[it.id] || 0;
      const dif = c - inicio;
      const costo = Number(it.costoCompra) || 0;
      return {
        id: it.id,
        nombre: it.name,
        contado: c,
        sistema: inicio,
        movido: (it.stock || 0) - inicio,
        dif,
        costo,
        plata: dif * costo,
        donde: donde[it.id] || {},
        sinFoto: stockInicio[it.id] === undefined,
      };
    })
    .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif) || a.nombre.localeCompare(b.nombre));

  // Referencias que salen en algún papelito pero ya no existen en el inventario.
  const desconocidas = Object.keys(contado).filter((id) => !items.some((it) => it.id === id));

  let faltan = 0,
    sobran = 0,
    plataFaltan = 0,
    plataSobran = 0;
  porRef.forEach((r) => {
    if (r.dif < 0) {
      faltan += -r.dif;
      plataFaltan += -r.plata;
    }
    if (r.dif > 0) {
      sobran += r.dif;
      plataSobran += r.plata;
    }
  });

  const totalConteo = porMueble.reduce((t, x) => t + x.conteo, 0);
  const totalPapelitos = porMueble.reduce((t, x) => t + x.papelitos, 0);
  const malos = porMueble.reduce((t, x) => t + x.malos, 0);
  const pendientes = porMueble.reduce((t, x) => t + x.pendientes, 0);
  const nombres = {};
  items.forEach((it) => {
    nombres[it.id] = it.name;
  });
  return {
    nombres,
    porMueble,
    porRef,
    desconocidas,
    faltan,
    sobran,
    plataFaltan,
    plataSobran,
    totalConteo,
    totalPapelitos,
    malos,
    pendientes,
    todoCuadra: muebles.length > 0 && malos === 0 && pendientes === 0,
  };
}

// ---------- Aprobar ----------
// Cada diferencia queda como una entrada o salida de mercancía con motivo
// "Inventario general" (así se ve y se puede anular desde Entradas y salidas),
// y el stock se mueve con increment() — nunca con un número fijo — para que lo
// vendido después de empezar no se pierda.
//
// El id de cada movimiento es fijo (inventario + referencia): si se corta la
// conexión a la mitad y se vuelve a aprobar, las que ya quedaron se saltan y
// ninguna se aplica dos veces.
export async function aprobarInventario({ inv, cuadre, muebles, usuario, alAvanzar }) {
  if (!navigator.onLine) throw new Error('Para aprobar hace falta internet: el ajuste del stock tiene que quedar confirmado.');
  const conDif = cuadre.porRef.filter((r) => r.dif !== 0);
  const contadorRef = doc(db, 'contadores', 'entradasSalidas');
  let hechas = 0;
  for (const r of conDif) {
    const movRef = doc(db, 'entradasSalidas', `ig_${inv.id}_${r.id}`);
    const ya = await getDoc(movRef);
    if (!ya.exists()) {
      const contadorSnap = await getDoc(contadorRef);
      const num = (contadorSnap.exists() ? contadorSnap.data().ultimo || 0 : 0) + 1;
      const batch = writeBatch(db);
      if (contadorSnap.exists()) batch.update(contadorRef, { ultimo: increment(1) });
      else batch.set(contadorRef, { ultimo: num });
      batch.update(doc(db, 'inventario', r.id), { stock: increment(r.dif) });
      batch.set(movRef, {
        num,
        fecha: hoyStr(),
        hora: ahoraStr(),
        usuarioId: usuario.id,
        usuarioNombre: usuario.nombreDefault,
        itemId: r.id,
        itemNombre: r.nombre,
        tipo: r.dif > 0 ? 'entrada' : 'salida',
        cantidad: Math.abs(r.dif),
        categoria: 'Inventario general',
        detalle: `Inventario del ${inv.fecha}: sistema ${r.sistema}, contado ${r.contado}`,
        anulada: false,
        inventarioId: inv.id,
        creadoEn: serverTimestamp(),
      });
      await batch.commit();
    }
    hechas++;
    if (alAvanzar) alAvanzar(hechas, conDif.length);
  }

  const porReferencia = {};
  cuadre.porRef.forEach((r) => {
    porReferencia[r.id] = { nombre: r.nombre, sistema: r.sistema, contado: r.contado, dif: r.dif, costo: r.costo, donde: r.donde };
  });
  await updateDoc(doc(db, 'inventariosGenerales', inv.id), {
    estado: 'aprobado',
    aprobadoPor: usuario.nombreDefault,
    aprobadoFecha: hoyStr(),
    aprobadoHora: ahoraStr(),
    aprobadoEn: serverTimestamp(),
    muebles: muebles.map((m) => ({ id: m.id, nombre: m.nombre, tipo: m.tipo, filas: m.filas, secc: m.secc })),
    resumen: {
      totalContado: cuadre.totalPapelitos,
      faltan: cuadre.faltan,
      sobran: cuadre.sobran,
      plataFaltan: cuadre.plataFaltan,
      plataSobran: cuadre.plataSobran,
      referenciasAjustadas: conDif.length,
    },
    porReferencia,
  });
}

// ---------- Excel ----------
export function descargarExcelInventario({ inv, cuadre }) {
  const lugares = new Set();
  cuadre.porRef.forEach((r) => Object.keys(r.donde).forEach((l) => lugares.add(l)));
  const cols = [...lugares];
  const hoja1 = cuadre.porRef.map((r) => {
    const fila = {
      Referencia: r.nombre,
      'Sistema al empezar': r.sistema,
      Contado: r.contado,
      Diferencia: r.dif,
      'Costo unidad': r.costo,
      'Diferencia a costo': r.plata,
      'Movido después de empezar': r.movido,
    };
    cols.forEach((l) => {
      fila[l] = r.donde[l] || 0;
    });
    return fila;
  });
  const hoja2 = [];
  cuadre.porMueble.forEach(({ mueble, espacios }) => {
    espacios.forEach(({ e, estado, nombre }) => {
      hoja2.push({
        Mueble: mueble.nombre,
        Espacio: nombre,
        Contaste: mueble.tipo === 'deudas' ? '' : e?.n ?? '',
        Papelito: Object.entries(e?.pap || {})
          .map(([id, c]) => `${cuadre.nombres[id] || id} × ${c}`)
          .join(' · '),
        'Suma papelito': sumaPapelito(e?.pap),
        Estado: estado === 'ok' ? 'Cuadra' : estado === 'mal' ? 'No cuadra' : 'Pendiente',
      });
    });
  });
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hoja1), 'Por referencia');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hoja2), 'Por espacio');
  XLSX.writeFile(libro, `inventario-general-${inv.fecha}.xlsx`);
}
