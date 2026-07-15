const testLogCalls = {
  log: [],
  warn: [],
  error: [],
  debug: [],
  group: [],
  groupEnd: [],
};

jest.doMock('./src/core/logging', () => {
  const originalModule = jest.requireActual('./src/core/logging');

  return {
    ...originalModule,
    consoleLog: (level, ...args) => {
      testLogCalls[level].push(args);
    },
    setLoggers: originalModule.setLoggers,
    getLoggers: originalModule.getLoggers,
  };
});

global.getTestLogCalls = () => ({ ...testLogCalls });
global.clearTestLogCalls = () => {
  Object.keys(testLogCalls).forEach((level) => {
    testLogCalls[level].length = 0;
  });
};

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
        return expectedArgs[index].asymmetricMatch(arg);
      }

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

beforeEach(() => {
  global.clearTestLogCalls();
});

jest.setTimeout(10000);
