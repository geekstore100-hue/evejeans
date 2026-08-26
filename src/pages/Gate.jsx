import { useEffect, useState } from 'react';
import { USUARIOS_BASE } from '../lib/usuarios';
import { entrarComoVendedoraCompartida, entrarComoNelson, entrarComoFausto } from '../lib/auth';

// Se muestra cuando todavía no hay nadie identificado. Si Firebase ya nos autenticó
// como la cuenta compartida (o lo hace ahora mismo, en silencio), solo falta
// preguntar el nombre — sin clave. Si alguien quiere entrar como Nelson, ahí sí pide PIN.
//
// soloAdmin: se usa mientras el bloqueo de pánico está activo. En ese caso no se
// intenta entrar como la cuenta compartida (la tienda queda bloqueada de verdad,
// sin nombres ni menú ni nada que ver) y lo único que se muestra es el PIN de
// Nelson, para que él pueda entrar a desactivarlo desde su propia cuenta.
export default function Gate({ onElegirVendedora, soloAdmin }) {
  const [modo, setModo] = useState(soloAdmin ? 'nelson' : 'entrando'); // entrando | elegir | nelson | fausto
  const [errorEntrada, setErrorEntrada] = useState('');
  const [pinNelson, setPinNelson] = useState('');
  const [errorNelson, setErrorNelson] = useState('');
  const [entrandoNelson, setEntrandoNelson] = useState(false);
  const [pinFausto, setPinFausto] = useState('');
  const [errorFausto, setErrorFausto] = useState('');
  const [entrandoFausto, setEntrandoFausto] = useState(false);

  // Fausto (compras) tiene su propia cuenta real, como Nelson — no es un nombre que
  // se elige bajo la cuenta compartida de las vendedoras.
  const vendedoras = USUARIOS_BASE.filter((u) => u.id !== 'nelson' && u.id !== 'fausto');

  useEffect(() => {
    if (soloAdmin) return;
    entrarComoVendedoraCompartida()
      .then(() => setModo('elegir'))
      .catch((e) => setErrorEntrada('No se pudo entrar: ' + e.message));
  }, [soloAdmin]);

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

  async function confirmarFausto() {
    if (!pinFausto) return;
    setErrorFausto('');
    setEntrandoFausto(true);
    try {
      await entrarComoFausto(pinFausto);
      // El listener de sesión en App.jsx reconoce a Fausto solo, no hace falta nada más aquí.
    } catch (e) {
      setErrorFausto('PIN incorrecto.');
      setPinFausto('');
    } finally {
      setEntrandoFausto(false);
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
          {!soloAdmin && (
            <button className="btn ghost" onClick={() => setModo('elegir')}>
              Volver
            </button>
          )}
          {soloAdmin && (
            <button className="gate-admin-link" onClick={() => setModo('fausto')}>
              Entrar como Fausto (Compras)
            </button>
          )}
        </div>
      </div>
    );
  }

  if (modo === 'fausto') {
    return (
      <div className="gate">
        <div className="gate-box">
          <h1>Fausto</h1>
          <p>Escribe tu PIN.</p>
          <input
            type="password"
            value={pinFausto}
            onChange={(e) => setPinFausto(e.target.value)}
            style={{ marginBottom: 12 }}
            autoFocus
          />
          {errorFausto && <div className="msg bad">{errorFausto}</div>}
          <button className="btn" disabled={entrandoFausto} onClick={confirmarFausto}>
            {entrandoFausto ? 'Entrando…' : 'Entrar'}
          </button>
          {/* Durante el bloqueo de pánico, "Volver" no debe mostrar la lista de
              vendedoras (todo el punto es que la tienda quede oculta) — vuelve a la
              pantalla del PIN de Nelson en vez de a "elegir". */}
          <button className="btn ghost" onClick={() => setModo(soloAdmin ? 'nelson' : 'elegir')}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <img src="/logo.png" alt="Eve Jeans" className="gate-logo" />
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
        <button className="gate-admin-link" onClick={() => setModo('fausto')}>
          Entrar como Fausto (Compras)
        </button>
      </div>
    </div>
  );
}
