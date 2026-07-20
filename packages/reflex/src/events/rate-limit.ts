import { defaultRuntimeScope, type RuntimeScope } from '../runtime/scope';
import { cloneStructuredValue } from '../runtime/ownership';
import { dispatch, dispatchOwnedForRuntime } from './router';

import type { DispatchVector, Id } from '../types';

interface RateLimitState {
  readonly debounceTimers: Map<Id, ReturnType<typeof setTimeout>>;
  readonly throttledEventIds: Set<Id>;
  readonly throttleTimers: Set<ReturnType<typeof setTimeout>>;
}

const rateLimitStates = new WeakMap<RuntimeScope, RateLimitState>();

function getRateLimitState(runtime: RuntimeScope): RateLimitState {
  let state = rateLimitStates.get(runtime);
  if (!state) {
    state = {
      debounceTimers: new Map(),
      throttledEventIds: new Set(),
      throttleTimers: new Set(),
    };
    rateLimitStates.set(runtime, state);
  }
  return state;
}

/** @internal Clear the pending compatibility debounce for an event id. */
export function clear(eventId: Id): void {
  clearForRuntime(defaultRuntimeScope, eventId);
}

/** @internal Clear a pending debounce in one runtime. */
export function clearForRuntime(runtime: RuntimeScope, eventId: Id): void {
  const state = getRateLimitState(runtime);
  const timeout = state.debounceTimers.get(eventId);
  if (timeout === undefined) return;
  clearTimeout(timeout);
  state.debounceTimers.delete(eventId);
}

/** @internal Clear every pending compatibility debounce. */
export function clearAll(): void {
  clearAllForRuntime(defaultRuntimeScope);
}

/** @internal Clear every rate-limit timer in one runtime. */
export function clearAllForRuntime(runtime: RuntimeScope): void {
  const state = getRateLimitState(runtime);
  for (const timeout of state.debounceTimers.values()) clearTimeout(timeout);
  for (const timeout of state.throttleTimers) clearTimeout(timeout);
  state.debounceTimers.clear();
  state.throttleTimers.clear();
  state.throttledEventIds.clear();
}

/** Dispatch an event after calls for its id have stopped for `durationMs`. */
export function debounceAndDispatch(event: DispatchVector, durationMs: number): void {
  debounceWithDispatcher(defaultRuntimeScope, event, durationMs, dispatch);
}

/** @internal Debounce an event in one runtime. */
export function debounceAndDispatchForRuntime(
  runtime: RuntimeScope,
  event: DispatchVector,
  durationMs: number,
): void {
  debounceWithDispatcher(runtime, event, durationMs, (nextEvent) =>
    dispatchOwnedForRuntime(runtime, nextEvent),
  );
}

function debounceWithDispatcher(
  runtime: RuntimeScope,
  event: DispatchVector,
  durationMs: number,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  const state = getRateLimitState(runtime);
  const acceptedEvent = cloneRateLimitedEvent(event);
  const eventId = acceptedEvent[0];
  clearForRuntime(runtime, eventId);

  const timeout = setTimeout(() => {
    state.debounceTimers.delete(eventId);
    dispatchEvent(acceptedEvent);
  }, durationMs);

  state.debounceTimers.set(eventId, timeout);
}

/** Dispatch immediately, then ignore the same event id for `durationMs`. */
export function throttleAndDispatch(event: DispatchVector, durationMs: number): void {
  throttleWithDispatcher(defaultRuntimeScope, event, durationMs, dispatch);
}

/** @internal Throttle an event in one runtime. */
export function throttleAndDispatchForRuntime(
  runtime: RuntimeScope,
  event: DispatchVector,
  durationMs: number,
): void {
  throttleWithDispatcher(runtime, event, durationMs, (nextEvent) =>
    dispatchOwnedForRuntime(runtime, nextEvent),
  );
}

function throttleWithDispatcher(
  runtime: RuntimeScope,
  event: DispatchVector,
  durationMs: number,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  const state = getRateLimitState(runtime);
  const acceptedEvent = cloneRateLimitedEvent(event);
  const eventId = acceptedEvent[0];
  if (state.throttledEventIds.has(eventId)) return;

  state.throttledEventIds.add(eventId);
  const timeout = setTimeout(() => {
    state.throttledEventIds.delete(eventId);
    state.throttleTimers.delete(timeout);
  }, durationMs);
  state.throttleTimers.add(timeout);

  dispatchEvent(acceptedEvent);
}

function cloneRateLimitedEvent(event: DispatchVector): DispatchVector {
  try {
    return cloneStructuredValue(event);
  } catch (error: unknown) {
    throw new Error('[reflex] Rate-limited dispatch payloads must be structured-cloneable.', {
      cause: error,
    });
  }
}
