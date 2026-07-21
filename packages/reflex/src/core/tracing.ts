import { consoleLog } from './logging';
import { type RuntimeKernel } from '../runtime/kernel';

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

export interface TraceState {
  readonly callbacks: Map<string, TraceCallback>;
  nextId: number;
  traces: Trace[];
  currentTrace: Trace | null;
  manualTraceEnabled: boolean;
  traceLeaseCount: number;
  traceEnabled: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

function getTraceState(runtime: RuntimeKernel): TraceState {
  return (runtime.tracing ??= {
    callbacks: new Map(),
    nextId: 1,
    traces: [],
    currentTrace: null,
    manualTraceEnabled: false,
    traceLeaseCount: 0,
    traceEnabled: false,
    flushTimer: null,
  });
}

/** @internal Enable the manual trace owner for one runtime. */
export function enableTracingForKernel(runtime: RuntimeKernel): void {
  const state = getTraceState(runtime);
  state.manualTraceEnabled = true;
  updateTraceEnabled(state);
}

/** @internal Release the manual trace owner for one runtime. */
export function disableTracingForKernel(runtime: RuntimeKernel): void {
  const state = getTraceState(runtime);
  state.manualTraceEnabled = false;
  updateTraceEnabled(state);
}

/** @internal Keep one runtime's tracing active for an integration subscriber. */
export function acquireTracingForKernel(runtime: RuntimeKernel): () => void {
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

/** @internal Return whether one runtime is collecting traces. */
export function isTraceEnabledForKernel(runtime: RuntimeKernel): boolean {
  return getTraceState(runtime).traceEnabled;
}

function updateTraceEnabled(state: TraceState): void {
  const wasEnabled = state.traceEnabled;
  state.traceEnabled = state.manualTraceEnabled || state.traceLeaseCount > 0;
  if (!state.traceEnabled && wasEnabled) discardPendingTraces(state);
}

/** @internal Register a keyed trace batch callback on one runtime. */
export function registerTraceCallbackForKernel(
  runtime: RuntimeKernel,
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

/** @internal Remove a trace callback from one runtime. */
export function removeTraceCallbackForKernel(runtime: RuntimeKernel, key: string): void {
  getTraceState(runtime).callbacks.delete(key);
}

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

/** @internal Run `fn` inside a trace owned by one runtime. */
export function withTraceForKernel<T>(
  runtime: RuntimeKernel,
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

/** @internal Shallow-merge tags into one runtime's active trace. */
export function mergeTraceForKernel(runtime: RuntimeKernel, update: { tags: TraceTags }): void {
  const state = getTraceState(runtime);
  if (!state.traceEnabled || !state.currentTrace) return;
  state.currentTrace.tags = { ...state.currentTrace.tags, ...update.tags };
}

/** @internal Register the built-in console trace printer on one runtime. */
export function enableTracePrintForKernel(runtime: RuntimeKernel): void {
  registerTraceCallbackForKernel(runtime, 'reflex-default-tracer', (batch) => {
    consoleLog('log', '%c[reflex] [trace] ', 'font-weight: bold; color: blue;', batch);
  });
}

/** @internal Release timers, callbacks, and leases owned by a disposed runtime. */
export function disposeTracingForKernel(runtime: RuntimeKernel): void {
  const state = getTraceState(runtime);
  discardPendingTraces(state);
  state.callbacks.clear();
  state.manualTraceEnabled = false;
  state.traceLeaseCount = 0;
  state.traceEnabled = false;
}
