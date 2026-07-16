import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@flexsurfer/reflex': path.resolve(__dirname, '../../packages/reflex/src'),
      '@flexsurfer/reflex-devtools': path.resolve(__dirname, '../../packages/reflex-devtools/src')
    }
  }
}); 
