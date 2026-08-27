import { useEffect, useState } from 'react';
import {
  MEDIOS_CONCILIABLES,
  totalSistemaPorMedio,
  subirExtractoPDF,
  registrarConciliacion,
  conciliacionesRecientes,
  subidaConfigurada,
} from '../lib/conciliaciones';

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}
function mesActualStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nombreMes(mesStr) {
  const [anio, mes] = mesStr.split('-').map(Number);
  const nombre = new Date(anio, mes - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

export default function Conciliacion({ usuario }) {
  const [medio, setMedio] = useState(MEDIOS_CONCILIABLES[0]);
  const [mes, setMes] = useState(mesActualStr());
  const [totalSistema, setTotalSistema] = useState(null);
  const [cargandoTotal, setCargandoTotal] = useState(false);

  const [archivo, setArchivo] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [errorSubida, setErrorSubida] = useState('');
  const [avisoIA, setAvisoIA] = useState('');

  const [comisionPct, setComisionPct] = useState('');
  const [totalExtracto, setTotalExtracto] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const [historial, setHistorial] = useState(null);

  useEffect(() => {
    cargarHistorial();
  }, []);

  useEffect(() => {
    setTotalSistema(null);
    setCargandoTotal(true);
    totalSistemaPorMedio(medio, mes)
      .then(setTotalSistema)
      .catch((e) => setMsg('No se pudo calcular el total del sistema: ' + e.message))
      .finally(() => setCargandoTotal(false));
  }, [medio, mes]);

  async function cargarHistorial() {
    try {
      setHistorial(await conciliacionesRecientes());
    } catch (e) {
      setMsg('No se pudo cargar el historial: ' + e.message);
    }
  }

  async function onSubirArchivo() {
    if (!archivo) return;
    setSubiendo(true);
    setErrorSubida('');
    setAvisoIA('');
    try {
      const { url, totalDetectado, razon } = await subirExtractoPDF(archivo, medio, mes);
      setPdfUrl(url);
      if (totalDetectado != null) {
        setTotalExtracto(String(totalDetectado));
        setAvisoIA('La IA leyó este total del PDF — revísalo antes de guardar.');
      } else {
        setAvisoIA(
          'No se pudo leer el total automáticamente' + (razon ? ` (${razon})` : '') + '. Escríbelo tú abajo.'
        );
      }
    } catch (e) {
      setErrorSubida(e.message);
    } finally {
      setSubiendo(false);
    }
  }

  const comisionNum = comisionPct !== '' && !isNaN(parseFloat(comisionPct)) ? parseFloat(comisionPct) : null;
  const totalEsperado =
    totalSistema != null && comisionNum != null ? totalSistema * (1 - comisionNum / 100) : totalSistema;

  async function onGuardar() {
    const monto = parseInt(totalExtracto);
    if (isNaN(monto)) {
      setMsg('Escribe el total que aparece en el extracto.');
      return;
    }
    setGuardando(true);
    setMsg('');
    try {
      const res = await registrarConciliacion({
        medio,
        mes,
        totalSistema: totalSistema || 0,
        comisionPct: comisionNum,
        totalExtracto: monto,
        pdfUrl,
        nota,
        usuario,
      });
      if (res.diferencia !== 0) {
        alert(
          `Ojo, no cuadró.\n\n${medio} — ${nombreMes(mes)}\n` +
            `Sistema (crudo): ${fmt(totalSistema)}\n` +
            (comisionNum != null ? `Esperado después de ${comisionNum}% de comisión: ${fmt(res.totalEsperado)}\n` : '') +
            `Extracto: ${fmt(monto)}\nDiferencia: ${
              res.diferencia > 0 ? 'el extracto tiene de más' : 'el extracto tiene de menos'
            } ${fmt(Math.abs(res.diferencia))}`
        );
      }
      setTotalExtracto('');
      setNota('');
      setArchivo(null);
      setPdfUrl(null);
      setAvisoIA('');
      await cargarHistorial();
    } catch (e) {
      setMsg('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="sale-grid">
      <div className="card">
        <h2>Conciliación de medios de pago</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          Compara lo que el sistema calculó ese mes contra el total del extracto que te manda cada
          entidad, para verificar que todos los movimientos estén bien.
        </p>

        <div className="field">
          <label>Medio de pago</label>
          <div className="chips">
            {MEDIOS_CONCILIABLES.map((m) => (
              <button key={m} className={`chip ${medio === m ? 'on' : ''}`} onClick={() => setMedio(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Mes del extracto</label>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} max={mesActualStr()} />
        </div>

        <div className="kv">
          <span>Total según el sistema ({nombreMes(mes)})</span>
          <span className="v">{cargandoTotal ? 'Calculando…' : fmt(totalSistema)}</span>
        </div>

        <div className="field">
          <label>Descuento total antes de que te llegue la plata — % (opcional)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="ej: 2.5"
            value={comisionPct}
            onChange={(e) => setComisionPct(e.target.value)}
          />
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '4px 0 0' }}>
            Súmale aquí cualquier cosa que {medio} le reste al total antes de que te llegue: la
            comisión de ellos, y el 4x1000 SOLO si ves que el extracto ya lo descuenta ahí mismo (si
            no aparece como línea en el extracto, es porque ese impuesto te lo cobran después, al
            mover la plata de tu cuenta bancaria — eso no tiene que ver con este extracto, se vería
            como un gasto aparte). Si no sabes el número exacto o el extracto viene en bruto, déjalo
            en blanco.
          </p>
        </div>

        {comisionNum != null && (
          <div className="kv">
            <span>Total esperado después de comisión</span>
            <span className="v">{cargandoTotal ? '…' : fmt(totalEsperado)}</span>
          </div>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label>PDF del extracto</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              setArchivo(e.target.files[0] || null);
              setPdfUrl(null);
              setErrorSubida('');
              setAvisoIA('');
            }}
          />
          {archivo && !pdfUrl && (
            <button className="btn ghost sm" style={{ width: 'auto', marginTop: 6 }} disabled={subiendo} onClick={onSubirArchivo}>
              {subiendo ? 'Subiendo y leyéndolo con IA…' : 'Subir y leer con IA'}
            </button>
          )}
          {pdfUrl && <div className="msg good">Archivo subido — quedó guardado.</div>}
          {avisoIA && <div className="msg" style={{ color: 'var(--rosa-fuerte)' }}>{avisoIA}</div>}
          {errorSubida && (
            <div className="msg bad">
              {errorSubida}
              {!subidaConfigurada() && (
                <>
                  <br />
                  Puedes seguir sin adjuntar el PDF — solo escribe el total abajo.
                </>
              )}
            </div>
          )}
        </div>

        <div className="field">
          <label>Total según el extracto{avisoIA ? ' (revisa lo que puso la IA)' : ''}</label>
          <input
            type="number"
            inputMode="numeric"
            value={totalExtracto}
            onChange={(e) => setTotalExtracto(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Nota (opcional)</label>
          <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>

        <button className="btn sm" style={{ width: 'auto' }} disabled={guardando} onClick={onGuardar}>
          {guardando ? 'Guardando…' : 'Guardar conciliación'}
        </button>
        {msg && <div className="msg bad">{msg}</div>}
      </div>

      <div className="ticket">
        <div className="card">
          <h2>Conciliaciones recientes</h2>
          {!historial ? (
            <div className="empty-lines">Cargando…</div>
          ) : historial.length === 0 ? (
            <div className="empty-lines">Todavía ninguna.</div>
          ) : (
            historial.map((c) => (
              <div key={c.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {c.medio} · {nombreMes(c.mes)}
                </div>
                <div style={{ fontSize: 12, color: c.diferencia ? 'var(--danger)' : 'var(--ink-soft)' }}>
                  {c.comisionPct != null ? (
                    <>
                      sistema {fmt(c.totalSistema)} · esperado (-{c.comisionPct}%) {fmt(c.totalEsperado)} / extracto{' '}
                      {fmt(c.totalExtracto)}
                    </>
                  ) : (
                    <>
                      sistema {fmt(c.totalSistema)} / extracto {fmt(c.totalExtracto)}
                    </>
                  )}
                  {c.diferencia ? ` · diferencia ${fmt(Math.abs(c.diferencia))}` : ' · cuadró'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                  {c.fecha} {c.hora} · {c.usuarioNombre}
                  {c.nota ? ` · ${c.nota}` : ''}
                  {c.pdfUrl && (
                    <>
                      {' · '}
                      <a href={c.pdfUrl} target="_blank" rel="noreferrer">
                        Ver PDF
                      </a>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
