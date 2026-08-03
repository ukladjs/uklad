import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Subpath aliases must precede the bare specifier so they match first.
      // Everything (app + uklad-persist) must resolve uklad to the same
      // source modules — two Uklad copies would create incompatible runtime identities.
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
      '@ukladjs/persist': fileURLToPath(
        new URL('../../packages/persist/src/index.ts', import.meta.url),
      ),
      '@ukladjs/devtools': fileURLToPath(
        new URL('../../packages/devtools/src/index.ts', import.meta.url),
      ),
    },
  },
});
