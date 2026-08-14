import { useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import { entrarConPin } from '../lib/auth';

export default function Gate() {
  const [elegido, setElegido] = useState(null); // {id, nombreDefault, rol}
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  const vendedoras = USUARIOS_BASE.filter((u) => u.id !== 'nelson');
  const nelson = USUARIOS_BASE.find((u) => u.id === 'nelson');

  async function confirmar() {
    if (pin.length < 4) {
      setError('El PIN es muy corto.');
      return;
    }
    setError('');
    setEntrando(true);
    try {
      await entrarConPin(elegido.id, pin);
      // Si funciona, el listener de sesión en App.jsx se encarga de cambiar de pantalla.
    } catch (e) {
      setError('PIN incorrecto.');
      setPin('');
    } finally {
      setEntrando(false);
    }
  }

  function tocarDigito(d) {
    if (pin.length >= 6) return;
    setError('');
    setPin(pin + d);
  }
  function borrar() {
    setPin(pin.slice(0, -1));
  }

  if (elegido) {
    return (
      <div className="gate">
        <div className="gate-box">
          <h1>Hola, {elegido.nombreDefault}</h1>
          <p>Escribe tu PIN.</p>

          <div className="pin-dots">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={`pin-dot ${i < pin.length ? 'on' : ''}`} />
            ))}
          </div>

          <div className="pin-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←'].map((d, i) =>
              d === '' ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  className="pin-key"
                  onClick={() => (d === '←' ? borrar() : tocarDigito(d))}
                >
                  {d}
                </button>
              )
            )}
          </div>

          {error && <div className="msg bad">{error}</div>}

          <button className="btn" disabled={entrando} onClick={confirmar}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setElegido(null);
              setPin('');
              setError('');
            }}
          >
            Cambiar de persona
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <h1>Eve Jeans</h1>
        <p>Elige quién va a trabajar en este turno.</p>
        {vendedoras.map((u) => (
          <button key={u.id} className="gate-user" onClick={() => setElegido(u)}>
            {u.nombreDefault}
            <span className="r">{u.rol}</span>
          </button>
        ))}
        <button className="gate-admin-link" onClick={() => setElegido(nelson)}>
          Entrar como Nelson (Administración)
        </button>
      </div>
    </div>
  );
}
