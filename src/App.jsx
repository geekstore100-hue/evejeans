import { useEffect, useState } from 'react';
import { escucharSesion, salir, idDesdeEmail } from './lib/auth';
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

const CLAVE_LOCAL = 'evejeans_vendedora';

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [authId, setAuthId] = useState(null); // 'nelson' | 'vendedoras' | null
  const [vendedoraElegida, setVendedoraElegida] = useState(() => {
    const guardada = localStorage.getItem(CLAVE_LOCAL);
    return guardada ? USUARIOS_BASE.find((u) => u.id === guardada) || null : null;
  });
  const [vista, setVista] = useState('vender');

  useEffect(() => {
    const quitar = escucharSesion((firebaseUser) => {
      setAuthId(firebaseUser ? idDesdeEmail(firebaseUser.email) : null);
      setCargando(false);
    });
    return quitar;
  }, []);

  function elegirVendedora(u) {
    localStorage.setItem(CLAVE_LOCAL, u.id);
    setVendedoraElegida(u);
  }

  async function cambiarDeTurno() {
    if (authId === 'nelson') {
      // Nelson sí cierra sesión de verdad: vuelve a la cuenta compartida.
      await salir();
    }
    localStorage.removeItem(CLAVE_LOCAL);
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
      </nav>

      <main>
        {vista === 'vender' && <Vender usuario={usuario} />}
        {vista === 'cambios' && <Cambios usuario={usuario} />}
        {vista === 'gastos' && <Gastos usuario={usuario} />}
        {vista === 'cierre' && <Cierre />}
        {vista === 'sobres' && <Sobres usuario={usuario} />}
        {vista === 'recibir' && <RecibirMercancia usuario={usuario} />}
        {vista === 'compras' && usuario.id === 'nelson' && <Compras />}
        {vista === 'inventario' && usuario.id === 'nelson' && <Inventario />}
      </main>
    </div>
  );
}
