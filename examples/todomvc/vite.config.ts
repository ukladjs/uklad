import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lib': fileURLToPath(new URL('../../src', import.meta.url)),
      // The released devtools client still imports a legacy diagnostics API.
      // Adapt it locally while sharing the app's Reflex singleton.
      '@flexsurfer/reflex': fileURLToPath(
        new URL('./src/reflex-devtools-compat.ts', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    // Pre-bundling would bypass the compatibility alias above.
    exclude: ['@flexsurfer/reflex-devtools'],
  },
});
