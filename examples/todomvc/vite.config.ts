import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@flexsurfer/reflex': fileURLToPath(
        new URL('../../packages/reflex/src/index.ts', import.meta.url),
      ),
      '@flexsurfer/reflex-devtools': fileURLToPath(
        new URL('../../packages/reflex-devtools/src/index.ts', import.meta.url),
      ),
    },
  },
});
