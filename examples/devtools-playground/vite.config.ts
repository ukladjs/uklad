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
      '@ukladjs/core': fileURLToPath(
        new URL('../../packages/core/src', import.meta.url),
      ),
      '@ukladjs/devtools': fileURLToPath(
        new URL('../../packages/devtools/src', import.meta.url),
      ),
    },
  },
});
