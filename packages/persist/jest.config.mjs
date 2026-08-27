import { createDefaultPreset } from 'ts-jest';

const tsJest = createDefaultPreset({
  tsconfig: '<rootDir>/tsconfig.jest.json',
});

export default {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleFileExtensions: ['ts', 'js'],
  transform: tsJest.transform,
  coverageProvider: 'v8',
  collectCoverageFrom: ['src/**/*.ts', '!src/tests/**', '!src/types.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/src/tests/'],
  coverageThreshold: {
    global: {
      statements: 88,
      branches: 79,
      functions: 91,
      lines: 88,
    },
  },
};
