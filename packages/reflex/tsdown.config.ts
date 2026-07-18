import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vanilla: 'src/vanilla.ts',
    react: 'src/react.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  fixedExtension: true,
  clean: true,
  dts: true,
  publint: {
    level: 'error',
  },
  attw: {
    profile: 'node16',
    level: 'error',
  },
});
