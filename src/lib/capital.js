import { collection, doc, setDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// Capital disponible = cuánta plata de verdad tiene el negocio ahora mismo,
// repartida en 3 bolsillos: Efectivo (caja + lo que tenga Fausto guardado —
// sigue siendo efectivo aunque cambie de manos), Nequi, y Banco (todo lo que
// no es efectivo ni Nequi: Datáfono, Addi, PTM, Sistecrédito y transferencias
// bancarias se juntan ahí, como normalmente se ve reflejado en el banco).
//
// No se reconstruye desde el día 1 del negocio (sería poco confiable) — en
// vez de eso, Nelson deja un "punto de partida" (un saldo real que contó él
// mismo, con fecha), y de ahí en adelante el sistema va sumando y restando
// solo con cada venta/gasto/compra. Se puede dejar un punto de partida nuevo
// cuando quiera (por ejemplo después de un conteo físico), sin borrar los
// anteriores — así siempre se sabe con qué se calculó cada vez.

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}
function diaSiguiente(fechaStr) {
  const [a, m, d] = fechaStr.split('-').map(Number);
  const fecha = new Date(a, m - 1, d + 1);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(
    fecha.getDate()
  ).padStart(2, '0')}`;
}

// A qué bolsillo va cada medio de pago de una venta (o el "pago" de un cambio).
const MEDIO_A_BOLSILLO = {
  Efectivo: 'efectivo',
  Nequi: 'nequi',
  Datáfono: 'banco',
  Addi: 'banco',
  PTM: 'banco',
  Sistecrédito: 'banco',
};

// A qué bolsillo resta un gasto o una compra, según de dónde salió la plata.
// Toda la plata sale del mismo negocio, así que cada origen cae en alguno de
// los 3 bolsillos.
const ORIGEN_A_BOLSILLO = {
  'Efectivo de la caja': 'efectivo',
  'Nequi del local': 'nequi',
  'Datáfono del local': 'banco',
  'Transferencia bancaria': 'banco',
};

export async function guardarCapitalInicial({ fecha, efectivo, nequi, banco, nota, usuario }) {
  const ref = doc(collection(db, 'capitalInicial'));
  await setDoc(ref, {
    fecha,
    efectivo,
    nequi,
    banco,
    nota: nota || null,
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombreDefault,
    creadoFecha: hoyStr(),
    creadoHora: ahoraStr(),
    creadoEn: serverTimestamp(),
  });
}

export async function historialCapitalInicial() {
  const snap = await getDocs(collection(db, 'capitalInicial'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fecha === a.fecha ? (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0) : b.fecha > a.fecha ? 1 : -1));
}

async function ultimoCheckpoint() {
  const historial = await historialCapitalInicial();
  return historial[0] || null;
}

// El resultado completo: el punto de partida usado, y el saldo de cada
// bolsillo ya sumando/restando todos los movimientos desde el día siguiente
// del punto de partida hasta hoy.
export async function capitalDisponible() {
  const checkpoint = await ultimoCheckpoint();
  if (!checkpoint) return { checkpoint: null };

  const hoy = hoyStr();
  const desde = diaSiguiente(checkpoint.fecha);

  const movimientos = { efectivo: 0, nequi: 0, banco: 0 };

  if (desde <= hoy) {
    // Rango de fecha SIN ningún otro filtro combinado (para no necesitar
    // ningún índice compuesto en Firestore) — el resto se filtra ya en el
    // computador, igual que en Conciliación.
    const [snapVentas, snapGastos, snapCompras] = await Promise.all([
      getDocs(query(collection(db, 'ventas'), where('fecha', '>=', desde), where('fecha', '<=', hoy))),
      getDocs(query(collection(db, 'gastos'), where('fecha', '>=', desde), where('fecha', '<=', hoy))),
      getDocs(query(collection(db, 'compras'), where('fecha', '>=', desde), where('fecha', '<=', hoy))),
    ]);

    snapVentas.docs.forEach((d) => {
      const v = d.data();
      if (v.tipo === 'venta' && v.anulada === false) {
        Object.entries(v.pagos || {}).forEach(([medio, monto]) => {
          const bolsillo = MEDIO_A_BOLSILLO[medio];
          if (bolsillo) movimientos[bolsillo] += monto;
        });
      } else if (v.tipo === 'cambio' && v.anulada === false && v.diferencia > 0 && v.pago) {
        const bolsillo = MEDIO_A_BOLSILLO[v.pago];
        if (bolsillo) movimientos[bolsillo] += v.diferencia;
      }
    });

    snapGastos.docs.forEach((d) => {
      const g = d.data();
      if (g.anulado === false) {
        const bolsillo = ORIGEN_A_BOLSILLO[g.origen];
        if (bolsillo) movimientos[bolsillo] -= g.monto || 0;
      }
    });

    snapCompras.docs.forEach((d) => {
      const c = d.data();
      const bolsillo = ORIGEN_A_BOLSILLO[c.origen];
      if (bolsillo) movimientos[bolsillo] -= c.totalGeneral || 0;
    });
  }

  const efectivo = checkpoint.efectivo + movimientos.efectivo;
  const nequi = checkpoint.nequi + movimientos.nequi;
  const banco = checkpoint.banco + movimientos.banco;

  return {
    checkpoint,
    desde,
    hasta: hoy,
    efectivo,
    nequi,
    banco,
    total: efectivo + nequi + banco,
  };
}
