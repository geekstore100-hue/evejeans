import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from './firebase';
import { emailDe } from './usuarios';

export async function entrarConPin(id, pin) {
  const email = emailDe(id);
  await signInWithEmailAndPassword(auth, email, pin);
}

export async function salir() {
  await signOut(auth);
}

export function escucharSesion(callback) {
  return onAuthStateChanged(auth, callback);
}

// El id del usuario es la parte antes del @ en su correo interno.
export function idDesdeEmail(email) {
  if (!email) return null;
  return email.split('@')[0];
}
