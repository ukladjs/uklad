import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  fixedExtension: true,
  clean: true,
  dts: true,
});
