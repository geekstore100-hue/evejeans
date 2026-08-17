import { forwardRef, useEffect, useState } from 'react';

// Cuadro de búsqueda que filtra la lista en vivo, resalta una coincidencia con
// flechas izquierda/derecha, y agrega con Enter. Nunca hace falta el touchpad.
export function useBuscadorFiltro(nombreItemsTodos, precioItemsTodos) {
  const [busqueda, setBusqueda] = useState('');
  const [busquedaMsg, setBusquedaMsg] = useState('');
  const [selIndex, setSelIndex] = useState(0);

  const textoFiltro = busqueda.trim().toLowerCase();
  function filtrarLista(lista) {
    if (!textoFiltro) return lista;
    const porPrefijo = lista.filter((i) => i.name.toLowerCase().startsWith(textoFiltro));
    if (porPrefijo.length > 0) return porPrefijo;
    return lista.filter((i) => i.name.toLowerCase().includes(textoFiltro));
  }
  const nombreItems = filtrarLista(nombreItemsTodos);
  const precioItems = filtrarLista(precioItemsTodos);
  const combinados = [...nombreItems, ...precioItems];

  useEffect(() => {
    setSelIndex(0);
  }, [busqueda]);

  function manejarTecla(e, onElegir) {
    if (e.key === 'Tab') {
      // Mientras haya texto escrito y más de una coincidencia, el mismo Tab
      // recorre las coincidencias en vez de saltar al siguiente campo.
      if (textoFiltro && combinados.length > 1) {
        e.preventDefault();
        setSelIndex((i) => {
          const total = combinados.length;
          return e.shiftKey ? (i - 1 + total) % total : (i + 1) % total;
        });
      }
      // Sin texto, o con una sola coincidencia (o ninguna): Tab sigue su curso normal.
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = combinados[selIndex];
      if (!item) {
        setBusquedaMsg('No se encontró ninguna prenda con ese nombre.');
        return;
      }
      const ok = onElegir(item);
      if (ok === false) return;
      setBusqueda('');
      setBusquedaMsg('');
    }
  }

  return { busqueda, setBusqueda, busquedaMsg, setBusquedaMsg, nombreItems, precioItems, combinados, selIndex, manejarTecla };
}

export const CuadroBusqueda = forwardRef(function CuadroBusqueda(
  { placeholder, busqueda, setBusqueda, busquedaMsg, setBusquedaMsg, onKeyDown, autoFocus, tabIndex },
  ref
) {
  return (
    <>
      <input
        ref={ref}
        type="text"
        placeholder={placeholder || 'Escribe para filtrar · flechas para elegir · Enter para agregar'}
        value={busqueda}
        onChange={(e) => { setBusqueda(e.target.value); setBusquedaMsg(''); }}
        onKeyDown={onKeyDown}
        style={{ marginBottom: 8 }}
        tabIndex={tabIndex}
        autoFocus={autoFocus}
      />
      {busquedaMsg && <div className="msg bad" style={{ textAlign: 'left', marginTop: -4, marginBottom: 8 }}>{busquedaMsg}</div>}
    </>
  );
});
