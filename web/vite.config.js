import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Kodi i përbashkët (role, formula, llogaritje stoku) jeton te functions/src/shared
// që të përdoret njësoj nga serveri dhe nga aplikacioni.
export default defineConfig({
  plugins: [react()],
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
