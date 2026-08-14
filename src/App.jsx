import { useEffect, useState } from 'react';
import { escucharSesion, salir, idDesdeEmail } from './lib/auth';
import { USUARIOS_BASE } from './lib/usuarios';
import Gate from './pages/Gate';

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [usuario, setUsuario] = useState(null); // {id, nombreDefault, rol}

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

  // Fase 1: por ahora solo confirmamos que el login real funciona.
  // Aquí es donde en el siguiente paso entra la pantalla de Vender.
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
      <div style={{ padding: 24 }}>
        <p>Sesión real de Firebase funcionando para <b>{usuario.nombreDefault}</b> ({usuario.id}).</p>
        <p>Siguiente paso: pantalla de Vender con Firestore en tiempo real.</p>
      </div>
    </div>
  );
}
