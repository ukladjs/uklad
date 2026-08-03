import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@flexsurfer/reflex': fileURLToPath(
        new URL('../reflex/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
