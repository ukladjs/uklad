import { type RuntimeKernel } from '../runtime/kernel';
import { cloneStructuredValue } from '../runtime/ownership';
import { dispatchForKernel } from './router';

import type { DispatchVector, Id } from '../types';

export interface RateLimitState {
  readonly debounceTimers: Map<Id, ReturnType<typeof setTimeout>>;
  readonly throttledEventIds: Set<Id>;
  readonly throttleTimers: Set<ReturnType<typeof setTimeout>>;
}

function getRateLimitState(runtime: RuntimeKernel): RateLimitState {
  return (runtime.rateLimit ??= {
    debounceTimers: new Map(),
    throttledEventIds: new Set(),
    throttleTimers: new Set(),
  });
}

/** @internal Clear a pending debounce in one runtime. */
export function clearForKernel(runtime: RuntimeKernel, eventId: Id): void {
  const state = getRateLimitState(runtime);
  const timeout = state.debounceTimers.get(eventId);
  if (timeout === undefined) return;
  clearTimeout(timeout);
  state.debounceTimers.delete(eventId);
}

/** @internal Clear every rate-limit timer in one runtime. */
export function clearAllForKernel(runtime: RuntimeKernel): void {
  const state = getRateLimitState(runtime);
  for (const timeout of state.debounceTimers.values()) clearTimeout(timeout);
  for (const timeout of state.throttleTimers) clearTimeout(timeout);
  state.debounceTimers.clear();
  state.throttleTimers.clear();
  state.throttledEventIds.clear();
}

/** @internal Debounce an event in one runtime. */
export function debounceAndDispatchForKernel(
  runtime: RuntimeKernel,
  event: DispatchVector,
  durationMs: number,
): void {
  debounceWithDispatcher(runtime, event, durationMs, (nextEvent) =>
    dispatchForKernel(runtime, nextEvent),
  );
}

function debounceWithDispatcher(
  runtime: RuntimeKernel,
  event: DispatchVector,
  durationMs: number,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  const state = getRateLimitState(runtime);
  const acceptedEvent = cloneRateLimitedEvent(event);
  const eventId = acceptedEvent[0];
  clearForKernel(runtime, eventId);

  const timeout = setTimeout(() => {
    state.debounceTimers.delete(eventId);
    dispatchEvent(acceptedEvent);
  }, durationMs);

  state.debounceTimers.set(eventId, timeout);
}

/** @internal Throttle an event in one runtime. */
export function throttleAndDispatchForKernel(
  runtime: RuntimeKernel,
  event: DispatchVector,
  durationMs: number,
): void {
  throttleWithDispatcher(runtime, event, durationMs, (nextEvent) =>
    dispatchForKernel(runtime, nextEvent),
  );
}

function throttleWithDispatcher(
  runtime: RuntimeKernel,
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
