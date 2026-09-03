import { useEffect, useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import {
  asegurarPlanillasPendientes,
  planillasPendientes,
  planillasRecibidas,
  confirmarPlanilla,
  confirmarPlanillaHoy,
  calcularEfectivoHoy,
  hoyStr,
} from '../lib/planillas';
import { imprimirComprobanteEntregaGlobal } from '../lib/imprimir';

function horaAhora() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

// Versión simple para Fausto: ve los días de efectivo pendientes (calculados
// solos, igual que el Cierre del día impreso), los cuenta de verdad y confirma
// uno por uno. Letra grande, un paso a la vez, igual que su pantalla de pedidos.

function fmt(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO');
}

export default function EntregaEfectivoFausto({ usuario }) {
  const [pendientes, setPendientes] = useState(null);
  const [recibidas, setRecibidas] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [hoyAbierto, setHoyAbierto] = useState(false);
  const [exito, setExito] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  // Lo que se va confirmando en esta visita (no se guarda en la base de
  // datos, solo mientras esté abierta la pantalla) — para poder imprimir UN
  // comprobante global al final, en vez de uno por cada día.
  const [sesionConfirmadas, setSesionConfirmadas] = useState([]);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setErrorCarga('');
    try {
      await asegurarPlanillasPendientes();
      const [p, r] = await Promise.all([planillasPendientes(), planillasRecibidas(5)]);
      setPendientes(p);
      setRecibidas(r.filter((x) => x.recibidoPorId === usuario.id));
    } catch (e) {
      setErrorCarga('No se pudo cargar: ' + e.message);
    }
  }

  if (errorCarga) {
    return (
      <div className="cf-page">
        <div className="cf-card">
          <div className="cf-paso">No se pudo cargar</div>
          <p style={{ fontSize: 14, color: 'var(--danger)' }}>{errorCarga}</p>
        </div>
      </div>
    );
  }

  if (!pendientes) return <div className="loading">Cargando…</div>;

  const habilitadas = pendientes.filter((p) => p.habilitada);
  const totalHabilitado = habilitadas.reduce((s, p) => s + p.efectivoAEntregar, 0);

  return (
    <div className="cf-page">
      {exito && (
        <div className="cf-exito">
          ✅ ¡Listo! Quedó registrado que recibiste <b>{fmt(exito.monto)}</b> del {exito.fecha}.
          <button className="cf-exito-cerrar" onClick={() => setExito(null)}>
            Entendido
          </button>
        </div>
      )}

      {habilitadas.length > 0 && (
        <div className="cf-card" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}>
          <div className="cf-paso" style={{ marginBottom: 4 }}>
            💵 Ya te tienen {fmt(totalHabilitado)} listos para recoger
          </div>
          <p style={{ fontSize: 14, margin: 0 }}>
            {habilitadas.length === 1
              ? `Avisó ${habilitadas[0].habilitadaPorNombre} a las ${habilitadas[0].habilitadaHora} (${habilitadas[0].fecha}).`
              : `Avisaron de ${habilitadas.length} días distintos. Ve a "Efectivo pendiente de recoger" abajo.`}
          </p>
        </div>
      )}

      <div className="cf-card">
        <div className="cf-paso">Efectivo pendiente de recoger</div>
        {pendientes.length === 0 ? (
          <div className="empty-lines">No hay ningún efectivo pendiente ahora mismo.</div>
        ) : (
          pendientes.map((p) =>
            abierto === p.fecha ? (
              <FormularioRecibir
                key={p.fecha}
                planilla={p}
                usuario={usuario}
                onCancelar={() => setAbierto(null)}
                onListo={async (info) => {
                  setAbierto(null);
                  setExito(info);
                  setSesionConfirmadas((s) => [...s, info]);
                  await cargar();
                }}
              />
            ) : (
              <div key={p.fecha} className="cf-pedido-row">
                <div className="cf-pedido-top">
                  <span>{p.fecha}</span>
                </div>
                {p.habilitada && (
                  <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 4 }}>
                    ✔ Avisado por {p.habilitadaPorNombre} a las {p.habilitadaHora}
                  </div>
                )}
                <div className="cf-pedido-total">{fmt(p.efectivoAEntregar)}</div>
                <button className="cf-btn-corregir" onClick={() => setAbierto(p.fecha)}>
                  Recibir este efectivo
                </button>
              </div>
            )
          )
        )}
      </div>

      <div className="cf-card">
        {!hoyAbierto ? (
          <button className="cf-btn-secundario" style={{ width: '100%' }} onClick={() => setHoyAbierto(true)}>
            ¿Vas a recoger el efectivo de HOY mismo?
          </button>
        ) : (
          <FormularioHoy
            usuario={usuario}
            onCancelar={() => setHoyAbierto(false)}
            onListo={async (info) => {
              setHoyAbierto(false);
              setExito(info);
              setSesionConfirmadas((s) => [...s, info]);
              await cargar();
            }}
          />
        )}
      </div>

      {sesionConfirmadas.length > 0 && (
        <div className="cf-card">
          <div className="cf-paso">Comprobante de lo que confirmaste ahora</div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
            Llevas {sesionConfirmadas.length} {sesionConfirmadas.length === 1 ? 'día' : 'días'} confirmados en esta
            visita, por {fmt(sesionConfirmadas.reduce((s, c) => s + c.monto, 0))} en total. Cuando termines de recibir,
            imprime UN solo comprobante con todo y fírmenlo entre los dos.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="cf-btn-registrar"
              style={{ marginBottom: 0 }}
              onClick={() =>
                imprimirComprobanteEntregaGlobal({
                  fecha: hoyStr(),
                  hora: horaAhora(),
                  recibioNombre: usuario.nombreDefault,
                  dias: sesionConfirmadas,
                })
              }
            >
              Imprimir comprobante
            </button>
            <button className="cf-btn-secundario" onClick={() => setSesionConfirmadas([])}>
              Ya firmamos, ocultar
            </button>
          </div>
        </div>
      )}

      {recibidas && recibidas.length > 0 && (
        <div className="cf-card">
          <div className="cf-paso">Lo último que recibiste</div>
          {recibidas.map((p) => (
            <div key={p.fecha} className="cf-pedido-row">
              <div className="cf-pedido-top">
                <span>{p.fecha}</span>
              </div>
              <div className="cf-pedido-total">{fmt(p.recibido)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChipsVendedoras({ quien, setQuien }) {
  const vendedoras = USUARIOS_BASE.filter((u) => u.id === 'blanca' || u.id === 'sofia');
  return (
    <div className="cf-origenes">
      {vendedoras.map((u) => (
        <button key={u.id} className={`cf-origen ${quien?.id === u.id ? 'on' : ''}`} onClick={() => setQuien(u)}>
          {u.nombreDefault}
        </button>
      ))}
    </div>
  );
}

function FormularioRecibir({ planilla, usuario, onCancelar, onListo }) {
  // Precargado con lo calculado ese día: casi siempre coincide con lo que
  // cuenta, así que no tiene que volver a escribirlo día por día — si de
  // verdad contó otra cosa, toca el campo (se selecciona todo solo) y lo
  // corrige.
  const [recibido, setRecibido] = useState(() => String(Math.round(planilla.efectivoAEntregar || 0)));
  const [quien, setQuien] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  async function confirmar() {
    const monto = parseInt(recibido);
    if (isNaN(monto) || monto < 0) {
      setMsg('Escribe cuánto contaste.');
      return;
    }
    if (!quien) {
      setMsg('Falta decir quién te lo entregó.');
      return;
    }
    setGuardando(true);
    try {
      const res = await confirmarPlanilla(planilla, { recibido: monto, entregoNombre: quien.nombreDefault, nota }, usuario);
      if (res.difEntrega !== 0) {
        alert(
          `Ojo: el dinero no cuadró.\n\nCalculado el ${planilla.fecha}: ${fmt(planilla.efectivoAEntregar)}\nTú contaste: ${fmt(monto)}\nDiferencia: ${
            res.difEntrega > 0 ? 'sobró' : 'faltó'
          } ${fmt(Math.abs(res.difEntrega))}`
        );
      }
      onListo({ monto, fecha: planilla.fecha, entregoNombre: quien.nombreDefault });
    } catch (e) {
      setMsg('No se pudo registrar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="cf-correccion">
      <div className="cf-paso">Recibiendo el {planilla.fecha}</div>
      <div className="cf-linea-campo">
        <label>Calculado ese día</label>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(planilla.efectivoAEntregar)}</div>
      </div>
      <div className="cf-linea-campo">
        <label>¿Cuánto contaste tú de verdad?</label>
        <input
          className="cf-input cf-input-costo"
          type="number"
          inputMode="numeric"
          value={recibido}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setRecibido(e.target.value)}
        />
      </div>
      <div className="cf-linea-campo">
        <label>¿Quién te lo entregó?</label>
        <ChipsVendedoras quien={quien} setQuien={setQuien} />
      </div>
      <div className="cf-linea-campo">
        <label>Nota — opcional</label>
        <input className="cf-input" type="text" value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="cf-btn-secundario" onClick={onCancelar}>
          Cancelar
        </button>
        <button className="cf-btn-registrar" style={{ marginBottom: 0 }} disabled={guardando} onClick={confirmar}>
          {guardando ? 'Guardando…' : 'Confirmar que la recibí'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}

function FormularioHoy({ usuario, onCancelar, onListo }) {
  const [calculado, setCalculado] = useState(null);
  const [recibido, setRecibido] = useState('');
  const [quien, setQuien] = useState(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    calcularEfectivoHoy().then((valor) => {
      setCalculado(valor);
      // Mismo precargado que en el formulario de días anteriores — así no
      // toca escribirlo si lo que contó coincide.
      setRecibido(String(Math.round(valor || 0)));
    });
  }, []);

  async function confirmar() {
    const monto = parseInt(recibido);
    if (isNaN(monto) || monto < 0) {
      setMsg('Escribe cuánto contaste.');
      return;
    }
    if (!quien) {
      setMsg('Falta decir quién te lo entregó.');
      return;
    }
    setGuardando(true);
    try {
      const res = await confirmarPlanillaHoy({ recibido: monto, entregoNombre: quien.nombreDefault, nota }, usuario);
      if (res.difEntrega !== 0) {
        alert(
          `Ojo: el dinero no cuadró.\n\nCalculado hasta ahora: ${fmt(res.efectivoAEntregar)}\nTú contaste: ${fmt(monto)}\nDiferencia: ${
            res.difEntrega > 0 ? 'sobró' : 'faltó'
          } ${fmt(Math.abs(res.difEntrega))}`
        );
      }
      onListo({ monto, fecha: hoyStr(), entregoNombre: quien.nombreDefault });
    } catch (e) {
      setMsg('No se pudo registrar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="cf-correccion">
      <div className="cf-paso">Recibiendo el efectivo de hoy mismo</div>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
        Poco común — este número es lo calculado hasta ahora mismo, si todavía falta venta va a
        seguir cambiando.
      </p>
      <div className="cf-linea-campo">
        <label>Calculado hasta ahora</label>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{calculado == null ? 'Calculando…' : fmt(calculado)}</div>
      </div>
      <div className="cf-linea-campo">
        <label>¿Cuánto contaste tú de verdad?</label>
        <input
          className="cf-input cf-input-costo"
          type="number"
          inputMode="numeric"
          value={recibido}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setRecibido(e.target.value)}
        />
      </div>
      <div className="cf-linea-campo">
        <label>¿Quién te lo entregó?</label>
        <ChipsVendedoras quien={quien} setQuien={setQuien} />
      </div>
      <div className="cf-linea-campo">
        <label>Nota — opcional</label>
        <input className="cf-input" type="text" value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="cf-btn-secundario" onClick={onCancelar}>
          Cancelar
        </button>
        <button className="cf-btn-registrar" style={{ marginBottom: 0 }} disabled={guardando} onClick={confirmar}>
          {guardando ? 'Guardando…' : 'Confirmar que la recibí'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}
