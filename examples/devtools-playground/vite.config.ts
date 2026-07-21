import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@flexsurfer/reflex': fileURLToPath(
        new URL('../../packages/reflex/src', import.meta.url),
      ),
      '@flexsurfer/reflex-devtools': fileURLToPath(
        new URL('../../packages/reflex-devtools/src', import.meta.url),
      ),
      '@flexsurfer/reflex-operations': fileURLToPath(
        new URL('../../packages/reflex-operations/src', import.meta.url),
      ),
    },
  },
});
