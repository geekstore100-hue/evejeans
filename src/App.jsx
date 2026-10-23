import { useEffect, useState } from 'react';
import { escucharSesion, salir, idDesdeEmail } from './lib/auth';
import { escucharPanico, activarPanico, desactivarPanico } from './lib/panico';
import { USUARIOS_BASE } from './lib/usuarios';
import Gate from './pages/Gate';
import Vender from './pages/Vender';
import Cambios from './pages/Cambios';
import Gastos from './pages/Gastos';
import Cierre from './pages/Cierre';
import Sobres from './pages/Sobres';
import Compras from './pages/Compras';
import ComprasFausto from './pages/ComprasFausto';
import EntregaEfectivoFausto from './pages/EntregaEfectivoFausto';
import RecibirMercancia from './pages/RecibirMercancia';
import EntradasSalidas from './pages/EntradasSalidas';
import Inventario from './pages/Inventario';
import Ganancia from './pages/Ganancia';
import Movimientos from './pages/Movimientos';
import Conciliacion from './pages/Conciliacion';
import Capital from './pages/Capital';
import Nequi from './pages/Nequi';
import ReporteNegocio from './pages/ReporteNegocio';
import LibroDiario from './pages/LibroDiario';
import FechasEspeciales from './pages/FechasEspeciales';
import MenuNelson from './components/MenuNelson';
import AvisoRefuerzo from './components/AvisoRefuerzo';

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [authId, setAuthId] = useState(null); // 'nelson' | 'vendedoras' | null
  // No se guarda en localStorage a propósito: cada vez que se recarga la página
  // o se abre de nuevo (por ejemplo al empezar el día) debe volver a preguntar
  // quién está en el turno, en vez de seguir con la última vendedora que entró.
  const [vendedoraElegida, setVendedoraElegida] = useState(null);
  const [vista, setVista] = useState('vender');
  const [panicoActivo, setPanicoActivo] = useState(false);
  const [panicoListo, setPanicoListo] = useState(false);
  const [vistaFausto, setVistaFausto] = useState('pedido'); // pedido | efectivo | reportes
  const [reporteFausto, setReporteFausto] = useState('negocio'); // negocio | fechas

  useEffect(() => {
    const quitar = escucharSesion((firebaseUser) => {
      setAuthId(firebaseUser ? idDesdeEmail(firebaseUser.email) : null);
      if (!firebaseUser) {
        // La sesión de Firebase se cerró (cambio de turno normal, o el bloqueo de
        // pánico forzándolo). "vendedoraElegida" es solo un nombre elegido en
        // pantalla, no depende de Firebase, así que si no se limpia acá se queda
        // pegado: la app seguiría mostrando la pantalla de siempre pero sin sesión
        // real detrás, y cualquier lectura a Firestore saldría con "permiso
        // denegado". Al ponerlo en null, vuelve a la pantalla de "¿quién eres?".
        setVendedoraElegida(null);
      }
      setCargando(false);
    });
    return quitar;
  }, []);

  // Botón de pánico: se revisa desde ANTES de que haya sesión (la regla de Firestore
  // deja leer este dato puntual sin estar autenticado, a propósito), para poder
  // dejar la pantalla bloqueada desde el principio si está activo — sin que se
  // alcance a intentar entrar como la cuenta compartida ni se vea nada de la tienda.
  // Solo bloquea la cuenta COMPARTIDA de vendedoras (el computador de la tienda).
  // Ni Nelson ni Fausto se bloquean ni se les cierra la sesión: cada uno tiene su
  // propia cuenta real, así que pueden entrar (o Nelson, activarlo/desactivarlo)
  // sin quedar trabados ellos mismos.
  useEffect(() => {
    const quitar = escucharPanico((activo) => {
      setPanicoActivo(activo);
      setPanicoListo(true);
      if (activo && authId !== 'nelson' && authId !== 'fausto') salir();
    });
    return quitar;
  }, [authId]);

  function elegirVendedora(u) {
    setVendedoraElegida(u);
  }

  async function cambiarDeTurno() {
    if (authId === 'nelson' || authId === 'fausto') {
      // Nelson y Fausto sí cierran sesión de verdad: cada uno tiene su propia
      // cuenta real, no una etiqueta elegida sobre la cuenta compartida.
      await salir();
    }
    setVendedoraElegida(null);
  }

  if (cargando || !panicoListo) {
    return <div className="loading">Cargando…</div>;
  }

  // Bloqueo activo y quien está (o todavía no está) identificado no es Nelson ni
  // Fausto: no se muestra la tienda ni el selector de vendedoras, solo el PIN de
  // Nelson (con un enlace ahí mismo para entrar como Fausto).
  if (panicoActivo && authId !== 'nelson' && authId !== 'fausto') {
    return <Gate onElegirVendedora={elegirVendedora} soloAdmin />;
  }

  // Nelson y Fausto tienen su propia cuenta real: entran directo, sin elegir nombre.
  const usuario =
    authId === 'nelson' || authId === 'fausto'
      ? USUARIOS_BASE.find((u) => u.id === authId)
      : vendedoraElegida;

  if (!usuario) {
    return <Gate onElegirVendedora={elegirVendedora} />;
  }

  // Fausto solo se encarga de compras: no ve el resto de la tienda, ni las pestañas
  // ni el botón de pánico (eso sigue siendo solo de Nelson).
  if (usuario.id === 'fausto') {
    return (
      <div>
        <div className="topbar">
          <div className="brand">
            <img src="/logo.png" alt="Eve Jeans" className="brand-logo" />
            <span>· punto de venta</span>
          </div>
          <div className="spacer" />
          <div className="who">
            Turno de <b>{usuario.nombreDefault}</b>
          </div>
          <button className="link-btn" onClick={cambiarDeTurno}>
            Cambiar de turno
          </button>
        </div>
        <div className="cf-nav">
          <button className={vistaFausto === 'pedido' ? 'on' : ''} onClick={() => setVistaFausto('pedido')}>
            🧾 Nuevo pedido
          </button>
          <button className={vistaFausto === 'efectivo' ? 'on' : ''} onClick={() => setVistaFausto('efectivo')}>
            💵 Recibir efectivo
          </button>
          <button className={vistaFausto === 'reportes' ? 'on' : ''} onClick={() => setVistaFausto('reportes')}>
            📊 Reportes
          </button>
        </div>
        <AvisoRefuerzo usuario={usuario} />
        {/* Fausto ve Reportes menos el Libro diario (ese es solo de Nelson). */}
        {vistaFausto === 'reportes' && (
          <nav className="mn-subs cf-subs" aria-label="Submenú de Reportes">
            <button className={`mn-sub ${reporteFausto === 'negocio' ? 'on' : ''}`} onClick={() => setReporteFausto('negocio')}>
              Cómo va el negocio
            </button>
            <button className={`mn-sub ${reporteFausto === 'fechas' ? 'on' : ''}`} onClick={() => setReporteFausto('fechas')}>
              Fechas especiales
            </button>
          </nav>
        )}
        <main>
          {vistaFausto === 'pedido' && <ComprasFausto usuario={usuario} />}
          {vistaFausto === 'efectivo' && <EntregaEfectivoFausto usuario={usuario} />}
          {vistaFausto === 'reportes' && reporteFausto === 'negocio' && <ReporteNegocio usuario={usuario} />}
          {vistaFausto === 'reportes' && reporteFausto === 'fechas' && <FechasEspeciales usuario={usuario} />}
        </main>
      </div>
    );
  }

  async function bloquearTienda() {
    const ok = window.confirm(
      'Esto cierra ahora mismo la sesión de la cuenta de vendedoras en el computador de la tienda, y no la deja volver a entrar hasta que lo desactives (tú puedes hacerlo cuando quieras desde tu cuenta). ¿Seguro que quieres activarlo?'
    );
    if (!ok) return;
    try {
      await activarPanico(usuario);
    } catch (e) {
      alert('No se pudo activar: ' + e.message);
    }
  }

  async function desbloquearTienda() {
    const ok = window.confirm(
      'Esto permite que la cuenta de vendedoras vuelva a entrar en el computador de la tienda. ¿Seguro que quieres desactivarlo?'
    );
    if (!ok) return;
    try {
      await desactivarPanico(usuario);
    } catch (e) {
      alert('No se pudo desactivar: ' + e.message);
    }
  }

  const esNelson = usuario.id === 'nelson';

  return (
    <div className={`${vista === 'vender' ? 'con-panel-fijo' : ''} ${esNelson ? 'es-nelson' : ''}`}>
      {esNelson ? (
        // Nelson tiene su propio menú, agrupado (ver components/MenuNelson.jsx).
        <MenuNelson
          usuario={usuario}
          vista={vista}
          setVista={setVista}
          panicoActivo={panicoActivo}
          onCambiarTurno={cambiarDeTurno}
          onBloquear={bloquearTienda}
          onDesbloquear={desbloquearTienda}
        />
      ) : (
        <>
          <div className="topbar">
            <div className="brand">
              <img src="/logo.png" alt="Eve Jeans" className="brand-logo" />
              <span>· punto de venta</span>
            </div>
            <div className="spacer" />
            <div className="who">
              Turno de <b>{usuario.nombreDefault}</b>
            </div>
            <button className="link-btn" onClick={cambiarDeTurno}>
              Cambiar de turno
            </button>
          </div>

          <nav className="tabs">
            <button className={vista === 'vender' ? 'on' : ''} onClick={() => setVista('vender')}>
              Vender
            </button>
            <button className={vista === 'cambios' ? 'on' : ''} onClick={() => setVista('cambios')}>
              Cambios
            </button>
            <button className={vista === 'gastos' ? 'on' : ''} onClick={() => setVista('gastos')}>
              Gastos
            </button>
            <button className={vista === 'cierre' ? 'on' : ''} onClick={() => setVista('cierre')}>
              Cierre del día
            </button>
            <button className={vista === 'sobres' ? 'on' : ''} onClick={() => setVista('sobres')}>
              Entrega de dinero
            </button>
            <button className={vista === 'recibir' ? 'on' : ''} onClick={() => setVista('recibir')}>
              Recibir mercancía
            </button>
            <button className={vista === 'entradasSalidas' ? 'on' : ''} onClick={() => setVista('entradasSalidas')}>
              Entradas y salidas
            </button>
            <button className={vista === 'movimientos' ? 'on' : ''} onClick={() => setVista('movimientos')}>
              Historial
            </button>
          </nav>
        </>
      )}

      {esNelson && <AvisoRefuerzo usuario={usuario} />}

      <main>
        {vista === 'vender' && <Vender usuario={usuario} />}
        {vista === 'cambios' && <Cambios usuario={usuario} />}
        {vista === 'gastos' && <Gastos usuario={usuario} />}
        {vista === 'cierre' && <Cierre usuario={usuario} />}
        {vista === 'sobres' && <Sobres usuario={usuario} />}
        {vista === 'recibir' && <RecibirMercancia usuario={usuario} />}
        {vista === 'entradasSalidas' && <EntradasSalidas usuario={usuario} />}
        {vista === 'movimientos' && <Movimientos usuario={usuario} />}
        {vista === 'compras' && usuario.id === 'nelson' && <Compras usuario={usuario} />}
        {vista === 'inventario' && usuario.id === 'nelson' && <Inventario />}
        {vista === 'ganancia' && usuario.id === 'nelson' && <Ganancia />}
        {vista === 'conciliacion' && usuario.id === 'nelson' && <Conciliacion usuario={usuario} />}
        {vista === 'capital' && usuario.id === 'nelson' && <Capital usuario={usuario} />}
        {vista === 'nequi' && usuario.id === 'nelson' && <Nequi usuario={usuario} />}
        {vista === 'reporteNegocio' && usuario.id === 'nelson' && <ReporteNegocio usuario={usuario} />}
        {vista === 'libroDiario' && usuario.id === 'nelson' && <LibroDiario />}
        {vista === 'fechasEspeciales' && usuario.id === 'nelson' && <FechasEspeciales usuario={usuario} />}
      </main>
    </div>
  );
}
