import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['coverage', 'dist', 'examples/todomvc/dist', 'node_modules']),
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'tsdown.config.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
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
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/{core,events,runtime,subscriptions}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'React dependencies belong in src/react.',
            },
            {
              name: 'react-dom',
              message: 'React dependencies belong in src/react.',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*'],
              message: 'React dependencies belong in src/react.',
            },
            {
              group: ['../index', '../../index', '../../../index'],
              message: 'Internal modules must import concrete files, not the public index.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/react/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../index', '../../index', '../../../index'],
              message: 'Internal modules must import concrete files, not the public index.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'React dependencies belong in src/react.',
            },
            {
              name: 'react-dom',
              message: 'React dependencies belong in src/react.',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*'],
              message: 'React dependencies belong in src/react.',
            },
            {
              group: ['../index', '../../index', '../../../index'],
              message: 'Internal modules must import concrete files, not the public index.',
            },
            {
              group: ['../runtime/**', '../../runtime/**', '../../../runtime/**'],
              message: 'Core primitives must not import runtime services.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['jest.config.mjs', 'jest.setup.js', 'tests/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    files: ['tests/types/**/*.{ts,tsx}', 'tests/legacy-consumer/fixture/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]);
