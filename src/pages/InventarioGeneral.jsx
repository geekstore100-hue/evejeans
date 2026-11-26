import { useEffect, useMemo, useRef, useState } from 'react';
import { suscribirInventario } from '../lib/inventario';
import {
  TIPOS,
  SIN_FILAS,
  suscribirMuebles,
  crearMueble,
  guardarMueble,
  quitarMueble,
  crearLugaresSemanales,
  suscribirInventarios,
  empezarInventario,
  cancelarInventario,
  suscribirEspacios,
  leerEspacios,
  guardarEspacio,
  claveEspacio,
  espaciosDe,
  etiquetaEspacio,
  estadoEspacio,
  sumaPapelito,
  calcularCuadre,
  aprobarInventario,
  descargarExcelInventario,
} from '../lib/inventarioGeneral';
import { usarAtras } from '../lib/atras';
import DibujoMueble from '../components/DibujoMueble';

function pesos(n) {
  const v = Math.round(n || 0);
  return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('es-CO');
}
function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}
function errorTexto(err) {
  return err?.code === 'permission-denied'
    ? 'Permiso denegado. Revisa que las reglas nuevas del inventario general estén publicadas en Firebase.'
    : err?.message || String(err);
}
// Primero los muebles con filas, después apartados, cambios, lavandería y deudas.
function ordenConteo(muebles) {
  return [...muebles.filter((m) => !SIN_FILAS[m.tipo]), ...muebles.filter((m) => SIN_FILAS[m.tipo])];
}
function resumenMueble(m) {
  if (m.tipo === 'lugar') return 'Se cuenta todo junto';
  if (m.tipo === 'deudas') return 'Se pasa del cuaderno';
  if (m.tipo === 'maniqui') return `Maniquíes · ${m.secc}`;
  return `${TIPOS[m.tipo]?.nombre || ''} · ${m.filas} ${(TIPOS[m.tipo]?.filas || 'filas').toLowerCase()}${m.secc > 1 ? ' × ' + m.secc : ''}`;
}

