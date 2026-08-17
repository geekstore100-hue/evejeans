import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from './firebase';

// Cuenta compartida que usan Blanca y Sofía para vender. No es una identidad real
// de cada una: es solo la llave para que el navegador pueda escribir en Firestore.
// La app pregunta "¿quién eres?" aparte, como una etiqueta, no como una clave.
const EMAIL_VENDEDORAS = 'vendedoras@evejeans.local';
const PIN_VENDEDORAS = 'Fontibon2026Eve';

export async function entrarComoVendedoraCompartida() {
  await signInWithEmailAndPassword(auth, EMAIL_VENDEDORAS, PIN_VENDEDORAS);
}

// Nelson sí tiene su propia cuenta real, con su propio PIN — sus permisos especiales
// (aprobar sobres, tocar inventario, etc.) dependen de que esto siga siendo verificado de verdad.
export async function entrarComoNelson(pin) {
  await signInWithEmailAndPassword(auth, 'nelson@evejeans.local', pin);
}

export async function salir() {
  await signOut(auth);
}

export function escucharSesion(callback) {
  return onAuthStateChanged(auth, callback);
}

export function idDesdeEmail(email) {
  if (!email) return null;
  return email.split('@')[0]; // 'nelson' o 'vendedoras'
}
