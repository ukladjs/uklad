declare global {
  function getTestLogCalls(): {
    log: any[][];
    warn: any[][];
    error: any[][];
    debug: any[][];
    group: any[][];
    groupEnd: any[][];
  };

  function clearTestLogCalls(): void;

  function expectLogCall(
    level: 'log' | 'warn' | 'error' | 'debug' | 'group' | 'groupEnd',
    ...expectedArgs: any[]
  ): boolean;
}

export {};
