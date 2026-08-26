import { useEffect, useState } from 'react';
import { doc, setDoc, updateDoc, writeBatch, collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { suscribirInventario } from '../lib/inventario';
import { suscribirConfig, guardarConfig } from '../lib/config';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}
function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function ahoraStr() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export default function Inventario() {
  const [items, setItems] = useState(null);
  const [cambios, setCambios] = useState({}); // {id: {stock?, price?}}
  const [revisando, setRevisando] = useState(false); // paso de confirmación
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [historial, setHistorial] = useState(null);

  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');
  const [nuevoCosto, setNuevoCosto] = useState('');
  const [nuevoTipo, setNuevoTipo] = useState('precio');
  const [creandoRef, setCreandoRef] = useState(false);
  const [msgNueva, setMsgNueva] = useState({ tipo: '', texto: '' });

  const [config, setConfig] = useState(null);
  const [cfgMin, setCfgMin] = useState('');
  const [cfgVal, setCfgVal] = useState('');
  const [guardandoCfg, setGuardandoCfg] = useState(false);

  useEffect(() => {
    const quitar = suscribirConfig((c) => {
      setConfig(c);
      setCfgMin(String(c.comisionMinimo));
      setCfgVal(String(c.comisionValor));
    });
    return quitar;
  }, []);

  useEffect(() => {
    const quitar = suscribirInventario(setItems, (err) =>
      setMsg({ tipo: 'bad', texto: 'No se pudo leer el inventario: ' + err.message })
    );
    return quitar;
  }, []);

  useEffect(() => {
    cargarHistorial();
  }, []);

  async function cargarHistorial() {
    try {
      const snap = await getDocs(collection(db, 'ajustesInventario'));
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
        .slice(0, 15);
      setHistorial(lista);
    } catch (e) {
      setHistorial([]);
    }
  }

  async function guardarComision() {
    setGuardandoCfg(true);
    try {
      await guardarConfig({
        ...config,
        comisionMinimo: parseInt(cfgMin) || 6,
        comisionValor: parseInt(cfgVal) || 1000,
      });
      setMsg({ tipo: 'good', texto: 'Comisión actualizada.' });
    } catch (e) {
      setMsg({ tipo: 'bad', texto: 'No se pudo guardar: ' + e.message });
    } finally {
      setGuardandoCfg(false);
    }
  }

  async function toggleConteo() {
    try {
      await guardarConfig({ ...config, conteoActivado: !config.conteoActivado });
    } catch (e) {
      setMsg({ tipo: 'bad', texto: 'No se pudo cambiar: ' + e.message });
    }
  }

  function slugDe(nombre) {
    return (
      nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '') || 'ref'
    );
  }

  async function crearReferencia() {
    setMsgNueva({ tipo: '', texto: '' });
    const nombre = nuevoNombre.trim();
    const precio = parseInt(nuevoPrecio);
    const costo = parseInt(nuevoCosto) || 0;
    if (!nombre) {
      setMsgNueva({ tipo: 'bad', texto: 'Falta el nombre.' });
      return;
    }
    if (isNaN(precio) || precio <= 0) {
      setMsgNueva({ tipo: 'bad', texto: 'Falta el precio de venta.' });
      return;
    }
    let id = slugDe(nombre);
    if (items.some((i) => i.id === id)) {
      id = id + '-' + Date.now().toString().slice(-4);
    }
    setCreandoRef(true);
    try {
      await setDoc(doc(db, 'inventario', id), {
        name: nombre,
        price: precio,
        costoCompra: costo,
        tipo: nuevoTipo,
        stock: 0,
        oculto: false,
      });
      setNuevoNombre('');
      setNuevoPrecio('');
      setNuevoCosto('');
      setMsgNueva({ tipo: 'good', texto: `"${nombre}" creada, con stock en 0.` });
    } catch (e) {
      setMsgNueva({ tipo: 'bad', texto: 'No se pudo crear: ' + e.message });
    } finally {
      setCreandoRef(false);
    }
  }

  async function toggleOcultar(item) {
    try {
      await updateDoc(doc(db, 'inventario', item.id), { oculto: !item.oculto });
    } catch (e) {
      setMsg({ tipo: 'bad', texto: 'No se pudo cambiar: ' + e.message });
    }
  }

  function valorActual(item, campo) {
    if (cambios[item.id] && cambios[item.id][campo] !== undefined) {
      return cambios[item.id][campo];
    }
    return item[campo];
  }

  function cambiar(id, campo, valor) {
    setCambios((c) => ({
      ...c,
      [id]: { ...c[id], [campo]: valor },
    }));
  }

  const hayCambios = Object.keys(cambios).length > 0;

  // Lista de cambios reales (comparados contra el valor original) para la pantalla de revisión.
  // El stock ya NO se edita desde acá — eso ahora pasa por "Entradas y salidas",
  // que deja motivo, categoría y queda agrupado por día.
  function listaCambiosReales() {
    const lista = [];
    Object.entries(cambios).forEach(([id, campos]) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      if (campos.price !== undefined && campos.price !== '') {
        const v = parseInt(campos.price);
        if (!isNaN(v) && v >= 0 && v !== item.price) {
          lista.push({ id, nombre: item.name, campo: 'Precio', anterior: item.price, nuevo: v, esPrecio: true });
        }
      }
      if (campos.costoCompra !== undefined && campos.costoCompra !== '') {
        const v = parseInt(campos.costoCompra);
        const anterior = item.costoCompra || 0;
        if (!isNaN(v) && v >= 0 && v !== anterior) {
          lista.push({ id, nombre: item.name, campo: 'Costo de compra', anterior, nuevo: v, esPrecio: true });
        }
      }
    });
    return lista;
  }

  function irARevisar() {
    if (listaCambiosReales().length === 0) {
      setMsg({ tipo: 'bad', texto: 'No hay ningún cambio real que guardar.' });
      return;
    }
    setMsg({ tipo: '', texto: '' });
    setRevisando(true);
  }

  async function confirmarGuardado() {
    const lista = listaCambiosReales();
    if (lista.length === 0) return;
    if (!motivo.trim()) {
      setMsg({ tipo: 'bad', texto: 'Escribe por qué se hace este ajuste.' });
      return;
    }
    setGuardando(true);
    setMsg({ tipo: '', texto: '' });
    try {
      const batch = writeBatch(db);
      lista.forEach((c) => {
        const campo = c.campo === 'Stock' ? 'stock' : c.campo === 'Precio' ? 'price' : 'costoCompra';
        batch.update(doc(db, 'inventario', c.id), { [campo]: c.nuevo });
      });
      await batch.commit();

      await addDoc(collection(db, 'ajustesInventario'), {
        fecha: hoyStr(),
        hora: ahoraStr(),
        usuarioNombre: 'Nelson',
        motivo: motivo.trim(),
        cambios: lista.map((c) => ({ nombre: c.nombre, campo: c.campo, anterior: c.anterior, nuevo: c.nuevo })),
        creadoEn: serverTimestamp(),
      });

      setCambios({});
      setMotivo('');
      setRevisando(false);
      setMsg({ tipo: 'good', texto: `Guardado. ${lista.length} cambio${lista.length === 1 ? '' : 's'} aplicado${lista.length === 1 ? '' : 's'}.` });
      cargarHistorial();
    } catch (e) {
      setMsg({ tipo: 'bad', texto: 'No se pudo guardar: ' + e.message });
    } finally {
      setGuardando(false);
    }
  }

  function cancelarRevision() {
    setRevisando(false);
  }

  if (!items) return <div className="loading">Cargando…</div>;

  const nombreItems = items.filter((i) => i.tipo === 'nombre');
  const precioItems = items.filter((i) => i.tipo === 'precio');

  if (revisando) {
    const lista = listaCambiosReales();
    return (
      <div style={{ padding: '0 4px' }}>
        <div className="card" style={{ maxWidth: 560 }}>
          <h2>Revisa antes de guardar</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
            Confirma que estos son los cambios correctos.
          </p>
          {lista.map((c, i) => (
            <div className="kv" key={i}>
              <span>
                {c.nombre} <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>({c.campo})</span>
              </span>
              <span className="v">
                {c.esPrecio ? fmt(c.anterior) : c.anterior} → <b>{c.esPrecio ? fmt(c.nuevo) : c.nuevo}</b>
              </span>
            </div>
          ))}

          <div className="field" style={{ marginTop: 14 }}>
            <label>¿Por qué se hace este ajuste?</label>
            <input
              type="text"
              placeholder="Ej: conteo físico semanal, corrección de digitación…"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              autoFocus
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={cancelarRevision} disabled={guardando}>
              Volver y corregir
            </button>
            <button className="btn" onClick={confirmarGuardado} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Confirmar y guardar'}
            </button>
          </div>
          {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <div className="card" style={{ maxWidth: 460, marginBottom: 12 }}>
        <h2>Comisión</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          Se paga cuando el local vende esta cantidad de prendas o más en el día, sumando a
          todas las vendedoras. Ellas se reparten el total.
        </p>
        <div className="field">
          <label>Desde cuántas prendas</label>
          <input type="number" value={cfgMin} onChange={(e) => setCfgMin(e.target.value)} />
        </div>
        <div className="field">
          <label>Valor por prenda</label>
          <input type="number" value={cfgVal} onChange={(e) => setCfgVal(e.target.value)} />
        </div>
        <button className="btn ghost" disabled={guardandoCfg} onClick={guardarComision}>
          {guardandoCfg ? 'Guardando…' : 'Guardar comisión'}
        </button>
      </div>

      <div className="card" style={{ maxWidth: 460, marginBottom: 12 }}>
        <h2>Conteo de inicio de semana</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          Le pide a Blanca contar 2 referencias al azar el primer día hábil de cada semana
          (respetando festivos). Es solo un aviso — nunca bloquea la venta.
        </p>
        <div className="kv" style={{ borderBottom: 'none' }}>
          <span>Estado actual</span>
          <span className="v" style={{ color: config?.conteoActivado === false ? 'var(--danger)' : 'var(--ok)' }}>
            {config?.conteoActivado === false ? 'Desactivado' : 'Activado'}
          </span>
        </div>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={toggleConteo}>
          {config?.conteoActivado === false ? 'Activar' : 'Desactivar'}
        </button>
      </div>

      <div className="card" style={{ maxWidth: 460, marginBottom: 12 }}>
        <h2>Agregar una referencia nueva</h2>
        <div className="field">
          <label>Nombre</label>
          <input type="text" placeholder="Ej: Camisa Oxford" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Precio de venta</label>
            <input type="number" inputMode="numeric" value={nuevoPrecio} onChange={(e) => setNuevoPrecio(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Costo de compra</label>
            <input type="number" inputMode="numeric" value={nuevoCosto} onChange={(e) => setNuevoCosto(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>¿Dónde va a aparecer al vender?</label>
          <div className="chips">
            <button className={`chip ${nuevoTipo === 'nombre' ? 'on' : ''}`} onClick={() => setNuevoTipo('nombre')}>Con nombre</button>
            <button className={`chip ${nuevoTipo === 'precio' ? 'on' : ''}`} onClick={() => setNuevoTipo('precio')}>Por precio</button>
          </div>
        </div>
        <button className="btn" disabled={creandoRef} onClick={crearReferencia}>
          {creandoRef ? 'Creando…' : 'Crear referencia'}
        </button>
        {msgNueva.texto && <div className={`msg ${msgNueva.tipo}`}>{msgNueva.texto}</div>}
        <div className="hint" style={{ fontSize: 12 }}>
          Nace con stock en 0. Se carga con una compra, o desde "Entradas y salidas" (pestaña de
          arriba) eligiendo "Entrada".
        </div>
      </div>

      <div className="card" style={{ maxWidth: 720, marginBottom: 12 }}>
        <h2>
          Inventario <span className="side">{items.reduce((s, i) => s + (i.stock || 0), 0)} prendas</span>
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          Aquí solo se ajustan precio y costo. El stock (cuánto hay de cada una) se mueve desde
          la pestaña "Entradas y salidas" — deja motivo y queda agrupado por día.
        </p>

        <TablaInventario titulo="Con nombre" lista={nombreItems} valorActual={valorActual} cambiar={cambiar} onOcultar={toggleOcultar} />
        <TablaInventario titulo="Por precio" lista={precioItems} valorActual={valorActual} cambiar={cambiar} onOcultar={toggleOcultar} />

        <button className="btn" disabled={!hayCambios} onClick={irARevisar} style={{ marginTop: 14 }}>
          {hayCambios ? 'Revisar y guardar' : 'Sin cambios pendientes'}
        </button>
        {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <h2>Historial de ajustes</h2>
        {!historial ? (
          <div className="empty-lines">Cargando…</div>
        ) : historial.length === 0 ? (
          <div className="empty-lines">Todavía no hay ajustes guardados.</div>
        ) : (
          historial.map((h) => (
            <div key={h.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {h.fecha} {h.hora} · {h.motivo}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3 }}>
                {h.cambios.map((c, i) => (
                  <div key={i}>
                    {c.nombre} ({c.campo}): {c.campo !== 'Stock' ? fmt(c.anterior) : c.anterior} → {c.campo !== 'Stock' ? fmt(c.nuevo) : c.nuevo}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TablaInventario({ titulo, lista, valorActual, cambiar, onOcultar }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="split-label">{titulo}</div>
      <div className="inv-tabla">
        <div className="inv-fila inv-header" style={{ gridTemplateColumns: '1fr 120px 120px 80px 80px' }}>
          <span>Referencia</span>
          <span>Precio venta</span>
          <span>Costo compra</span>
          <span>Stock</span>
          <span></span>
        </div>
        {lista.map((it) => (
          <div className="inv-fila" key={it.id} style={{ gridTemplateColumns: '1fr 120px 120px 80px 80px', opacity: it.oculto ? 0.5 : 1 }}>
            <span className="inv-nombre">{it.name}</span>
            <div>
              <input
                type="number"
                inputMode="numeric"
                value={valorActual(it, 'price')}
                onChange={(e) => cambiar(it.id, 'price', e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>era: {fmt(it.price)}</div>
            </div>
            <div>
              <input
                type="number"
                inputMode="numeric"
                value={valorActual(it, 'costoCompra') || 0}
                onChange={(e) => cambiar(it.id, 'costoCompra', e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>era: {fmt(it.costoCompra || 0)}</div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, paddingTop: 8, textAlign: 'center' }}>{it.stock || 0}</div>
            <button className="btn ghost sm" style={{ width: 'auto', height: 'fit-content' }} onClick={() => onOcultar(it)}>
              {it.oculto ? 'Mostrar' : 'Ocultar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
