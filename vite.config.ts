import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1' },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep the shared CommonJS helper out of the lazy terminal chunk.
          // Otherwise the entry imports that helper and eagerly loads all of xterm.
          if (id.includes('commonjsHelpers')) return 'runtime';
          if (id.includes('/@xterm/')) return 'terminal';
        },
      },
    },
  },
});
