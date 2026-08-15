import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vanilla: 'src/vanilla.ts',
    react: 'src/react.ts',
    devtools: 'src/devtools.ts',
    testing: 'src/testing.ts',
    internal: 'src/internal.ts',
    'agent-cli': 'src/agent-cli.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  deps: {
    neverBundle: [/^node:/],
  },
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
