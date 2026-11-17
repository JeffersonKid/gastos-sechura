// Cuentas y sincronización con Firebase (Auth + Firestore). Se carga solo si hay configuración.
// Cada persona solo ve lo suyo: users/{uid}/... (reglas de seguridad en el README).
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, deleteDoc, collection, onSnapshot } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

let auth;
let db;

export function initCloud() {
  if (!firebaseConfig) return false;
  if (!auth) {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    // Caché local persistente: funciona sin conexión y sincroniza al volver internet.
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  }
  return true;
}

export const onUser = (cb) => onAuthStateChanged(auth, cb);
export const signUp = (email, pass) => createUserWithEmailAndPassword(auth, email, pass);
export const signIn = (email, pass) => signInWithEmailAndPassword(auth, email, pass);
export const signOut = () => fbSignOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

const clean = (o) => JSON.parse(JSON.stringify(o));
export const saveGasto = (uid, g) => setDoc(doc(db, 'users', uid, 'gastos', g.hid), clean(g));
export const deleteGasto = (uid, hid) => deleteDoc(doc(db, 'users', uid, 'gastos', hid));
export const subscribeGastos = (uid, cb, err) =>
  onSnapshot(collection(db, 'users', uid, 'gastos'), (s) => cb(s.docs.map((d) => d.data())), err);

export const saveExcel = (uid, x) => setDoc(doc(db, 'users', uid, 'meta', 'excel'), clean(x));
export const subscribeExcel = (uid, cb, err) =>
  onSnapshot(doc(db, 'users', uid, 'meta', 'excel'), (s) => cb(s.exists() ? s.data() : null), err);
