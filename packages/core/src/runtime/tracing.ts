import { consoleLog } from '../core/logging';
import { attachRuntimeProbe, getRuntimeTrackingToken } from './probe';

import type { RuntimeCore } from './core';
import type {
  RuntimeProbe,
  RuntimeProbeEffect,
  RuntimeProbeEventMetadata,
  RuntimeProbeParent,
  RuntimeProbeSpan,
  RuntimeProbeTransition,
} from './probe-types';
import type { EventVector } from '../types';
import type {
  Trace,
  TraceCallback,
  TraceErrorTag,
  TraceOptions,
  TraceTags,
} from '../core/tracing-types';

export type {
  Trace,
  TraceCallback,
  TraceErrorTag,
  TraceId,
  TraceOptions,
  TraceTags,
} from '../core/tracing-types';

interface TraceEventToken {
  readonly event: EventVector;
  readonly metadata: RuntimeProbeEventMetadata;
  readonly parentTraceId?: number;
  trace?: Trace;
  previousTrace?: Trace | null;
}

interface TraceSpanToken {
  readonly trace: Trace;
  readonly previousTrace: Trace | null;
}

interface TraceState {
  readonly callbacks: Map<string, TraceCallback>;
  readonly probe: RuntimeProbe;
  nextId: number;
  traces: Trace[];
  currentTrace: Trace | null;
  manualTraceEnabled: boolean;
  traceLeaseCount: number;
  traceEnabled: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  detachProbe: (() => void) | undefined;
}

const TRACE_BATCH_DELAY_MS = 50;
const TRACE_STATES = new WeakMap<RuntimeCore, TraceState>();

/** @internal Enable the manual trace owner for one runtime. */
export function enableTracing(runtime: RuntimeCore): void {
  const state = getTraceState(runtime);
  state.manualTraceEnabled = true;
  updateTraceEnabled(runtime, state);
}

/** @internal Release the manual trace owner for one runtime. */
export function disableTracing(runtime: RuntimeCore): void {
  const state = getTraceState(runtime);
  state.manualTraceEnabled = false;
  updateTraceEnabled(runtime, state);
}

/** @internal Keep one runtime's tracing active for an integration subscriber. */
export function acquireTracing(runtime: RuntimeCore): () => void {
  const state = getTraceState(runtime);
  state.traceLeaseCount++;
  updateTraceEnabled(runtime, state);

  let acquired = true;
  return () => {
    if (!acquired) return;
    acquired = false;
    state.traceLeaseCount = Math.max(0, state.traceLeaseCount - 1);
    updateTraceEnabled(runtime, state);
  };
}

/** @internal Return whether one runtime is collecting traces. */
export function isTraceEnabled(runtime: RuntimeCore): boolean {
  return peekTraceState(runtime)?.traceEnabled ?? false;
}

/** @internal Register a keyed trace batch callback on one runtime. */
export function registerTraceCallback(
  runtime: RuntimeCore,
  key: string,
  callback: TraceCallback,
): void {
  const state = getTraceState(runtime);
  if (!state.traceEnabled) {
    consoleLog(
      'warn',
      '[uklad] [trace] Tracing is not enabled; call enableTracing() before registering callbacks',
    );
    return;
  }
  state.callbacks.set(key, callback);
}

/** @internal Remove a trace callback from one runtime. */
export function removeTraceCallback(runtime: RuntimeCore, key: string): void {
  peekTraceState(runtime)?.callbacks.delete(key);
}

/**
 * Legacy internal helper implemented through the same optional probe channel.
 * Hot-path callers should prefer `withRuntimeProbeSpan`.
 */
export function withOptionalTrace<T>(
  runtime: RuntimeCore,
  createOptions: () => TraceOptions,
  fn: () => T,
): T {
  const state = peekTraceState(runtime);
  if (!state?.traceEnabled) return fn();
  const token = state.probe.spanStarted!(createOptions()) as TraceSpanToken;
  try {
    return fn();
  } finally {
    state.probe.spanFinished!(token);
  }
}

/** @internal Build trace tags only when an active trace can receive them. */
export function mergeOptionalTrace(runtime: RuntimeCore, createTags: () => TraceTags): void {
  const state = peekTraceState(runtime);
  if (!state?.traceEnabled || !state.currentTrace) return;
  state.currentTrace.tags = { ...state.currentTrace.tags, ...createTags() };
}

/** @internal Register the built-in console trace printer on one runtime. */
export function enableTracePrint(runtime: RuntimeCore): void {
  registerTraceCallback(runtime, 'uklad-default-tracer', (batch) => {
    consoleLog('log', '%c[uklad] [trace] ', 'font-weight: bold; color: blue;', batch);
  });
}

