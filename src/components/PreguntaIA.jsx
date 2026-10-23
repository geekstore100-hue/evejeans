import { Fragment, useEffect, useRef, useState } from 'react';
import { suscribirConfig, guardarConfig } from '../lib/config';
import { activarAppCheck, preguntarIA } from '../lib/ia';

// Tarjeta "Pregúntale a la IA" (Reportes, solo Nelson). Le manda a Gemini un
// resumen de los números del período (sin nombres de personas) y la pregunta,
// y muestra la respuesta a medida que llega. Se puede seguir preguntando
// sobre lo mismo; al cambiar de período, la conversación vuelve a empezar.

const SUGERENCIAS = [
  '¿Por qué cambió la ganancia?',
  '¿Qué referencias debería comprar más y cuáles menos?',
  '¿Qué días y a qué horas necesito más personal?',
  'Dame un resumen del período en pocas palabras',
];

// Markdown mínimo: viñetas "- " y **negrilla**. Todo lo demás, texto plano.
function Negrillas({ texto, nombres }) {
  let t = texto;
  Object.entries(nombres).forEach(([alias, real]) => {
    t = t.split(alias).join(real);
  });
  const partes = t.split(/\*\*(.+?)\*\*/g);
  return partes.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <Fragment key={i}>{p.replace(/\*/g, '')}</Fragment>));
}
function Respuesta({ texto, nombres }) {
  const bloques = [];
  texto.split('\n').forEach((linea) => {
    const l = linea.trim();
    if (!l) return;
    const vineta = l.match(/^[-*•]\s+(.*)$/);
    if (vineta) {
      const ult = bloques[bloques.length - 1];
      if (ult && ult.tipo === 'lista') ult.items.push(vineta[1]);
      else bloques.push({ tipo: 'lista', items: [vineta[1]] });
    } else bloques.push({ tipo: 'p', texto: l.replace(/^#+\s*/, '') });
  });
  return bloques.map((b, i) =>
    b.tipo === 'lista' ? (
      <ul key={i}>
        {b.items.map((x, j) => (
          <li key={j}>
            <Negrillas texto={x} nombres={nombres} />
          </li>
        ))}
      </ul>
    ) : (
      <p key={i}>
        <Negrillas texto={b.texto} nombres={nombres} />
      </p>
    )
  );
}

export default function PreguntaIA({ resumen, nombres, reiniciarCon, puedeConfigurar = true }) {
  const [config, setConfig] = useState(null);
  const [mensajes, setMensajes] = useState([]); // [{ rol: 'yo'|'ia', texto, error? }]
  const [pregunta, setPregunta] = useState('');
  const [pensando, setPensando] = useState(false);
  const [clave, setClave] = useState('');
  const [guardandoClave, setGuardandoClave] = useState(false);
  const [msgClave, setMsgClave] = useState('');
  const finRef = useRef(null);

  useEffect(() => suscribirConfig(setConfig, () => setConfig({})), []);
  const claveSitio = config?.iaClaveSitio || '';
  useEffect(() => {
    if (claveSitio) activarAppCheck(claveSitio);
  }, [claveSitio]);

  // Otro período = otra conversación.
  useEffect(() => {
    setMensajes([]);
  }, [reiniciarCon]);

  useEffect(() => {
    if (mensajes.length) finRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [mensajes]);

  async function enviar(texto) {
    const q = (texto ?? pregunta).trim();
    if (!q || pensando) return;
    setPregunta('');
    // La primera pregunta va con los datos; las siguientes ya los tienen en
    // la conversación.
    const previos = mensajes.filter((m) => !m.error && !m.fallida);
    const conDatos = previos.length
      ? q
      : `Datos de la tienda (JSON):\n${JSON.stringify(resumen)}\n\nPregunta de Nelson: ${q}`;
    const historial = previos.map((m, i) => (i === 0 ? { ...m, texto: m.textoEnviado || m.texto } : m));
    setMensajes((ms) => [...ms.filter((m) => !m.error && !m.fallida), { rol: 'yo', texto: q, textoEnviado: conDatos }, { rol: 'ia', texto: '' }]);
    setPensando(true);
    const poner = (t, error, detalle) =>
      setMensajes((ms) => {
        const copia = ms.slice();
        copia[copia.length - 1] = { rol: 'ia', texto: t, error, detalle };
        // Una pregunta sin respuesta no se manda en la conversación siguiente.
        if (error) copia[copia.length - 2] = { ...copia[copia.length - 2], fallida: true };
        return copia;
      });
    try {
      await preguntarIA({ historial, pregunta: conDatos, onTexto: (t) => poner(t) });
    } catch (e) {
      poner(e.message, true, e.detalle);
    } finally {
      setPensando(false);
    }
  }

  async function guardarClave() {
    const c = clave.trim();
    if (!c) return;
    setGuardandoClave(true);
    setMsgClave('');
    try {
      await guardarConfig({ iaClaveSitio: c });
      setClave('');
    } catch (e) {
      setMsgClave('No se pudo guardar: ' + e.message);
    } finally {
      setGuardandoClave(false);
    }
  }

  if (!config) return null;

  return (
    <section className="rp-tarjeta ancha rp-ia">
      <div className="rp-tarjeta-top">
        <h3>
          Pregúntale a la IA <span className="rp-ia-marca">Gemini</span>
        </h3>
      </div>

      {!claveSitio && !puedeConfigurar ? (
        <p className="rp-lectura">La IA todavía no está encendida. Nelson tiene que terminar de configurarla.</p>
      ) : !claveSitio ? (
        <div className="rp-ia-config">
          <p>
            Falta un paso para encender la IA: pega aquí la <b>clave del sitio de reCAPTCHA</b> que creaste para App Check. Se hace una sola
            vez.
          </p>
          <div className="rp-ia-fila">
            <input
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="Clave del sitio (empieza por 6L…)"
              aria-label="Clave del sitio de reCAPTCHA"
              spellCheck={false}
            />
            <button className="rp-btn" onClick={guardarClave} disabled={!clave.trim() || guardandoClave}>
              {guardandoClave ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          {msgClave && <p className="msg bad">{msgClave}</p>}
        </div>
      ) : (
        <>
          <p className="rp-lectura">Pregunta lo que quieras sobre este período. La IA ve los mismos números de esta pantalla.</p>

          {mensajes.length > 0 && (
            <div className="rp-ia-chat" aria-live="polite">
              {mensajes.map((m, i) =>
                m.rol === 'yo' ? (
                  <div key={i} className="rp-ia-yo">
                    {m.texto}
                  </div>
                ) : (
                  <div key={i} className={`rp-ia-resp ${m.error ? 'error' : ''}`}>
                    {m.texto ? m.error ? (
                      <>
                        <p>{m.texto}</p>
                        {m.detalle && <p className="rp-ia-detalle">Detalle técnico: {m.detalle}</p>}
                      </>
                    ) : <Respuesta texto={m.texto} nombres={nombres} /> : <p className="rp-ia-pensando">Pensando…</p>}
                  </div>
                )
              )}
              <div ref={finRef} />
            </div>
          )}

          {mensajes.length === 0 && (
            <div className="rp-ia-sugerencias">
              {SUGERENCIAS.map((s) => (
                <button key={s} className="rp-chip" onClick={() => enviar(s)} disabled={pensando}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="rp-ia-fila"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <input
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              placeholder={mensajes.length ? 'Pregunta algo más…' : 'Escribe tu pregunta…'}
              aria-label="Tu pregunta para la IA"
              disabled={pensando}
            />
            <button className="rp-btn" type="submit" disabled={!pregunta.trim() || pensando}>
              {pensando ? '…' : 'Preguntar'}
            </button>
            {mensajes.length > 0 && (
              <button type="button" className="rp-btn sec" onClick={() => setMensajes([])} disabled={pensando}>
                Empezar de nuevo
              </button>
            )}
          </form>
          <p className="rp-ia-nota">
            Se envía a Google un resumen de los números del período, sin nombres de personas. En el plan gratis, Google puede usarlo para mejorar
            sus productos y personas pueden revisarlo. La IA puede equivocarse: los números exactos son los de esta pantalla.
          </p>
        </>
      )}
    </section>
  );
}
