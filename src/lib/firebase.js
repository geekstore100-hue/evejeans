import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export const db = getFirestore(app);
