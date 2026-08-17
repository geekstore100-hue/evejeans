import { useEffect, useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { suscribirInventario } from '../lib/inventario';
import { suscribirConfig, guardarConfig } from '../lib/config';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function Inventario() {
  const [items, setItems] = useState(null);
  const [cambios, setCambios] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
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

  useEffect(() => {
    const quitar = suscribirInventario(setItems, (err) =>
      setMsg({ tipo: 'bad', texto: 'No se pudo leer el inventario: ' + err.message })
    );
    return quitar;
  }, []);

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

  async function guardar() {
    setGuardando(true);
    setMsg({ tipo: '', texto: '' });
    try {
      const batch = writeBatch(db);
      let n = 0;
      Object.entries(cambios).forEach(([id, campos]) => {
        const datos = {};
        if (campos.stock !== undefined && campos.stock !== '') {
          const v = parseInt(campos.stock);
          if (!isNaN(v) && v >= 0) datos.stock = v;
        }
        if (campos.price !== undefined && campos.price !== '') {
          const v = parseInt(campos.price);
          if (!isNaN(v) && v >= 0) datos.price = v;
        }
        if (Object.keys(datos).length > 0) {
          batch.update(doc(db, 'inventario', id), datos);
          n++;
        }
      });
      await batch.commit();
      setCambios({});
      setMsg({ tipo: 'good', texto: `Guardado. ${n} referencia${n === 1 ? '' : 's'} actualizada${n === 1 ? '' : 's'}.` });
    } catch (e) {
      setMsg({ tipo: 'bad', texto: 'No se pudo guardar: ' + e.message });
    } finally {
      setGuardando(false);
    }
  }

  if (!items) return <div className="loading">Cargando…</div>;

  const nombreItems = items.filter((i) => i.tipo === 'nombre');
  const precioItems = items.filter((i) => i.tipo === 'precio');

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

      <div className="card" style={{ maxWidth: 720 }}>
        <h2>
          Inventario <span className="side">{items.reduce((s, i) => s + (i.stock || 0), 0)} prendas</span>
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          Escribe el conteo físico real en "Stock". Si necesitas cambiar el precio de venta de
          una referencia, también lo puedes hacer aquí — las ventas ya hechas conservan el
          precio con el que se vendieron, no se reescriben.
        </p>

        <TablaInventario titulo="Con nombre" lista={nombreItems} valorActual={valorActual} cambiar={cambiar} />
        <TablaInventario titulo="Por precio" lista={precioItems} valorActual={valorActual} cambiar={cambiar} />

        <button className="btn" disabled={!hayCambios || guardando} onClick={guardar} style={{ marginTop: 14 }}>
          {guardando ? 'Guardando…' : hayCambios ? 'Guardar cambios' : 'Sin cambios pendientes'}
        </button>
        {msg.texto && <div className={`msg ${msg.tipo}`}>{msg.texto}</div>}
      </div>
    </div>
  );
}

function TablaInventario({ titulo, lista, valorActual, cambiar }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="split-label">{titulo}</div>
      <div className="inv-tabla">
        <div className="inv-fila inv-header">
          <span>Referencia</span>
          <span>Precio</span>
          <span>Stock</span>
        </div>
        {lista.map((it) => (
          <div className="inv-fila" key={it.id}>
            <span className="inv-nombre">{it.name}</span>
            <input
              type="number"
              inputMode="numeric"
              value={valorActual(it, 'price')}
              onChange={(e) => cambiar(it.id, 'price', e.target.value)}
            />
            <input
              type="number"
              inputMode="numeric"
              value={valorActual(it, 'stock')}
              onChange={(e) => cambiar(it.id, 'stock', e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
