import { espaciosDe, etiquetaEspacio } from '../lib/inventarioGeneral';

// Dibuja un mueble con sus espacios (filas × secciones) según lo que es:
// estantería con sus tablas, vitrina, burro con barra y patas, maniquíes,
// bolsa o caja, cuaderno de deudas…
//
// tam: 'mini' (tarjetas), 'medio' (vista previa y cuadre), 'grande' (contar).
// valor(i, j) -> lo que se escribe en el espacio (o null).
// estado(i, j) -> 'ok' | 'mal' | 'papelito' | null, para colorear.
// sel: { i, j } del espacio elegido. onTocar(i, j) lo vuelve tocable.
export default function DibujoMueble({ mueble, tam = 'medio', valor, estado, sel, onTocar }) {
  const filas = [];
  const espacios = espaciosDe(mueble);
  for (let i = 0; i < mueble.filas; i++) filas.push(espacios.filter((e) => e.i === i));
  const Celda = onTocar ? 'button' : 'div';
  return (
    <div className={`ig-dibujo t-${mueble.tipo} s-${tam}`} aria-hidden={tam === 'mini' ? true : undefined}>
      <div className="ig-marco">
        {filas.map((fila, i) => (
          <div className="ig-fila" key={i}>
            {fila.map(({ j }) => {
              const v = valor ? valor(i, j) : null;
              const est = estado ? estado(i, j) : null;
              const esSel = sel && sel.i === i && sel.j === j;
              const lleno = v !== null && v !== undefined && v !== '';
              const clase = [
                'ig-celda',
                esSel ? 'sel' : '',
                est === 'ok' ? 'ok' : est === 'mal' ? 'mal' : est === 'papelito' ? 'falta-pap' : '',
                lleno ? 'lleno' : valor ? 'vacio' : 'vista',
              ].join(' ');
              const nombre = etiquetaEspacio(mueble, i, j);
              return (
                <Celda
                  key={j}
                  className={clase}
                  {...(onTocar ? { type: 'button', onClick: () => onTocar(i, j), 'aria-label': nombre, 'aria-pressed': !!esSel } : {})}
                >
                  {tam !== 'mini' && <span className="ig-celda-nombre">{nombre}</span>}
                  {tam !== 'mini' && valor && (
                    <span className="ig-celda-valor">
                      {lleno ? `${est === 'ok' ? '✓ ' : est === 'mal' ? '✗ ' : ''}${v}` : tam === 'grande' ? 'toca' : '—'}
                    </span>
                  )}
                </Celda>
              );
            })}
          </div>
        ))}
      </div>
      {mueble.tipo === 'burro' && <div className="ig-patas" />}
    </div>
  );
}
