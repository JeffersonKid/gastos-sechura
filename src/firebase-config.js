// Configuración del proyecto Firebase "gastos-sechura" (cuentas + base de datos).
// Estos valores NO son secretos: identifican el proyecto. La seguridad la dan las reglas de Firestore
// (cada persona solo accede a users/{su-uid}/...; ver README) y los dominios autorizados de Authentication.
// Si es `null`, la app funciona en modo local (sin cuentas).
export const firebaseConfig = {
  apiKey: 'AIzaSyCCH2IPbiYIPv6HrL7C8xic4PFckFbtL2Q',
  authDomain: 'gastos-sechura.firebaseapp.com',
  projectId: 'gastos-sechura',
  storageBucket: 'gastos-sechura.firebasestorage.app',
  messagingSenderId: '892241453298',
  appId: '1:892241453298:web:22219afd4507b3e570b06b',
};
