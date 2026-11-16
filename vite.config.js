import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Genera precache.json (lista de archivos de la app) para que el Service Worker
// deje la aplicación disponible sin conexión después de la primera visita.
function precache() {
  return {
    name: 'precache-manifest',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), precache()],
  build: { chunkSizeWarningLimit: 2500 },
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
});