/** @internal Release timers, callbacks, and the optional probe attachment. */
export function disposeTracing(runtime: RuntimeCore): void {
  const state = peekTraceState(runtime);
  if (!state) return;
  state.detachProbe?.();
  state.detachProbe = undefined;
  discardPendingTraces(state);
  state.callbacks.clear();
  state.manualTraceEnabled = false;
  state.traceLeaseCount = 0;
  state.traceEnabled = false;
  TRACE_STATES.delete(runtime);
}

function getTraceState(runtime: RuntimeCore): TraceState {
  const existing = TRACE_STATES.get(runtime);
  if (existing) return existing;

  const currentState = (): TraceState => {
    const state = TRACE_STATES.get(runtime);
    if (!state) throw new Error('[uklad] Trace probe used before initialization.');
    return state;
  };
  const probe: RuntimeProbe = Object.freeze({
    needsPatches: true,
    needsSubscriptionEvidence: false,
    needsSpans: true,
    eventAccepted(
      event: EventVector,
      parent: RuntimeProbeParent | undefined,
      metadata: RuntimeProbeEventMetadata | undefined,
    ): TraceEventToken {
      if (!metadata) {
        throw new Error('[uklad] Trace probe accepted an event without runtime metadata.');
      }
      const parentToken = getRuntimeTrackingToken(parent?.tracking, probe) as
        TraceEventToken | undefined;
      return {
        event,
        metadata,
        ...(parentToken?.trace === undefined ? {} : { parentTraceId: parentToken.trace.id }),
      };
    },
    eventStarted(token: unknown): void {
      const state = currentState();
      const eventToken = token as TraceEventToken;
      eventToken.previousTrace = state.currentTrace;
      eventToken.trace = startTrace(state, {
        operation: eventToken.event[0],
        opType: 'event',
        tags: { event: eventToken.event },
        runtimeInstanceId: eventToken.metadata.runtimeInstanceId,
        eventInstanceId: eventToken.metadata.eventInstanceId,
        ...(eventToken.metadata.parentEventInstanceId === undefined
          ? {}
          : { parentEventInstanceId: eventToken.metadata.parentEventInstanceId }),
        ...(eventToken.parentTraceId === undefined ? {} : { childOf: eventToken.parentTraceId }),
      });
      state.currentTrace = eventToken.trace;
    },
    transition(token: unknown, result: RuntimeProbeTransition): void {
      const eventToken = token as TraceEventToken;
      const trace = eventToken.trace;
      if (!trace) return;
      const tags: TraceTags = {
        ...trace.tags,
        ...(result.effects === undefined ? {} : { effects: result.effects }),
        ...(result.patches === undefined ? {} : { patches: result.patches }),
        ...(result.reversePatches === undefined ? {} : { reversePatches: result.reversePatches }),
      };
      const error = toTraceError(eventToken.event, result);
      if (error && tags.error === undefined) tags.error = error;
      trace.tags = tags;
    },
    effect(token: unknown, effect: RuntimeProbeEffect): void {
      if (effect.status !== 'failed') return;
      const eventToken = token as TraceEventToken;
      const trace = eventToken.trace;
      if (!trace) return;
      // A finished trace has been batched and may already have been delivered,
      // so it is no longer amendable. A detached effect that rejects that late
      // is traced on its own instead of mutating a record someone else holds.
      if (trace.end !== undefined) {
        traceDetachedEffectFailure(currentState(), trace, eventToken.event, effect);
        return;
      }
      const effectErrors = Array.isArray(trace.tags?.effectErrors)
        ? [...(trace.tags!.effectErrors as unknown[])]
        : [];
      effectErrors.push(toEffectTraceError(effect));
      trace.tags = { ...trace.tags, effectErrors };
    },
    eventFinished(token: unknown): void {
      const state = currentState();
      const eventToken = token as TraceEventToken;
      if (!eventToken.trace) return;
      finishTrace(state, eventToken.trace);
      state.currentTrace = eventToken.previousTrace ?? null;
    },
    spanStarted(span: RuntimeProbeSpan): TraceSpanToken {
      const state = currentState();
      const previousTrace = state.currentTrace;
      const trace = startTrace(state, {
        ...span,
        ...(previousTrace === null ? {} : { childOf: previousTrace.id }),
        tags: span.tags === undefined ? {} : { ...span.tags },
      });
      state.currentTrace = trace;
      return { trace, previousTrace };
    },
    spanFinished(token: unknown, span?: RuntimeProbeSpan): void {
      const state = currentState();
      if (token === undefined) {
        if (state.currentTrace && span?.tags) {
          state.currentTrace.tags = { ...state.currentTrace.tags, ...span.tags };
        }
        return;
      }
      const spanToken = token as TraceSpanToken;
      if (span?.tags) {
        spanToken.trace.tags = { ...spanToken.trace.tags, ...span.tags };
      }
      finishTrace(state, spanToken.trace);
      state.currentTrace = spanToken.previousTrace;
    },
  });

  const state: TraceState = {
    callbacks: new Map(),
    probe,
    nextId: 1,
    traces: [],
    currentTrace: null,
    manualTraceEnabled: false,
    traceLeaseCount: 0,
    traceEnabled: false,
    flushTimer: null,
    detachProbe: undefined,
  };
  TRACE_STATES.set(runtime, state);
  return state;
}

