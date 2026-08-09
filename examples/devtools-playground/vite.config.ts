import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api/playground': {
        target: `http://127.0.0.1:${process.env.PLAYGROUND_API_PORT ?? '8788'}`,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@ukladjs/core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)),
      '@ukladjs/tanstack-query': fileURLToPath(
        new URL('../../packages/tanstack-query/src/index.ts', import.meta.url),
      ),
      '@ukladjs/devtools': fileURLToPath(new URL('../../packages/devtools/src', import.meta.url)),
    },
  },
});
