import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

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
    // Exclude reflex-devtools from pre-bundling so it picks up the @flexsurfer/reflex alias
    exclude: ['@flexsurfer/reflex-devtools'],
  },
});