function peekTraceState(runtime: RuntimeCore): TraceState | undefined {
  return TRACE_STATES.get(runtime);
}

function updateTraceEnabled(runtime: RuntimeCore, state: TraceState): void {
  const wasEnabled = state.traceEnabled;
  state.traceEnabled = state.manualTraceEnabled || state.traceLeaseCount > 0;
  if (state.traceEnabled && !wasEnabled) {
    state.detachProbe = attachRuntimeProbe(runtime, state.probe);
  } else if (!state.traceEnabled && wasEnabled) {
    state.detachProbe?.();
    state.detachProbe = undefined;
    discardPendingTraces(state);
  }
}

function discardPendingTraces(state: TraceState): void {
  state.traces = [];
  state.currentTrace = null;
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
}

function startTrace(state: TraceState, options: TraceOptions): Trace {
  const parentId = options.childOf ?? state.currentTrace?.id;
  // Event traces provide their own identity. Child spans inherit it from the
  // active event trace so one event occurrence can be queried as a group.
  const eventMetadata =
    options.eventInstanceId === undefined ? state.currentTrace : options;
  return {
    id: state.nextId++,
    ...(options.operation === undefined ? {} : { operation: options.operation }),
    ...(options.opType === undefined ? {} : { opType: options.opType }),
    tags: options.tags ?? {},
    ...(parentId === undefined ? {} : { childOf: parentId }),
    ...(eventMetadata?.runtimeInstanceId === undefined
      ? {}
      : { runtimeInstanceId: eventMetadata.runtimeInstanceId }),
    ...(eventMetadata?.eventInstanceId === undefined
      ? {}
      : { eventInstanceId: eventMetadata.eventInstanceId }),
    ...(eventMetadata?.parentEventInstanceId === undefined
      ? {}
      : { parentEventInstanceId: eventMetadata.parentEventInstanceId }),
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

/**
 * Emit a detached effect's failure as its own trace, parented to the event that
 * dispatched it. Going through `finishTrace` puts the failure in the next batch,
 * so callbacks learn about it rather than only seeing it in a record they were
 * handed earlier. Its span covers the detached work, not the moment of failure.
 */
function traceDetachedEffectFailure(
  state: TraceState,
  eventTrace: Trace,
  event: EventVector,
  effect: RuntimeProbeEffect,
): void {
  const trace = startTrace(state, {
    operation: effect.type,
    opType: 'effect',
    tags: { event, effectErrors: [toEffectTraceError(effect)] },
    childOf: eventTrace.id,
    ...(eventTrace.runtimeInstanceId === undefined
      ? {}
      : { runtimeInstanceId: eventTrace.runtimeInstanceId }),
    ...(eventTrace.eventInstanceId === undefined
      ? {}
      : { eventInstanceId: eventTrace.eventInstanceId }),
    ...(eventTrace.parentEventInstanceId === undefined
      ? {}
      : { parentEventInstanceId: eventTrace.parentEventInstanceId }),
  });
  if (effect.startedAtMs > 0) trace.start = effect.startedAtMs;
  finishTrace(state, trace);
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

function toTraceError(
  event: EventVector,
  result: RuntimeProbeTransition,
): TraceErrorTag | undefined {
  if (result.status === 'completed' || result.error === undefined) return undefined;
  const error = normalizeError(result.error);
  return {
    phase: result.status === 'missing-handler' ? 'missing-handler' : 'handler',
    message: error.message,
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    eventV: event,
  };
}

function toEffectTraceError(effect: RuntimeProbeEffect): TraceErrorTag {
  const error = normalizeError(effect.error);
  return {
    phase: 'effect',
    effect: effect.type,
    message: error.message,
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
  };
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;
  try {
    return new Error(String(value));
  } catch {
    return new Error('[Unprintable error]');
  }
}
