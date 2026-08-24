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
import RecibirMercancia from './pages/RecibirMercancia';
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

  useEffect(() => {
    const quitar = escucharSesion((firebaseUser) => {
      setAuthId(firebaseUser ? idDesdeEmail(firebaseUser.email) : null);
      setCargando(false);
    });
    return quitar;
  }, []);

  // Botón de pánico: mientras haya una sesión abierta se revisa todo el tiempo si
  // Nelson lo activó. Si es así, se cierra de inmediato la sesión de la cuenta
  // compartida de las vendedoras (el computador de la tienda), sin importar en qué
  // pantalla esté — y no la deja volver a entrar mientras siga activo. La sesión de
  // Nelson NO se cierra: así puede activarlo y desactivarlo desde su propia cuenta
  // (normalmente desde otro dispositivo) sin quedar trabado él mismo.
  useEffect(() => {
    if (!authId) return;
    const quitar = escucharPanico((activo) => {
      setPanicoActivo(activo);
      if (activo && authId !== 'nelson') salir();
    });
    return quitar;
  }, [authId]);

  function elegirVendedora(u) {
    setVendedoraElegida(u);
  }

  async function cambiarDeTurno() {
    if (authId === 'nelson') {
      // Nelson sí cierra sesión de verdad: vuelve a la cuenta compartida.
      await salir();
    }
    setVendedoraElegida(null);
  }

  if (cargando) {
    return <div className="loading">Cargando…</div>;
  }

  // Nelson tiene su propia cuenta real: entra directo, sin elegir nombre.
  const usuario =
    authId === 'nelson'
      ? USUARIOS_BASE.find((u) => u.id === 'nelson')
      : vendedoraElegida;

  if (!usuario) {
    return <Gate onElegirVendedora={elegirVendedora} />;
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
        {usuario.id === 'nelson' &&
          (panicoActivo ? (
            <button
              className="link-btn"
              style={{ color: 'var(--ok)' }}
              onClick={async () => {
                const ok = window.confirm(
                  'Esto permite que la cuenta de vendedoras vuelva a entrar en el computador de la tienda. ¿Seguro que quieres desactivarlo?'
                );
                if (!ok) return;
                await desactivarPanico(usuario);
              }}
            >
              Desbloquear tienda
            </button>
          ) : (
            <button
              className="link-btn"
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                const ok = window.confirm(
                  'Esto cierra ahora mismo la sesión de la cuenta de vendedoras en el computador de la tienda, y no la deja volver a entrar hasta que lo desactives (tú puedes hacerlo cuando quieras desde tu cuenta). ¿Seguro que quieres activarlo?'
                );
                if (!ok) return;
                await activarPanico(usuario);
              }}
            >
              Bloquear tienda
            </button>
          ))}
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
        {vista === 'movimientos' && <Movimientos usuario={usuario} />}
        {vista === 'compras' && usuario.id === 'nelson' && <Compras />}
        {vista === 'inventario' && usuario.id === 'nelson' && <Inventario />}
        {vista === 'ganancia' && usuario.id === 'nelson' && <Ganancia />}
      </main>
    </div>
  );
}
