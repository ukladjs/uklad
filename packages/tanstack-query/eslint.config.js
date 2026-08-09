import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['coverage', 'dist', 'node_modules']),
  {
    files: [
      'src/**/*.ts',
      'tests/**/*.{ts,mts,cts,js,mjs,cjs}',
      'tsdown.config.ts',
      'jest.config.mjs',
    ],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'separate-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['tests/package-consumer/fixture/*.{cts,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
