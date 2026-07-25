import { isEventVector } from '../core/validation';
import { isRuntimeDisposed } from './core';

import type { RuntimeCore } from './core';

/** Validate state entering the runtime through an untyped public boundary. */
export function assertStateRecord(
  value: unknown,
  field: 'initialState' | 'restoreState nextState',
): asserts value is Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`[reflex] ${field} must be a non-null, non-array object.`);
  }
}

/** Reject operations against a terminal runtime. */
export function assertRuntimeUsable(runtime: RuntimeCore): void {
  if (isRuntimeDisposed(runtime)) {
    throw new Error(`[reflex] Runtime '${runtime.identity.runtimeId}' has been disposed.`);
  }
}

/** Validate an event accepted by the strict instance API. */
export function assertDispatchableEvent(
  runtime: RuntimeCore,
  event: unknown,
  api: 'dispatch' | 'dispatchSync',
): void {
  if (!isEventVector(event)) {
    throw new Error(
      `[reflex] ${api} expects a non-empty event vector starting with an event id string.`,
    );
  }
  if (!runtime.registry.event.has(event[0])) {
    throw new Error(
      `[reflex] No event handler registered for '${event[0]}' in runtime '${runtime.identity.runtimeId}'. Register it with regEvent() before dispatching.`,
    );
  }
}

/** Validate a subscription query accepted by the strict instance API. */
export function assertRegisteredSubscription(runtime: RuntimeCore, query: unknown): void {
  if (!Array.isArray(query) || query.length === 0 || typeof query[0] !== 'string') {
    throw new Error(
      '[reflex] Subscription queries must be non-empty vectors starting with a subscription id string.',
    );
  }
  if (!runtime.registry.sub.has(query[0])) {
    throw new Error(
      `[reflex] No subscription registered for '${query[0]}' in runtime '${runtime.identity.runtimeId}'. Register it with regSub() before use.`,
    );
  }
}
