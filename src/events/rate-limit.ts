import { dispatch } from './router';

import type { DispatchVector, Id } from '../types';

const debounceTimers = new Map<Id, ReturnType<typeof setTimeout>>();
const throttledEventIds = new Set<Id>();

/** @internal Clear the pending debounce for an event id. */
export function clear(eventId: Id): void {
  const timeout = debounceTimers.get(eventId);
  if (timeout === undefined) return;

  clearTimeout(timeout);
  debounceTimers.delete(eventId);
}

/** @internal Clear every pending debounce. */
export function clearAll(): void {
  for (const timeout of debounceTimers.values()) {
    clearTimeout(timeout);
  }
  debounceTimers.clear();
}

/** Dispatch an event after calls for its id have stopped for `durationMs`. */
export function debounceAndDispatch(event: DispatchVector, durationMs: number): void {
  const eventId = event[0];
  clear(eventId);

  const timeout = setTimeout(() => {
    debounceTimers.delete(eventId);
    dispatch(event);
  }, durationMs);

  debounceTimers.set(eventId, timeout);
}

/** Dispatch immediately, then ignore the same event id for `durationMs`. */
export function throttleAndDispatch(event: DispatchVector, durationMs: number): void {
  const eventId = event[0];
  if (throttledEventIds.has(eventId)) return;

  throttledEventIds.add(eventId);
  setTimeout(() => {
    throttledEventIds.delete(eventId);
  }, durationMs);

  dispatch(event);
}
