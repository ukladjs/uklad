import type { DispatchVector, Id } from './types';
import { dispatch } from './router';

// Storage for timeout IDs keyed by event keys
const debounceTimers = new Map<Id, ReturnType<typeof setTimeout>>();

/**
 * Clears a specific timeout by event key
 */
export function clear(eventKey: Id): void {
  const eventTimeout = debounceTimers.get(eventKey);
  if (eventTimeout !== undefined) {
    clearTimeout(eventTimeout);
    debounceTimers.delete(eventKey);
  }
}

/**
 * Clears all active timeouts
 */
export function clearAll(): void {
  for (const timeoutId of debounceTimers.values()) {
    clearTimeout(timeoutId);
  }
  debounceTimers.clear();
}

/**
 * Dispatches `event` iff it was not dispatched for the duration of `durationMs`.
 * Cancels any existing timeout for the same event and sets a new one.
 */
export function debounceAndDispatch(event: DispatchVector, durationMs: number): void {
  const eventKey = event[0];
  clear(eventKey);

  const timeoutId = setTimeout(() => {
    debounceTimers.delete(eventKey);
    dispatch(event);
  }, durationMs);

  debounceTimers.set(eventKey, timeoutId);
}

// Storage for throttle state keyed by event keys
const throttledEventIds = new Set<Id>();

/**
 * Dispatches event and ignores subsequent calls for the duration of `durationMs`.
 * Unlike debouncing, this dispatches immediately on the first call.
 */
export function throttleAndDispatch(event: DispatchVector, durationMs: number): void {
  const eventKey = event[0];

  if (throttledEventIds.has(eventKey)) return;

  throttledEventIds.add(eventKey);
  setTimeout(() => {
    throttledEventIds.delete(eventKey);
  }, durationMs);

  dispatch(event);
}
