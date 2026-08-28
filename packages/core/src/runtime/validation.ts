import { isEventVector } from '../core/validation';
import { RUNTIME_OWNED_COEFFECT_IDS } from '../contracts';
import { isRuntimeDisposed } from './core';

import type { RuntimeCore } from './core';

/** Validate state entering the runtime through an untyped public boundary. */
export function assertStateRecord(
  value: unknown,
  field: 'initialState' | 'restoreState nextState',
): asserts value is Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`[uklad] ${field} must be a non-null, non-array object.`);
  }
}

/**
 * Validate a coeffect id accepted by `regCoeffect`.
 *
 * Runtime-owned keys are reserved even though coeffect handlers no longer see
 * the state draft. They remain part of the event-handler coeffects object.
 */
export function assertCoeffectId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('[uklad] regCoeffect expects a non-empty coeffect id string.');
  }
  if (RUNTIME_OWNED_COEFFECT_IDS.includes(id as (typeof RUNTIME_OWNED_COEFFECT_IDS)[number])) {
    throw new Error(
      `[uklad] '${id}' is a runtime-owned coeffect and cannot be registered with regCoeffect().`,
    );
  }
  if (id === '__proto__') {
    throw new Error("[uklad] '__proto__' is not a valid coeffect id.");
  }
}

/** Reject operations against a terminal runtime. */
export function assertRuntimeUsable(runtime: RuntimeCore): void {
  if (isRuntimeDisposed(runtime)) {
    throw new Error(`[uklad] Runtime '${runtime.identity.runtimeId}' has been disposed.`);
  }
}

/** Public entry points that accept an event vector under strict validation. */
type DispatchApi = 'dispatch' | 'dispatchSync' | 'debounceAndDispatch' | 'throttleAndDispatch';

/** Validate an event accepted by the strict instance API. */
export function assertDispatchableEvent(
  runtime: RuntimeCore,
  event: unknown,
  api: DispatchApi,
): void {
  if (!isEventVector(event)) {
    throw new Error(
      `[uklad] ${api} expects a non-empty event vector starting with an event id string.`,
    );
  }
  if (!runtime.registry.event.has(event[0])) {
    throw new Error(
      `[uklad] No event handler registered for '${event[0]}' in runtime '${runtime.identity.runtimeId}'. Register it with regEvent() before dispatching.`,
    );
  }
}

/**
 * Validate a rate-limit window accepted by the strict instance API.
 *
 * `setTimeout` silently coerces `NaN`, `Infinity`, and negative delays to a
 * near-immediate firing, which turns a bad duration into a debounce or throttle
 * that quietly does nothing. Reject those at the call site instead.
 */
export function assertRateLimitDuration(
  durationMs: unknown,
  api: 'debounceAndDispatch' | 'throttleAndDispatch',
): asserts durationMs is number {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(
      `[uklad] ${api} expects a finite, non-negative duration in milliseconds, received ${String(durationMs)}.`,
    );
  }
}

/** Validate a subscription query accepted by the strict instance API. */
export function assertRegisteredSubscription(runtime: RuntimeCore, query: unknown): void {
  if (!Array.isArray(query) || query.length === 0 || typeof query[0] !== 'string') {
    throw new Error(
      '[uklad] Subscription queries must be non-empty vectors starting with a subscription id string.',
    );
  }
  if (!runtime.registry.sub.has(query[0]) && !runtime.subscriptions.hasDefinition(query[0])) {
    throw new Error(
      `[uklad] No subscription registered for '${query[0]}' in runtime '${runtime.identity.runtimeId}'. Register it with regRootSub(), regSub(), or regExternalSub() before use.`,
    );
  }
}
