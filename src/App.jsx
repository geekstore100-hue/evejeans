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
import RecibirMercancia from './pages/RecibirMercancia';
import EntradasSalidas from './pages/EntradasSalidas';
import Inventario from './pages/Inventario';
import Ganancia from './pages/Ganancia';
import Movimientos from './pages/Movimientos';

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
        <main>
          <ComprasFausto usuario={usuario} />
        </main>
      </div>
    );
  }

  return (
    <div className={vista === 'vender' ? 'con-panel-fijo' : ''}>
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
        {usuario.id === 'nelson' && (
          <>
            <div className="topbar-divider" />
            {panicoActivo ? (
              <button
                className="panic-btn desbloquear"
                onClick={async () => {
                  const ok = window.confirm(
                    'Esto permite que la cuenta de vendedoras vuelva a entrar en el computador de la tienda. ¿Seguro que quieres desactivarlo?'
                  );
                  if (!ok) return;
                  await desactivarPanico(usuario);
                }}
              >
                🔓 Desbloquear tienda
              </button>
            ) : (
              <button
                className="panic-btn bloquear"
                onClick={async () => {
                  const ok = window.confirm(
                    'Esto cierra ahora mismo la sesión de la cuenta de vendedoras en el computador de la tienda, y no la deja volver a entrar hasta que lo desactives (tú puedes hacerlo cuando quieras desde tu cuenta). ¿Seguro que quieres activarlo?'
                  );
                  if (!ok) return;
                  await activarPanico(usuario);
                }}
              >
                🔒 Bloquear tienda
              </button>
            )}
          </>
        )}
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
        {usuario.id === 'nelson' && (
          <button className={vista === 'compras' ? 'on' : ''} onClick={() => setVista('compras')}>
            Compras
          </button>
        )}
        {usuario.id === 'nelson' && (
          <button className={vista === 'inventario' ? 'on' : ''} onClick={() => setVista('inventario')}>
            Inventario
          </button>
        )}
        {usuario.id === 'nelson' && (
          <button className={vista === 'ganancia' ? 'on' : ''} onClick={() => setVista('ganancia')}>
            Ganancia
          </button>
        )}
      </nav>

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
      </main>
    </div>
  );
}
