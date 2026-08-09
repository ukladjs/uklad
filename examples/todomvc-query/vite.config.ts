import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // The root DevTools scripts explicitly allow this exact browser origin.
    // Do not silently move to another port: that would drop the inspector
    // connection and make the example misleading.
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.TODO_API_PORT ?? '8787'}`,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@ukladjs/core/vanilla': fileURLToPath(
        new URL('../../packages/core/src/vanilla.ts', import.meta.url),
      ),
      '@ukladjs/core/react': fileURLToPath(
        new URL('../../packages/core/src/react.ts', import.meta.url),
      ),
      '@ukladjs/core/devtools': fileURLToPath(
        new URL('../../packages/core/src/devtools.ts', import.meta.url),
      ),
      '@ukladjs/core/testing': fileURLToPath(
        new URL('../../packages/core/src/testing.ts', import.meta.url),
      ),
      '@ukladjs/core/internal': fileURLToPath(
        new URL('../../packages/core/src/internal.ts', import.meta.url),
      ),
      '@ukladjs/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
      '@ukladjs/tanstack-query': fileURLToPath(
        new URL('../../packages/tanstack-query/src/index.ts', import.meta.url),
      ),
      '@ukladjs/devtools': fileURLToPath(
        new URL('../../packages/devtools/src/index.ts', import.meta.url),
      ),
    },
  },
});
