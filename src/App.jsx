import { useEffect, useState } from 'react';
import { escucharSesion, salir, idDesdeEmail } from './lib/auth';
import { USUARIOS_BASE } from './lib/usuarios';
import Gate from './pages/Gate';
import Vender from './pages/Vender';
import Cambios from './pages/Cambios';
import Gastos from './pages/Gastos';
import Inventario from './pages/Inventario';

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [usuario, setUsuario] = useState(null); // {id, nombreDefault, rol}
  const [vista, setVista] = useState('vender');

  useEffect(() => {
    const quitar = escucharSesion((firebaseUser) => {
      if (firebaseUser) {
        const id = idDesdeEmail(firebaseUser.email);
        const base = USUARIOS_BASE.find((u) => u.id === id) || null;
        setUsuario(base);
      } else {
        setUsuario(null);
      }
      setCargando(false);
    });
    return quitar;
  }, []);

  if (cargando) {
    return <div className="loading">Cargando…</div>;
  }

  if (!usuario) {
    return <Gate />;
  }

  return (
    <div>
      <div className="topbar">
        <div className="brand">
          Eve Jeans <span>· punto de venta</span>
        </div>
        <div className="spacer" />
        <div className="who">
          Turno de <b>{usuario.nombreDefault}</b>
        </div>
        <button className="link-btn" onClick={salir}>
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
        {usuario.id === 'nelson' && (
          <button className={vista === 'inventario' ? 'on' : ''} onClick={() => setVista('inventario')}>
            Inventario
          </button>
        )}
      </nav>

      <main>
        {vista === 'cambios' && <Cambios usuario={usuario} />}
        {vista === 'gastos' && <Gastos usuario={usuario} />}
        {vista === 'inventario' && usuario.id === 'nelson' && <Inventario />}
        {vista === 'vender' && <Vender usuario={usuario} />}
      </main>
    </div>
  );
}
