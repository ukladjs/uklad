import { createDefaultPreset } from 'ts-jest';

const tsJest = createDefaultPreset({
  tsconfig: '<rootDir>/tsconfig.jest.json',
});

export default {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/implementations/', '/examples/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: tsJest.transform,
  coverageProvider: 'v8',
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/src/tests/'],
  testEnvironmentOptions: {
    customExportConditions: ['react-jsx'],
  },
  // Suppress expected console output during tests
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
