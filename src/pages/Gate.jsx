import { useEffect, useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import { entrarComoVendedoraCompartida, entrarComoNelson } from '../lib/auth';

// Se muestra cuando todavía no hay nadie identificado. Si Firebase ya nos autenticó
// como la cuenta compartida (o lo hace ahora mismo, en silencio), solo falta
// preguntar el nombre — sin clave. Si alguien quiere entrar como Nelson, ahí sí pide PIN.
export default function Gate({ onElegirVendedora }) {
  const [modo, setModo] = useState('entrando'); // entrando | elegir | nelson
  const [errorEntrada, setErrorEntrada] = useState('');
  const [pinNelson, setPinNelson] = useState('');
  const [errorNelson, setErrorNelson] = useState('');
  const [entrandoNelson, setEntrandoNelson] = useState(false);

  const vendedoras = USUARIOS_BASE.filter((u) => u.id !== 'nelson');

  useEffect(() => {
    entrarComoVendedoraCompartida()
      .then(() => setModo('elegir'))
      .catch((e) => setErrorEntrada('No se pudo entrar: ' + e.message));
  }, []);

  async function confirmarNelson() {
    if (!pinNelson) return;
    setErrorNelson('');
    setEntrandoNelson(true);
    try {
      await entrarComoNelson(pinNelson);
      // El listener de sesión en App.jsx reconoce a Nelson solo, no hace falta nada más aquí.
    } catch (e) {
      setErrorNelson('PIN incorrecto.');
      setPinNelson('');
    } finally {
      setEntrandoNelson(false);
    }
  }

  if (modo === 'entrando') {
    return (
      <div className="gate">
        <div className="gate-box">
          {errorEntrada ? (
            <>
              <h1>No se pudo entrar</h1>
              <p style={{ color: 'var(--danger)' }}>{errorEntrada}</p>
            </>
          ) : (
            <p>Entrando…</p>
          )}
        </div>
      </div>
    );
  }

  if (modo === 'nelson') {
    return (
      <div className="gate">
        <div className="gate-box">
          <h1>Nelson</h1>
          <p>Escribe tu PIN.</p>
          <input
            type="password"
            value={pinNelson}
            onChange={(e) => setPinNelson(e.target.value)}
            style={{ marginBottom: 12 }}
            autoFocus
          />
          {errorNelson && <div className="msg bad">{errorNelson}</div>}
          <button className="btn" disabled={entrandoNelson} onClick={confirmarNelson}>
            {entrandoNelson ? 'Entrando…' : 'Entrar'}
          </button>
          <button className="btn ghost" onClick={() => setModo('elegir')}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <h1>Eve Jeans</h1>
        <p>¿Quién eres?</p>
        {vendedoras.map((u) => (
          <button key={u.id} className="gate-user" onClick={() => onElegirVendedora(u)}>
            {u.nombreDefault}
            <span className="r">{u.rol}</span>
          </button>
        ))}
        <button className="gate-admin-link" onClick={() => setModo('nelson')}>
          Entrar como Nelson (Administración)
        </button>
      </div>
    </div>
  );
}