export default function InventarioGeneral({ usuario }) {
  const [muebles, setMuebles] = useState(null);
  const [inventarios, setInventarios] = useState(null);
  const [items, setItems] = useState(null);
  const [espacios, setEspacios] = useState({});
  const [error, setError] = useState('');
  const [tab, setTab] = useState(null); // null = la pantalla de inicio de esa situación
  const [irA, setIrA] = useState(null); // { muebleId, i, j } para saltar a contar un espacio

  useEffect(() => suscribirMuebles(setMuebles, (e) => setError(errorTexto(e))), []);
  useEffect(() => suscribirInventarios(setInventarios, (e) => setError(errorTexto(e))), []);
  useEffect(() => suscribirInventario(setItems, (e) => setError(errorTexto(e))), []);

  const abierto = (inventarios || []).find((x) => x.estado === 'abierto') || null;
  useEffect(() => {
    if (!abierto) {
      setEspacios({});
      return undefined;
    }
    return suscribirEspacios(abierto.id, setEspacios, (e) => setError(errorTexto(e)));
  }, [abierto?.id]);

  let vista = tab || (abierto ? 'contar' : 'inicio');
  if (!abierto && (vista === 'contar' || vista === 'cuadre')) vista = 'inicio';
  if (abierto && vista === 'inicio') vista = 'contar';
  usarAtras(() => {
    if (!tab) return false;
    setTab(null);
    return true;
  }, 10);

  const cuadre = useMemo(() => {
    if (!abierto || !muebles || !items) return null;
    return calcularCuadre({ muebles: ordenConteo(muebles), espacios, items, inv: abierto });
  }, [abierto, muebles, espacios, items]);

  if (error) return <div className="card"><div className="msg bad">{error}</div></div>;
  if (!muebles || !inventarios || !items) return <div className="card"><div className="empty-lines">Cargando…</div></div>;

  function cambiarTab(t) {
    setTab(t === (abierto ? 'contar' : 'inicio') ? null : t);
    window.scrollTo(0, 0);
  }

  return (
    <div className="ig-wrap">
      <div className="ig-tabs">
        {abierto ? (
          <>
            <button className={`chip ${vista === 'contar' ? 'on' : ''}`} onClick={() => cambiarTab('contar')}>
              Contar y pasar papelitos
            </button>
            <button className={`chip ${vista === 'cuadre' ? 'on' : ''}`} onClick={() => cambiarTab('cuadre')}>
              Cuadre y ajuste
            </button>
          </>
        ) : (
          <button className={`chip ${vista === 'inicio' ? 'on' : ''}`} onClick={() => cambiarTab('inicio')}>
            Inventario general
          </button>
        )}
        <button className={`chip ${vista === 'tienda' ? 'on' : ''}`} onClick={() => cambiarTab('tienda')}>
          Armar la tienda
        </button>
      </div>

      {vista === 'inicio' && (
        <Inicio
          usuario={usuario}
          muebles={muebles}
          items={items}
          inventarios={inventarios}
          onArmar={() => cambiarTab('tienda')}
        />
      )}
      {vista === 'tienda' && <ArmarTienda muebles={muebles} abierto={abierto} />}
      {vista === 'contar' && abierto && (
        <Contar
          inv={abierto}
          muebles={ordenConteo(muebles)}
          espacios={espacios}
          items={items}
          irA={irA}
          onArmar={() => cambiarTab('tienda')}
        />
      )}
      {vista === 'cuadre' && abierto && cuadre && (
        <Cuadre
          inv={abierto}
          muebles={ordenConteo(muebles)}
          cuadre={cuadre}
          usuario={usuario}
          onContar={(muebleId, i, j) => {
            setIrA({ muebleId, i, j, t: Date.now() });
            cambiarTab('contar');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Inicio({ usuario, muebles, items, inventarios, onArmar }) {
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState('');
  const anteriores = inventarios.filter((x) => x.estado === 'aprobado');

  async function empezar() {
    const ok = window.confirm(
      'Al empezar, la app toma una foto del stock que tiene el sistema en este momento, y contra eso compara lo que cuentes.\n\nHazlo con la tienda cerrada, antes de vender (los papelitos de ellas son del cierre de ayer).\n\n¿Empezar el inventario general?'
    );
    if (!ok) return;
    setTrabajando(true);
    setMsg('');
    try {
      await empezarInventario(usuario, items);
    } catch (e) {
      setMsg(errorTexto(e));
    }
    setTrabajando(false);
  }

  async function excel(inv) {
    try {
      const esp = await leerEspacios(inv.id);
      const cuadre = calcularCuadre({ muebles: inv.muebles || [], espacios: esp, items, inv });
      descargarExcelInventario({ inv, cuadre });
    } catch (e) {
      alert('No se pudo armar el Excel: ' + errorTexto(e));
    }
  }

  return (
    <>
      <div className="card ig-intro">
        <h2 style={{ margin: 0 }}>Inventario general</h2>
        <ol>
          <li>
            <b>El día anterior</b>, ellas cuentan cada fila o espacio y dejan ahí el papelito con las referencias y
            cantidades.
          </li>
          <li>
            <b>El día del inventario</b>, con la tienda cerrada, le das «Empezar». En cada espacio cuentas primero tú,
            sin mirar el papelito, y después pasas lo que dice el papelito. La app te dice al instante si cuadra.
          </li>
          <li>
            <b>Cuando todo cuadra</b>, se compara cada referencia con el sistema y apruebas el ajuste.
          </li>
        </ol>
        {muebles.length === 0 ? (
          <div className="ig-aviso gris">
            Primero arma la tienda
            <span>Crea cada mueble con su nombre y cuántas filas tiene. Se hace una sola vez.</span>
          </div>
        ) : (
          <div className="hint" style={{ marginTop: 0 }}>
            La tienda tiene {plural(muebles.length, 'mueble o lugar', 'muebles y lugares')} con{' '}
            {plural(muebles.reduce((t, m) => t + m.filas * m.secc, 0), 'espacio', 'espacios')} para contar.
          </div>
        )}
        <div className="ig-acciones">
          <button className="btn" onClick={empezar} disabled={trabajando || muebles.length === 0}>
            {trabajando ? 'Empezando…' : 'Empezar inventario general'}
          </button>
          <button className="btn ghost" onClick={onArmar}>
            Armar la tienda
          </button>
        </div>
        {msg && <div className="msg bad">{msg}</div>}
      </div>

      {anteriores.length > 0 && (
        <div className="card">
          <h2>Inventarios anteriores</h2>
          <div className="ig-tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="num">Prendas</th>
                  <th className="num">Faltaron</th>
                  <th className="num">Sobraron</th>
                  <th className="num">Neto a costo</th>
                  <th>Aprobó</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {anteriores.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.fecha}</td>
                    <td className="num">{inv.resumen?.totalContado ?? '—'}</td>
                    <td className="num">{inv.resumen?.faltan ?? '—'}</td>
                    <td className="num">{inv.resumen?.sobran ?? '—'}</td>
                    <td className="num">
                      {inv.resumen ? pesos((inv.resumen.plataSobran || 0) - (inv.resumen.plataFaltan || 0)) : '—'}
                    </td>
                    <td>{inv.aprobadoPor || '—'}</td>
                    <td>
                      <button className="btn ghost sm" onClick={() => excel(inv)}>
                        Excel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function ArmarTienda({ muebles, abierto }) {
  const [selId, setSelId] = useState(muebles[0]?.id || null);
  const [nombre, setNombre] = useState('');
  const [msg, setMsg] = useState('');
  const sel = muebles.find((m) => m.id === selId) || null;

  useEffect(() => {
    if (!sel && muebles.length) setSelId(muebles[0].id);
  }, [muebles.length]);
  useEffect(() => {
    setNombre(sel?.nombre || '');
  }, [sel?.id, sel?.nombre]);

  function guardar(cambios) {
    if (!sel) return;
    setMsg('');
    guardarMueble(sel.id, { ...sel, ...cambios }).catch((e) => setMsg(errorTexto(e)));
  }
  async function agregar() {
    setMsg('');
    try {
      const orden = muebles.reduce((mx, m) => Math.max(mx, m.orden ?? 0), 0) + 1;
      const id = await crearMueble({ nombre: 'Mueble nuevo', tipo: 'estanteria', filas: 3, secc: 1, orden });
      setSelId(id);
    } catch (e) {
      setMsg(errorTexto(e));
    }
  }
  async function quitar() {
    if (!sel) return;
    const extra = abierto ? '\n\nHay un inventario abierto: lo que hayas contado en este mueble deja de contar.' : '';
    if (!window.confirm(`¿Quitar «${sel.nombre}» de la tienda?${extra}`)) return;
    try {
      await quitarMueble(sel.id);
      setSelId(null);
    } catch (e) {
      setMsg(errorTexto(e));
    }
  }
  function mover(d) {
    const idx = muebles.findIndex((m) => m.id === sel.id);
    const otro = muebles[idx + d];
    if (!otro) return;
    const a = sel.orden ?? idx;
    const b = otro.orden ?? idx + d;
    guardarMueble(sel.id, { ...sel, orden: a === b ? b + d : b }).catch((e) => setMsg(errorTexto(e)));
    guardarMueble(otro.id, { ...otro, orden: a }).catch((e) => setMsg(errorTexto(e)));
  }
  async function lugaresSemanales() {
    try {
      const n = await crearLugaresSemanales(muebles);
      if (!n) setMsg('Ya están todos creados.');
    } catch (e) {
      setMsg(errorTexto(e));
    }
  }

  const tipo = sel ? TIPOS[sel.tipo] : null;
  const faltanLugares = ['apartados', 'cambios', 'lavandería', 'deudas'].some(
    (n) => !muebles.some((m) => m.nombre.trim().toLowerCase() === n)
  );

  return (
    <div className="ig-tienda">
      <div className="card">
        <h2>Armar la tienda</h2>
        <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Se hace una sola vez. Cada mueble con su nombre, qué es y cuántas filas o tramos tiene. Si cambias algo de
          sitio, solo lo editas.
        </div>
        <div className="ig-tarjetas">
          {muebles.map((m) => (
            <button key={m.id} className={`ig-tarjeta ${m.id === selId ? 'on' : ''}`} onClick={() => setSelId(m.id)}>
              <div className="ig-tarjeta-dibujo">
                <DibujoMueble mueble={m} tam="mini" />
              </div>
              <span className="ig-tarjeta-nombre">{m.nombre}</span>
              <span className="ig-tarjeta-sub">{resumenMueble(m)}</span>
            </button>
          ))}
          <button className="ig-tarjeta nueva" onClick={agregar}>
            + Agregar mueble
          </button>
        </div>
        {faltanLugares && (
          <div style={{ marginTop: 12 }}>
            <button className="btn ghost sm" onClick={lugaresSemanales}>
              + Agregar los lugares del chequeo semanal (bodega, exhibición, apartados, cambios, lavandería y deudas)
            </button>
          </div>
        )}
        {msg && <div className="msg bad">{msg}</div>}
      </div>

      {sel && (
        <div className="card ig-panel">
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="ig-label">Nombre</span>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onBlur={() => nombre.trim() && nombre !== sel.nombre && guardar({ nombre })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="ig-label">Qué es</span>
            <div className="ig-tipos">
              {Object.keys(TIPOS).map((k) => (
                <button key={k} className={`chip ${sel.tipo === k ? 'on' : ''}`} onClick={() => guardar({ tipo: k })}>
                  {TIPOS[k].nombre}
                </button>
              ))}
            </div>
          </div>

          {!SIN_FILAS[sel.tipo] && (
            <div className="ig-steppers">
              {sel.tipo !== 'maniqui' && (
                <div className="ig-stepper">
                  <span className="ig-label">{tipo.filas}</span>
                  <div className="ig-stepper-fila">
                    <button onClick={() => guardar({ filas: sel.filas - 1 })} aria-label="Una menos">−</button>
                    <b>{sel.filas}</b>
                    <button onClick={() => guardar({ filas: sel.filas + 1 })} aria-label="Una más">+</button>
                  </div>
                </div>
              )}
              <div className="ig-stepper">
                <span className="ig-label">{tipo.secc}</span>
                <div className="ig-stepper-fila">
                  <button onClick={() => guardar({ secc: sel.secc - 1 })} aria-label="Una menos">−</button>
                  <b>{sel.secc}</b>
                  <button onClick={() => guardar({ secc: sel.secc + 1 })} aria-label="Una más">+</button>
                </div>
              </div>
            </div>
          )}
          {sel.tipo === 'lugar' && (
            <div className="ig-nota">Sin filas: el día del inventario cuentas todo lo que hay aquí junto y pasas su papelito.</div>
          )}
          {sel.tipo === 'deudas' && (
            <div className="ig-nota">
              Las prendas que se llevaron fiadas no están en la tienda. Ese día solo pasas lo que dice el cuaderno de
              deudas, y suman al inventario.
            </div>
          )}

          <div className="ig-vista">
            <div className="ig-label" style={{ marginBottom: 8 }}>
              Así se verá al contar · {plural(sel.filas * sel.secc, 'espacio', 'espacios')}
            </div>
            <DibujoMueble mueble={sel} tam="medio" />
          </div>

          <div className="ig-acciones" style={{ justifyContent: 'space-between' }}>
            <div className="ig-acciones">
              <button className="btn ghost sm" onClick={() => mover(-1)}>← Antes</button>
              <button className="btn ghost sm" onClick={() => mover(1)}>Después →</button>
            </div>
            <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={quitar}>
              Quitar este mueble
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const TECLAS = ['1', '2', '3', '⌫', '4', '5', '6', '0', '7', '8', '9', 'sig'];

function Contar({ inv, muebles, espacios, items, irA, onArmar }) {
  const [selId, setSelId] = useState(muebles[0]?.id || null);
  const [pos, setPos] = useState({ i: 0, j: 0 });
  const [paso, setPaso] = useState('contar');
  const [linea, setLinea] = useState(null);
  const [nuevo, setNuevo] = useState(true);
  const [buscar, setBuscar] = useState('');
  const [msg, setMsg] = useState('');

  const m = muebles.find((x) => x.id === selId) || muebles[0] || null;
  const nombres = useMemo(() => {
    const o = {};
    items.forEach((it) => {
      o[it.id] = it.name;
    });
    return o;
  }, [items]);
  const refsOrdenadas = useMemo(
    () =>
      items
        .filter((it) => !it.oculto)
        .sort((a, b) => (a.tipo === b.tipo ? (a.tipo === 'precio' ? (a.price || 0) - (b.price || 0) : a.name.localeCompare(b.name)) : a.tipo === 'nombre' ? -1 : 1)),
    [items]
  );

  function datos(mu, i, j) {
    return espacios[claveEspacio(mu.id, i, j)] || { n: null, pap: {} };
  }
  function ir(mu, i, j) {
    const e = datos(mu, i, j);
    const refs = Object.keys(e.pap || {});
    setSelId(mu.id);
    setPos({ i, j });
    setPaso(mu.tipo === 'deudas' || (e.n !== null && e.n !== undefined) ? 'papelito' : 'contar');
    setLinea(refs.length ? refs[refs.length - 1] : null);
    setNuevo(true);
    setBuscar('');
  }

  useEffect(() => {
    if (!irA) return;
    const mu = muebles.find((x) => x.id === irA.muebleId);
    if (mu) ir(mu, irA.i, irA.j);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irA?.t]);

  // Si se quitó el mueble o se le quitaron filas mientras se contaba.
  useEffect(() => {
    if (m && (pos.i >= m.filas || pos.j >= m.secc)) setPos({ i: 0, j: 0 });
  }, [m?.id, m?.filas, m?.secc]);

  const teclaRef = useRef(null);
  useEffect(() => {
    function alTeclear(ev) {
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (/^[0-9]$/.test(ev.key)) teclaRef.current?.(ev.key);
      else if (ev.key === 'Backspace') teclaRef.current?.('⌫');
      else if (ev.key === 'Enter') teclaRef.current?.('sig');
      else return;
      ev.preventDefault();
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  if (!m) {
    return (
      <div className="card">
        <div className="ig-aviso gris">
          No hay muebles
          <span>Arma la tienda para poder contar.</span>
        </div>
        <button className="btn" style={{ marginTop: 10 }} onClick={onArmar}>
          Armar la tienda
        </button>
      </div>
    );
  }

  const i = Math.min(pos.i, m.filas - 1);
  const j = Math.min(pos.j, m.secc - 1);
  const e = datos(m, i, j);
  const pap = e.pap || {};
  const papRefs = Object.keys(pap);
  const papSuma = sumaPapelito(pap);
  const est = estadoEspacio(m, e);
  const esDeuda = m.tipo === 'deudas';
  const contando = paso === 'contar' && !esDeuda;

  function guardar(nuevoDato) {
    setMsg('');
    const d = { n: e.n ?? null, pap: { ...pap }, ...nuevoDato };
    if (esDeuda) d.n = Object.keys(d.pap).length ? sumaPapelito(d.pap) : d.n === 0 ? 0 : null;
    guardarEspacio(inv.id, m, i, j, d).catch((err) => setMsg('No se pudo guardar: ' + errorTexto(err)));
  }

  function siguiente() {
    const lista = espaciosDe(m);
    const k = lista.findIndex((x) => x.i === i && x.j === j);
    const orden = [...lista.slice(k + 1), ...lista.slice(0, k + 1)];
    const prox = orden.find((x) => estadoEspacio(m, datos(m, x.i, x.j)) !== 'ok' && !(x.i === i && x.j === j));
    if (prox) return ir(m, prox.i, prox.j);
    if (estadoEspacio(m, e) !== 'ok') return; // este mismo espacio todavía no cuadra
    const idx = muebles.findIndex((x) => x.id === m.id);
    const otros = [...muebles.slice(idx + 1), ...muebles.slice(0, idx)];
    for (const mu of otros) {
      const libre = espaciosDe(mu).find((x) => estadoEspacio(mu, datos(mu, x.i, x.j)) !== 'ok');
      if (libre) return ir(mu, libre.i, libre.j);
    }
  }

  function tecla(k) {
    if (k === 'sig') {
      if (contando) {
        if (e.n !== null && e.n !== undefined) {
          setPaso('papelito');
          setLinea(null);
          setNuevo(true);
        }
      } else siguiente();
      return;
    }
    if (!contando && !linea) return;
    const actual = contando ? e.n : pap[linea];
    let v;
    if (k === '⌫') {
      const s = actual === null || actual === undefined ? '' : String(actual).slice(0, -1);
      v = s === '' ? (contando ? null : 0) : parseInt(s, 10);
    } else {
      const base = nuevo || !actual ? '' : String(actual);
      if (base.length >= 4) return;
      v = parseInt(base + k, 10);
    }
    setNuevo(false);
    if (contando) guardar({ n: v });
    else guardar({ pap: { ...pap, [linea]: v } });
  }
  teclaRef.current = tecla;

  function agregarRef(id) {
    guardar({ pap: { ...pap, [id]: pap[id] || 0 } });
    setLinea(id);
    setNuevo(true);
    setBuscar('');
  }
  function quitarRef(id) {
    const p = { ...pap };
    delete p[id];
    guardar({ pap: p });
    if (linea === id) setLinea(null);
  }

  let aviso;
  if (esDeuda && e.n === 0 && !papRefs.length) aviso = { c: 'bien', t: '✓ No hay prendas fiadas', s: 'Listo, pasa al siguiente.' };
  else if (esDeuda && papRefs.length)
    aviso = { c: 'cian', t: `${plural(papSuma, 'prenda fiada', 'prendas fiadas')}`, s: 'No se cuentan: suman al inventario como si estuvieran en la tienda.' };
  else if (!papRefs.length)
    aviso = e.n === 0
      ? { c: 'bien', t: '✓ Vacío', s: 'No hay prendas en este espacio.' }
      : { c: 'gris', t: esDeuda ? 'Agrega las referencias del cuaderno' : 'Agrega las referencias del papelito', s: 'Toca la referencia y escribe la cantidad con el teclado.' };
  else if (est === 'ok') aviso = { c: 'bien', t: `✓ Cuadra: ${papSuma} = ${e.n}`, s: 'Pasa al siguiente espacio con «Sig. →».' };
  else {
    const d = papSuma - e.n;
    aviso = {
      c: 'mal',
      t: `✗ Papelito ${papSuma} · contaste ${e.n}`,
      s: d > 0 ? `El papelito dice ${d} más. Vuelve a contar o revisa el papelito.` : `Al papelito le faltan ${-d}. ¿Falta una referencia?`,
    };
  }

  const totalMueble = espaciosDe(m).reduce((t, x) => t + (datos(m, x.i, x.j).n || 0), 0);
  const filtro = buscar.trim().toLowerCase();
  const disponibles = refsOrdenadas.filter((it) => !(it.id in pap) && (!filtro || it.name.toLowerCase().includes(filtro)));

  function chip(mu) {
    const lista = espaciosDe(mu).map((x) => estadoEspacio(mu, datos(mu, x.i, x.j)));
    const listo = lista.every((s) => s === 'ok');
    const malo = lista.some((s) => s === 'mal');
    const algo = lista.some((s) => s !== null);
    return (
      <button key={mu.id} className={mu.id === m.id ? 'on' : listo ? 'listo' : malo ? 'revisar' : ''} onClick={() => ir(mu, 0, 0)}>
        <b>{mu.nombre}</b>
        <span>{listo ? '✓ cuadra' : malo ? '✗ revisar' : algo ? 'a medias' : 'por contar'}</span>
      </button>
    );
  }

  return (
    <div className="ig-contar">
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="ig-label">Muebles</span>
          <div className="ig-elegir">{muebles.filter((x) => !SIN_FILAS[x.tipo]).map(chip)}</div>
          {muebles.some((x) => SIN_FILAS[x.tipo]) && (
            <>
              <span className="ig-label" style={{ marginTop: 4 }}>Apartados, cambios, lavandería y deudas</span>
              <div className="ig-elegir">{muebles.filter((x) => SIN_FILAS[x.tipo]).map(chip)}</div>
            </>
          )}
        </div>
        <div className="ig-panel-top">
          <b>{m.nombre}</b>
          <span className="hint" style={{ margin: 0 }}>Toca un espacio del dibujo</span>
        </div>
        <DibujoMueble
          mueble={m}
          tam="grande"
          sel={{ i, j }}
          valor={(a, b) => {
            const x = datos(m, a, b);
            return m.tipo === 'deudas' ? (x.n === null || x.n === undefined ? null : x.n) : x.n;
          }}
          estado={(a, b) => estadoEspacio(m, datos(m, a, b))}
          onTocar={(a, b) => ir(m, a, b)}
        />
        <div className="ig-total">
          <span>Total de {m.nombre}</span>
          <b>{totalMueble}</b>
        </div>
      </div>

      <div className="card ig-panel ticket">
        <div className="ig-panel-top">
          <b>{etiquetaEspacio(m, i, j)}</b>
          <span className="ig-paso">{esDeuda ? 'SOLO EL CUADERNO' : contando ? 'PASO 1 · CONTAR' : 'PASO 2 · PAPELITO'}</span>
        </div>

        {contando ? (
          <>
            <span className="hint" style={{ marginTop: 0 }}>
              {m.tipo === 'lugar'
                ? `¿Cuántas prendas hay en ${m.nombre.toLowerCase()}? Cuenta todo junto; después miras el papelito.`
                : '¿Cuántas prendas contaste en este espacio? Cuenta primero; después miras el papelito.'}
            </span>
            <span className="ig-numero">{e.n ?? '—'}</span>
          </>
        ) : (
          <>
            {!esDeuda && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14 }}>
                <span style={{ color: 'var(--ink-soft)' }}>Contaste</span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <b style={{ fontSize: 18 }}>{e.n ?? '—'}</b>
                  <button className="ig-link" onClick={() => { setPaso('contar'); setNuevo(true); }}>
                    Volví a contar
                  </button>
                </span>
              </div>
            )}
            <span className="ig-label" style={{ color: 'var(--rosa-fuerte)' }}>
              {esDeuda ? 'Prendas fiadas (del cuaderno)' : 'Lo que dice el papelito'}
            </span>
            {papRefs.map((id) => (
              <div key={id} className={`ig-linea ${linea === id ? 'on' : ''}`}>
                <button className="ig-linea-ref" onClick={() => { setLinea(id); setNuevo(true); }}>
                  {nombres[id] || id}
                </button>
                <button className="ig-linea-cant" onClick={() => { setLinea(id); setNuevo(true); }}>
                  {pap[id]}
                </button>
                <button className="ig-linea-x" onClick={() => quitarRef(id)} aria-label={`Quitar ${nombres[id] || id}`}>
                  ×
                </button>
              </div>
            ))}
            {refsOrdenadas.length > 16 && (
              <input type="text" placeholder="Buscar referencia…" value={buscar} onChange={(ev) => setBuscar(ev.target.value)} />
            )}
            <div className="ig-refs">
              {disponibles.map((it) => (
                <button key={it.id} onClick={() => agregarRef(it.id)}>
                  + {it.name}
                </button>
              ))}
            </div>
            {esDeuda && !papRefs.length && e.n !== 0 && (
              <button className="btn ghost sm" onClick={() => guardar({ n: 0, pap: {} })}>
                No hay prendas fiadas
              </button>
            )}
            <div className={`ig-aviso ${aviso.c}`}>
              {aviso.t}
              <span>{aviso.s}</span>
            </div>
          </>
        )}

        <div className="ig-teclado">
          {TECLAS.map((k) => (
            <button
              key={k}
              className={k === 'sig' ? 'sig' : k === '⌫' ? 'esp' : ''}
              onClick={() => tecla(k)}
              aria-label={k === '⌫' ? 'Borrar' : k === 'sig' ? 'Siguiente' : k}
            >
              {k === 'sig' ? 'Sig. →' : k}
            </button>
          ))}
        </div>
        {msg && <div className="msg bad">{msg}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Cuadre({ inv, muebles, cuadre, usuario, onContar }) {
  const [abierto, setAbierto] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [aprobando, setAprobando] = useState(null);
  const [msg, setMsg] = useState('');
  const c = cuadre;
  const conDif = c.porRef.filter((r) => r.dif !== 0);
  const movidas = c.porRef.filter((r) => r.movido !== 0);

  async function aprobar() {
    setMsg('');
    setAprobando({ hechas: 0, total: conDif.length });
    try {
      await aprobarInventario({
        inv,
        cuadre: c,
        muebles,
        usuario,
        alAvanzar: (hechas, total) => setAprobando({ hechas, total }),
      });
    } catch (e) {
      setMsg('No se pudo terminar de aprobar: ' + errorTexto(e) + ' Lo que ya quedó no se repite: puedes volver a darle «Aprobar».');
      setAprobando(null);
      setConfirmando(false);
    }
  }
  async function cancelar() {
    if (!window.confirm('¿Cancelar este inventario? Se descarta lo contado y el stock no se toca.')) return;
    try {
      await cancelarInventario(inv.id, usuario);
    } catch (e) {
      setMsg(errorTexto(e));
    }
  }

  let global;
  if (c.todoCuadra) global = { c: 'bien', t: `✓ Cuadra: ${c.totalConteo} = ${c.totalPapelitos}`, s: 'No se quedó nada sin contar.' };
  else if (c.malos) global = { c: 'mal', t: `✗ ${plural(c.malos, 'espacio no cuadra', 'espacios no cuadran')}`, s: 'Vuelve a contarlos o revisa su papelito.' };
  else global = { c: 'mal', t: `Faltan ${plural(c.pendientes, 'espacio', 'espacios')}`, s: 'Cuenta y pasa los papelitos que faltan.' };

  return (
    <>
      <div className="ig-kpis">
        <div className="ig-kpi">
          <span>Suma de los papelitos</span>
          <b>{c.totalPapelitos}</b>
        </div>
        <div className="ig-kpi">
          <span>Tu conteo</span>
          <b>{c.totalConteo}</b>
        </div>
        <div className={`ig-kpi ${global.c}`}>
          <span>Total general</span>
          <b>{global.t}</b>
          <span>{global.s}</span>
        </div>
      </div>

      <div className="card">
        <h2>1 · Cuadre por mueble</h2>
        <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>Toca un mueble para ver cada espacio.</div>
        <div className="ig-tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Mueble</th>
                <th className="num">Papelitos</th>
                <th className="num">Tu conteo</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {c.porMueble.map((x) => {
                const abiertoEste = abierto === x.mueble.id;
                const primeroMal = x.espacios.find((s) => s.estado !== 'ok');
                const estado = x.listo
                  ? { c: 'bien', t: '✓ Cuadra' }
                  : x.malos
                  ? { c: 'mal', t: `✗ ${plural(x.malos, 'espacio no cuadra', 'espacios no cuadran')}` }
                  : { c: 'gris', t: `Faltan ${plural(x.pendientes, 'espacio', 'espacios')}` };
                return [
                  <tr key={x.mueble.id} className="ig-fila-mueble" onClick={() => setAbierto(abiertoEste ? null : x.mueble.id)}>
                    <td style={{ fontWeight: 800, fontSize: 15 }}>
                      {abiertoEste ? '▾' : '▸'} {x.mueble.nombre}
                    </td>
                    <td className="num">{x.papelitos}</td>
                    <td className="num">{x.mueble.tipo === 'deudas' ? 'cuaderno' : x.conteo}</td>
                    <td>
                      <span className={`ig-estado ${estado.c}`}>{estado.t}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {primeroMal && (
                        <button
                          className="btn ghost sm"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onContar(x.mueble.id, primeroMal.i, primeroMal.j);
                          }}
                        >
                          {x.malos ? 'Revisar' : 'Contar'}
                        </button>
                      )}
                    </td>
                  </tr>,
                  abiertoEste && (
                    <tr key={x.mueble.id + '-d'}>
                      <td colSpan={5}>
                        <div className="ig-detalle">
                          <div>
                            {x.espacios.map((s) => {
                              const refs = Object.entries(s.e?.pap || {});
                              const suma = sumaPapelito(s.e?.pap);
                              return (
                                <div
                                  key={s.i + '_' + s.j}
                                  className={`ig-esp ${s.estado === 'mal' ? 'mal' : s.estado === 'ok' ? '' : 'pend'}`}
                                  onClick={() => onContar(x.mueble.id, s.i, s.j)}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <span className="ig-esp-nombre">{s.nombre}</span>
                                  {x.mueble.tipo !== 'deudas' && (
                                    <span style={{ width: 92 }}>
                                      Contaste <b>{s.e?.n ?? '—'}</b>
                                    </span>
                                  )}
                                  <span style={{ flex: 1 }}>
                                    {refs.length
                                      ? refs.map(([id, n]) => `${c.nombres[id] || id} × ${n}`).join(' · ') + (refs.length > 1 && s.estado === 'mal' ? ` = ${suma}` : '')
                                      : s.estado === 'ok'
                                      ? 'vacío'
                                      : 'sin papelito'}
                                  </span>
                                  <b>{s.estado === 'ok' ? '✓' : s.estado === 'mal' ? '✗' : ''}</b>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ maxWidth: 380 }}>
                            <DibujoMueble
                              mueble={x.mueble}
                              tam="medio"
                              valor={(a, b) => x.espacios.find((s) => s.i === a && s.j === b)?.e?.n ?? null}
                              estado={(a, b) => x.espacios.find((s) => s.i === a && s.j === b)?.estado ?? null}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`card ${c.todoCuadra ? '' : 'ig-bloqueado'}`}>
        <h2>2 · Contra el sistema, por referencia</h2>
        <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
          {c.todoCuadra
            ? `Sistema = el stock que había al empezar (${inv.fecha}, ${inv.hora}).`
            : 'Se abre cuando todos los espacios cuadren.'}
          {movidas.length > 0 && c.todoCuadra && ' Desde que empezaste se movieron prendas (ventas, cambios…): el ajuste ya lo tiene en cuenta.'}
        </div>
        <div className="ig-tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Referencia</th>
                <th className="num">Contado</th>
                <th className="num">Sistema</th>
                <th className="num">Diferencia</th>
                <th className="num">A costo</th>
                <th className="num">Movido después</th>
              </tr>
            </thead>
            <tbody>
              {c.porRef.map((r) => {
                const lugares = Object.entries(r.donde);
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 800 }}>{r.nombre}</td>
                    <td className="num">
                      <b>{r.contado}</b>
                      {lugares.length > 1 && <span className="ig-donde">{lugares.map(([l, n]) => `${l} ${n}`).join(' · ')}</span>}
                    </td>
                    <td className="num">{r.sistema}</td>
                    <td className="num">
                      <span className={`ig-estado ${r.dif === 0 ? 'bien' : r.dif < 0 ? 'mal' : 'cian'}`}>
                        {r.dif === 0 ? '✓ 0' : r.dif > 0 ? `+${r.dif}` : `−${-r.dif}`}
                      </span>
                    </td>
                    <td className="num">{r.dif === 0 ? '—' : pesos(r.plata)}</td>
                    <td className="num">{r.movido === 0 ? '—' : r.movido > 0 ? `+${r.movido}` : r.movido}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {c.desconocidas.length > 0 && (
          <div className="msg bad">Hay papelitos con referencias que ya no existen en el inventario; no se tienen en cuenta.</div>
        )}
        <div className="ig-resumen">
          <div style={{ background: '#fbe9ee', color: '#b9566f' }}>
            <span>Faltan</span>
            <b>
              {plural(c.faltan, 'prenda', 'prendas')} · {pesos(-c.plataFaltan)}
            </b>
          </div>
          <div style={{ background: 'var(--cian-suave)', color: 'var(--cian-fuerte)' }}>
            <span>Sobran</span>
            <b>
              {plural(c.sobran, 'prenda', 'prendas')} · {pesos(c.plataSobran)}
            </b>
          </div>
          <div style={{ border: '1px solid var(--line)' }}>
            <span style={{ color: 'var(--ink-soft)' }}>Neto del inventario</span>
            <b>
              {plural(c.sobran - c.faltan, 'prenda', 'prendas')} · {pesos(c.plataSobran - c.plataFaltan)}
            </b>
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ maxWidth: 640 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            {aprobando
              ? `Ajustando… ${aprobando.hechas} de ${aprobando.total}`
              : confirmando
              ? '¿Seguro? Esto cambia el stock'
              : c.todoCuadra
              ? 'Todo cuadra. Revisa las diferencias con el sistema'
              : 'Todavía no se puede aprobar'}
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {confirmando
              ? `Se ajustan ${plural(conDif.length, 'referencia', 'referencias')}. Cada una queda en Entradas y salidas con el motivo «Inventario general» (desde ahí se puede anular). Solo se suma o resta la diferencia, así lo vendido después de empezar queda bien.`
              : c.todoCuadra
              ? 'Si algo no te convence, revisa esa referencia antes de aprobar.'
              : 'Primero tienen que cuadrar todos los espacios: tu conteo contra su papelito.'}
          </div>
          {msg && <div className="msg bad" style={{ textAlign: 'left' }}>{msg}</div>}
        </div>
        <div className="ig-acciones">
          <button className="btn ghost sm" onClick={() => descargarExcelInventario({ inv, cuadre: c })}>
            Descargar Excel
          </button>
          {!confirmando && !aprobando && (
            <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={cancelar}>
              Cancelar inventario
            </button>
          )}
          {confirmando && !aprobando && (
            <button className="btn ghost" onClick={() => setConfirmando(false)}>
              Volver
            </button>
          )}
          <button
            className="btn"
            disabled={!c.todoCuadra || !!aprobando}
            onClick={() => (confirmando ? aprobar() : setConfirmando(true))}
          >
            {aprobando ? 'Ajustando…' : confirmando ? `Sí, ajustar ${plural(conDif.length, 'referencia', 'referencias')}` : 'Aprobar y ajustar el stock'}
          </button>
        </div>
      </div>
    </>
  );
}
