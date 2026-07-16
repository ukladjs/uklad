import { consoleLog } from './logging';

export type TraceId = number;
export type TraceTags = Record<string, unknown>;

export interface TraceOptions {
  operation?: string;
  opType?: string;
  tags?: TraceTags;
  childOf?: TraceId;
}

export interface Trace extends TraceOptions {
  id: TraceId;
  start: number;
  end?: number;
  duration?: number;
}

export type TraceCallback = (traces: Trace[]) => void;

const TRACE_BATCH_DELAY_MS = 50;
const traceCallbacks = new Map<string, TraceCallback>();

let nextId = 1;
let traces: Trace[] = [];
let currentTrace: Trace | null = null;
let traceEnabled = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Enable collection of traces completed after this call. */
export function enableTracing(): void {
  traceEnabled = true;
}

/** Disable tracing and discard pending traces without removing callbacks. */
export function disableTracing(): void {
  traceEnabled = false;
  resetTracing();
}

/** Reset trace IDs and pending trace state without changing enablement or callbacks. */
function resetTracing(): void {
  nextId = 1;
  traces = [];
  currentTrace = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/** Return whether completed traces are currently collected. */
export function isTraceEnabled(): boolean {
  return traceEnabled;
}

/**
 * Register a keyed batch callback, replacing any callback with the same key.
 *
 * Registration is ignored with a warning unless tracing is already enabled.
 * Batches are delivered after a 50 ms window; callback failures are logged and
 * do not prevent the remaining callbacks from running.
 */
export function registerTraceCallback(key: string, callback: TraceCallback): void {
  if (!traceEnabled) {
    consoleLog(
      'warn',
      '[reflex] [trace] Tracing is not enabled; call enableTracing() before registering callbacks',
    );
    return;
  }
  traceCallbacks.set(key, callback);
}

/** Remove the trace callback registered under `key`, if present. */
export function removeTraceCallback(key: string): void {
  traceCallbacks.delete(key);
}

/** @deprecated Use `registerTraceCallback`. */
export const registerTraceCb: typeof registerTraceCallback = registerTraceCallback;

/** @deprecated Use `removeTraceCallback`. */
export const removeTraceCb: typeof removeTraceCallback = removeTraceCallback;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const batch = traces.slice();
    traces = [];
    flushTimer = null;
    for (const callback of traceCallbacks.values()) {
      try {
        callback(batch);
      } catch (error) {
        consoleLog('warn', 'Error in trace callback', error);
      }
    }
  }, TRACE_BATCH_DELAY_MS);
}

/** Create a trace whose parent defaults to the active synchronous trace. */
function startTrace(options: TraceOptions): Trace {
  const parentId = options.childOf ?? currentTrace?.id;
  return {
    id: nextId++,
    ...(options.operation === undefined ? {} : { operation: options.operation }),
    ...(options.opType === undefined ? {} : { opType: options.opType }),
    tags: options.tags ?? {},
    ...(parentId === undefined ? {} : { childOf: parentId }),
    start: Date.now(),
  };
}

/** Finish and enqueue a trace when tracing is enabled. */
function finishTrace(trace: Trace): void {
  if (!traceEnabled) return;
  trace.end = Date.now();
  trace.duration = trace.end - trace.start;
  traces.push(trace);
  scheduleFlush();
}

/**
 * Run `fn` inside a trace and restore the previous parent even when it throws.
 *
 * The scope is synchronous: if `fn` returns a promise, the trace ends when the
 * promise is returned rather than when it settles.
 */
export function withTrace<T>(options: TraceOptions, fn: () => T): T {
  if (!traceEnabled) {
    return fn();
  }
  const parent = currentTrace;
  currentTrace = startTrace(options);
  try {
    return fn();
  } finally {
    finishTrace(currentTrace);
    currentTrace = parent;
  }
}

/** Shallow-merge tags into the active trace when tracing is enabled. */
export function mergeTrace(update: { tags: TraceTags }): void {
  if (!traceEnabled || !currentTrace) {
    return;
  }
  currentTrace.tags = { ...currentTrace.tags, ...update.tags };
}

/** Register the built-in console trace printer. Tracing must already be enabled. */
export function enableTracePrint(): void {
  registerTraceCallback('reflex-default-tracer', (batch) => {
    consoleLog('log', '%c[reflex] [trace] ', 'font-weight: bold; color: blue;', batch);
  });
}
