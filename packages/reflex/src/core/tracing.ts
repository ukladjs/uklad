import { consoleLog } from './logging';
import { defaultRuntimeScope, type RuntimeScope } from '../runtime/scope';

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

interface TraceState {
  readonly callbacks: Map<string, TraceCallback>;
  nextId: number;
  traces: Trace[];
  currentTrace: Trace | null;
  manualTraceEnabled: boolean;
  traceLeaseCount: number;
  traceEnabled: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const traceStates = new WeakMap<RuntimeScope, TraceState>();

function getTraceState(runtime: RuntimeScope): TraceState {
  let state = traceStates.get(runtime);
  if (!state) {
    state = {
      callbacks: new Map(),
      nextId: 1,
      traces: [],
      currentTrace: null,
      manualTraceEnabled: false,
      traceLeaseCount: 0,
      traceEnabled: false,
      flushTimer: null,
    };
    traceStates.set(runtime, state);
  }
  return state;
}

/** Keep trace collection enabled until `disableTracing` releases this manual owner. */
export function enableTracing(): void {
  enableTracingForRuntime(defaultRuntimeScope);
}

/** @internal Enable the manual trace owner for one runtime. */
export function enableTracingForRuntime(runtime: RuntimeScope): void {
  const state = getTraceState(runtime);
  state.manualTraceEnabled = true;
  updateTraceEnabled(state);
}

/** Release the compatibility runtime's manual tracing owner. */
export function disableTracing(): void {
  disableTracingForRuntime(defaultRuntimeScope);
}

/** @internal Release the manual trace owner for one runtime. */
export function disableTracingForRuntime(runtime: RuntimeScope): void {
  const state = getTraceState(runtime);
  state.manualTraceEnabled = false;
  updateTraceEnabled(state);
}

/** @internal Keep tracing active for one integration subscriber. */
export function acquireTracing(): () => void {
  return acquireTracingForRuntime(defaultRuntimeScope);
}

/** @internal Keep one runtime's tracing active for an integration subscriber. */
export function acquireTracingForRuntime(runtime: RuntimeScope): () => void {
  const state = getTraceState(runtime);
  state.traceLeaseCount++;
  updateTraceEnabled(state);

  let acquired = true;
  return () => {
    if (!acquired) return;
    acquired = false;
    // Runtime disposal releases all leases at once. A consumer may still call
    // its idempotent cleanup afterward, so never let the retained state drift
    // below zero.
    state.traceLeaseCount = Math.max(0, state.traceLeaseCount - 1);
    updateTraceEnabled(state);
  };
}

function discardPendingTraces(state: TraceState): void {
  state.traces = [];
  state.currentTrace = null;
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
}

/** Return whether completed traces are currently collected. */
export function isTraceEnabled(): boolean {
  return isTraceEnabledForRuntime(defaultRuntimeScope);
}

/** @internal Return whether one runtime is collecting traces. */
export function isTraceEnabledForRuntime(runtime: RuntimeScope): boolean {
  return getTraceState(runtime).traceEnabled;
}

function updateTraceEnabled(state: TraceState): void {
  const wasEnabled = state.traceEnabled;
  state.traceEnabled = state.manualTraceEnabled || state.traceLeaseCount > 0;
  if (!state.traceEnabled && wasEnabled) discardPendingTraces(state);
}

/** Register a keyed trace batch callback on the compatibility runtime. */
export function registerTraceCallback(key: string, callback: TraceCallback): void {
  registerTraceCallbackForRuntime(defaultRuntimeScope, key, callback);
}

/** @internal Register a keyed trace batch callback on one runtime. */
export function registerTraceCallbackForRuntime(
  runtime: RuntimeScope,
  key: string,
  callback: TraceCallback,
): void {
  const state = getTraceState(runtime);
  if (!state.traceEnabled) {
    consoleLog(
      'warn',
      '[reflex] [trace] Tracing is not enabled; call enableTracing() before registering callbacks',
    );
    return;
  }
  state.callbacks.set(key, callback);
}

/** Remove the trace callback registered under `key`, if present. */
export function removeTraceCallback(key: string): void {
  removeTraceCallbackForRuntime(defaultRuntimeScope, key);
}

/** @internal Remove a trace callback from one runtime. */
export function removeTraceCallbackForRuntime(runtime: RuntimeScope, key: string): void {
  getTraceState(runtime).callbacks.delete(key);
}

/** @deprecated Use `registerTraceCallback`. */
export const registerTraceCb: typeof registerTraceCallback = registerTraceCallback;

/** @deprecated Use `removeTraceCallback`. */
export const removeTraceCb: typeof removeTraceCallback = removeTraceCallback;

function scheduleFlush(state: TraceState): void {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(() => {
    const batch = state.traces.slice();
    state.traces = [];
    state.flushTimer = null;
    for (const callback of state.callbacks.values()) {
      try {
        callback(batch);
      } catch (error) {
        consoleLog('warn', 'Error in trace callback', error);
      }
    }
  }, TRACE_BATCH_DELAY_MS);
}

function startTrace(state: TraceState, options: TraceOptions): Trace {
  const parentId = options.childOf ?? state.currentTrace?.id;
  return {
    id: state.nextId++,
    ...(options.operation === undefined ? {} : { operation: options.operation }),
    ...(options.opType === undefined ? {} : { opType: options.opType }),
    tags: options.tags ?? {},
    ...(parentId === undefined ? {} : { childOf: parentId }),
    start: Date.now(),
  };
}

function finishTrace(state: TraceState, trace: Trace): void {
  if (!state.traceEnabled) return;
  trace.end = Date.now();
  trace.duration = trace.end - trace.start;
  state.traces.push(trace);
  scheduleFlush(state);
}

/** Run `fn` inside a trace on the compatibility runtime. */
export function withTrace<T>(options: TraceOptions, fn: () => T): T {
  return withTraceForRuntime(defaultRuntimeScope, options, fn);
}

/** @internal Run `fn` inside a trace owned by one runtime. */
export function withTraceForRuntime<T>(
  runtime: RuntimeScope,
  options: TraceOptions,
  fn: () => T,
): T {
  const state = getTraceState(runtime);
  if (!state.traceEnabled) return fn();
  const parent = state.currentTrace;
  state.currentTrace = startTrace(state, options);
  try {
    return fn();
  } finally {
    finishTrace(state, state.currentTrace);
    state.currentTrace = parent;
  }
}

/** Shallow-merge tags into the compatibility runtime's active trace. */
export function mergeTrace(update: { tags: TraceTags }): void {
  mergeTraceForRuntime(defaultRuntimeScope, update);
}

/** @internal Shallow-merge tags into one runtime's active trace. */
export function mergeTraceForRuntime(runtime: RuntimeScope, update: { tags: TraceTags }): void {
  const state = getTraceState(runtime);
  if (!state.traceEnabled || !state.currentTrace) return;
  state.currentTrace.tags = { ...state.currentTrace.tags, ...update.tags };
}

/** Register the built-in console trace printer on the compatibility runtime. */
export function enableTracePrint(): void {
  enableTracePrintForRuntime(defaultRuntimeScope);
}

/** @internal Register the built-in console trace printer on one runtime. */
export function enableTracePrintForRuntime(runtime: RuntimeScope): void {
  registerTraceCallbackForRuntime(runtime, 'reflex-default-tracer', (batch) => {
    consoleLog('log', '%c[reflex] [trace] ', 'font-weight: bold; color: blue;', batch);
  });
}

/** @internal Release timers, callbacks, and leases owned by a disposed runtime. */
export function disposeTracingForRuntime(runtime: RuntimeScope): void {
  const state = getTraceState(runtime);
  discardPendingTraces(state);
  state.callbacks.clear();
  state.manualTraceEnabled = false;
  state.traceLeaseCount = 0;
  state.traceEnabled = false;
}
