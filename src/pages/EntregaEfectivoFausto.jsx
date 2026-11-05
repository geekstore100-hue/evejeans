import { useEffect, useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import {
  asegurarPlanillasPendientes,
  suscribirPlanillasPendientes,
  suscribirPlanillasRecibidas,
  confirmarPlanilla,
  pedirEntregaHoy,
  cancelarSolicitudHoy,
  suscribirSolicitudesDelDia,
  calcularEfectivoHoy,
  hoyStr,
  etiquetaPlanilla,
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
  // Si pidió recoger el efectivo de HOY, cómo va esa solicitud (la aprueba Nelson).
  const [solicitudesHoy, setSolicitudesHoy] = useState([]);
  useEffect(() => suscribirSolicitudesDelDia(hoyStr(), setSolicitudesHoy, () => setSolicitudesHoy([])), []);

  // En vivo: en cuanto la vendedora avisa que tiene el efectivo listo, le
  // aparece a Fausto sin tener que recargar la página.
  useEffect(() => {
    const alFallar = (e) => setErrorCarga('No se pudo cargar: ' + e.message);
    const quitarP = suscribirPlanillasPendientes(setPendientes, alFallar);
    const quitarR = suscribirPlanillasRecibidas(
      (r) => setRecibidas(r.filter((x) => x.recibidoPorId === usuario.id).slice(0, 5)),
      alFallar
    );
    return () => {
      quitarP();
      quitarR();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cargar();
  }, []);

  // Crea las planillas de los días que falten (lo que cree aparece solo en la
  // lista, porque ya se está escuchando en vivo).
  async function cargar() {
    try {
      await asegurarPlanillasPendientes();
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
            abierto === p.id ? (
              <FormularioRecibir
                key={p.id}
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
              <div key={p.id} className="cf-pedido-row">
                <div className="cf-pedido-top">
                  <span>{etiquetaPlanilla(p)}</span>
                </div>
                {p.habilitada ? (
                  <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 4 }}>
                    ✔ Avisado por {p.habilitadaPorNombre} a las {p.habilitadaHora}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>
                    Todavía no te han avisado que está lista
                  </div>
                )}
                <div className="cf-pedido-total">{fmt(p.efectivoAEntregar)}</div>
                {p.habilitada ? (
                  <button className="cf-btn-corregir" onClick={() => setAbierto(p.id)}>
                    Recibir este efectivo
                  </button>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontStyle: 'italic' }}>
                    Espera a que avisen para poder recibirlo
                  </div>
                )}
              </div>
            )
          )
        )}
      </div>

      <div className="cf-card">
        <EstadoSolicitudHoy solicitudes={solicitudesHoy} />
        {solicitudesHoy.some((x) => x.estado === 'pedida' || x.estado === 'aprobada') ? null : !hoyAbierto ? (
          <button className="cf-btn-secundario" style={{ width: '100%' }} onClick={() => setHoyAbierto(true)}>
            ¿Vas a recoger el efectivo de HOY mismo?
          </button>
        ) : (
          <FormularioHoy usuario={usuario} onCancelar={() => setHoyAbierto(false)} onListo={() => setHoyAbierto(false)} />
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
            <div key={p.id} className="cf-pedido-row">
              <div className="cf-pedido-top">
                <span>{etiquetaPlanilla(p)}</span>
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
          `Ojo: el dinero no cuadró.\n\nCalculado el ${etiquetaPlanilla(planilla)}: ${fmt(planilla.efectivoAEntregar)}\nTú contaste: ${fmt(monto)}\nDiferencia: ${
            res.difEntrega > 0 ? 'sobró' : 'faltó'
          } ${fmt(Math.abs(res.difEntrega))}`
        );
      }
      onListo({ monto, fecha: etiquetaPlanilla(planilla), entregoNombre: quien.nombreDefault });
    } catch (e) {
      setMsg('No se pudo registrar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="cf-correccion">
      <div className="cf-paso">Recibiendo el {etiquetaPlanilla(planilla)}</div>
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
      await pedirEntregaHoy({ recibido: monto, entregoNombre: quien.nombreDefault, nota }, usuario);
      onListo();
    } catch (e) {
      setMsg('No se pudo enviar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="cf-correccion">
      <div className="cf-paso">Recibiendo el efectivo de hoy mismo</div>
      <p style={{ fontSize: 14, color: 'var(--danger)', fontWeight: 700, marginTop: 0 }}>
        Solo si te estás llevando AHORA la plata de HOY ({hoyStr()}). Para los días anteriores usa
        "Recibir este efectivo" arriba.
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
        Recoger el efectivo del mismo día lo tiene que aprobar Nelson: cuenta, y a él le llega el
        aviso en su app. Lo que se venda después de recogerlo queda como "saldo" de hoy, pendiente
        para recoger otro día.
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
          {guardando ? 'Enviando…' : 'Pedirle a Nelson que lo apruebe'}
        </button>
      </div>
      {msg && <div className="msg bad">{msg}</div>}
    </div>
  );
}

// Cómo va la solicitud de recoger el efectivo de hoy (en vivo).
function EstadoSolicitudHoy({ solicitudes }) {
  const sol = solicitudes.find((x) => x.estado !== 'cancelada');
  if (!sol) return null;
  if (sol.estado === 'pedida') {
    return (
      <div className="cf-solicitud espera">
        <b>⏳ Esperando que Nelson apruebe</b>
        <span>
          Pediste recoger {fmt(sol.recibido)} del efectivo de hoy (lo entrega {sol.entregoNombre || '—'}). Todavía no te lleves la plata.
        </span>
        <button className="cf-btn-secundario" onClick={() => cancelarSolicitudHoy(sol).catch(() => {})}>
          Cancelar la solicitud
        </button>
      </div>
    );
  }
  if (sol.estado === 'aprobada') {
    return (
      <div className="cf-solicitud ok">
        <b>✅ Nelson lo aprobó</b>
        <span>
          Ya quedó registrado que recibiste {fmt(sol.recibido)} del efectivo de hoy. Lo que se venda de aquí en adelante queda como saldo
          para recoger otro día.
        </span>
      </div>
    );
  }
  return (
    <div className="cf-solicitud no">
      <b>✋ Nelson no lo aprobó</b>
      <span>
        {sol.motivo ? `Motivo: ${sol.motivo}. ` : ''}No te lleves el efectivo de hoy; se recoge otro día como siempre.
      </span>
    </div>
  );
}
