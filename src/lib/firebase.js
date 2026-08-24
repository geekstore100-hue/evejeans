import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDLeWeuVi9N_x3mq_zSczQgFMZyrJd5GF4',
  authDomain: 'evejeans.firebaseapp.com',
  projectId: 'evejeans',
  storageBucket: 'evejeans.firebasestorage.app',
  messagingSenderId: '275213763689',
  appId: '1:275213763689:web:7f2143732620266c008ef8',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Caché local persistente: si se va el internet, la app sigue leyendo lo último
// que vio y guarda lo nuevo en el disco del computador hasta poder subirlo.
// persistentMultipleTabManager permite tener la app abierta en más de una
// pestaña del mismo computador sin que se bloqueen entre sí.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
