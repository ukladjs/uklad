// Global Jest setup using Jest module mocking for loggers

// Track all log calls for test assertions
const testLogCalls = {
  log: [],
  warn: [],
  error: [],
  debug: [],
  group: [],
  groupEnd: [],
};

// Mock the loggers module before any imports
jest.doMock('./src/loggers', () => {
  const originalModule = jest.requireActual('./src/loggers');

  return {
    ...originalModule,
    consoleLog: (level, ...args) => {
      testLogCalls[level].push(args);
    },
    setLoggers: originalModule.setLoggers,
    getLoggers: originalModule.getLoggers,
  };
});

// Make test log calls available globally for test assertions
global.getTestLogCalls = () => ({ ...testLogCalls });
global.clearTestLogCalls = () => {
  Object.keys(testLogCalls).forEach((level) => {
    testLogCalls[level].length = 0;
  });
};

// Helper function for tests to assert log calls
global.expectLogCall = (level, ...expectedArgs) => {
  const calls = testLogCalls[level];
  const matchingCall = calls.find((call) => {
    if (call.length !== expectedArgs.length) {
      return false;
    }

    return call.every((arg, index) => {
      if (
        typeof expectedArgs[index] === 'object' &&
        expectedArgs[index] &&
        expectedArgs[index].asymmetricMatch
      ) {
        // Handle jest matchers like expect.any(Error)
        return expectedArgs[index].asymmetricMatch(arg);
      }

      // Deep equality check for arrays and objects
      if (Array.isArray(expectedArgs[index]) && Array.isArray(arg)) {
        return JSON.stringify(arg) === JSON.stringify(expectedArgs[index]);
      }

      return arg === expectedArgs[index];
    });
  });

  if (!matchingCall) {
    throw new Error(
      `Expected ${level} call with args: ${JSON.stringify(expectedArgs)}\nActual calls: ${JSON.stringify(calls)}`,
    );
  }
  return true;
};

// Clear log calls before each test
beforeEach(() => {
  global.clearTestLogCalls();
});

// Global test timeout
jest.setTimeout(10000);
