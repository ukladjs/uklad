type LogLevel = 'log' | 'warn' | 'error' | 'debug' | 'group' | 'groupEnd';

export interface Loggers {
  log: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  group: (...args: any[]) => void;
  groupEnd: (...args: any[]) => void;
}

const hasGroup = typeof console.group === 'function';
const hasGroupEnd = typeof console.groupEnd === 'function';

const defaultLoggers: Loggers = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
  group: hasGroup ? console.group.bind(console) : console.log.bind(console),
  groupEnd: hasGroupEnd ? console.groupEnd.bind(console) : () => {},
};

let currentLoggers: Loggers = { ...defaultLoggers };

/** Route a message through the currently configured logger. */
export function consoleLog(level: LogLevel, ...args: any[]): void {
  if (!(level in currentLoggers)) {
    throw new Error(`uklad: log called with unknown level: ${level}`);
  }
  currentLoggers[level](...args);
}

/** Merge logger overrides into the current configuration. */
export function setLoggers(newLoggers: Partial<Loggers>): void {
  const keys = Object.keys(newLoggers);
  const allowed = Object.keys(defaultLoggers);
  const invalid = keys.filter((key) => !allowed.includes(key));
  if (invalid.length > 0) {
    throw new Error(`uklad: Unknown keys in newLoggers: ${invalid.join(', ')}`);
  }
  currentLoggers = { ...currentLoggers, ...newLoggers } as Loggers;
}

/** Return a snapshot of the current logger configuration. */
export function getLoggers(): Loggers {
  return { ...currentLoggers };
}
