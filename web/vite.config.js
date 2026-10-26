import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Lista e skedarëve të ndërtimit, që service worker-i (public/sw.js) t'i ruajë për punë pa internet.
const precacheList = () => ({
  name: 'superpool-precache',
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => `/${f}`);
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
  },
});

// Kodi i përbashkët (role, formula, llogaritje stoku) jeton te functions/src/shared
// që të përdoret njësoj nga serveri dhe nga aplikacioni.
export default defineConfig({
  plugins: [react(), precacheList()],
  // Ndryshon në çdo ndërtim: service worker-i rinstalohet dhe ruan versionin e ri të aplikacionit.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../functions/src/shared', import.meta.url)) },
  },
  server: { fs: { allow: ['..'] } },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('exceljs')) return 'excel';
          if (id.includes('jspdf')) return 'pdf';
          if (id.includes('firebase')) return 'firebase';
          return undefined;
        },
      },
    },
  },
});
