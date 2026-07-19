import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Subpath aliases must precede the bare specifier so they match first.
      // Everything (app + reflex-persist) must resolve reflex to the same
      // source modules — two reflex copies would mean two default runtimes.
      '@flexsurfer/reflex/vanilla': fileURLToPath(
        new URL('../../packages/reflex/src/vanilla.ts', import.meta.url),
      ),
      '@flexsurfer/reflex/react': fileURLToPath(
        new URL('../../packages/reflex/src/react.ts', import.meta.url),
      ),
      '@flexsurfer/reflex': fileURLToPath(
        new URL('../../packages/reflex/src/index.ts', import.meta.url),
      ),
      '@flexsurfer/reflex-persist': fileURLToPath(
        new URL('../../packages/reflex-persist/src/index.ts', import.meta.url),
      ),
      '@flexsurfer/reflex-devtools': fileURLToPath(
        new URL('../../packages/reflex-devtools/src/index.ts', import.meta.url),
      ),
    },
  },
});
