import { createRuntimeStateKey, getOrCreateRuntimeState, type RuntimeKernel } from './kernel';

import type { EventVector } from '../types';

export type RuntimeLifecycleErrorKind =
  | 'handler'
  | 'missing-handler'
  | 'coeffect'
  | 'missing-coeffect'
  | 'effect'
  | 'invalid-effect'
  | 'unhandled-effect'
  | 'queue-dropped'
  | 'disposed'
  | 'publication';

export type RuntimeLifecycleEffectStatus =
  'succeeded' | 'returned' | 'failed' | 'unhandled' | 'invalid' | 'detached';

export interface RuntimeLifecycleEffect {
  readonly type: string;
  readonly value: unknown;
  readonly status: RuntimeLifecycleEffectStatus;
  readonly startedAtMs: number;
  readonly error?: unknown;
}

export interface RuntimeLifecycleStatePlan {
  readonly previousDb: unknown;
  readonly plannedDb: unknown;
  readonly patches: readonly RuntimeLifecyclePatch[];
}

export interface RuntimeLifecyclePatch {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
}

/**
 * Optional observer for runtime work. Observers are owned by the runtime that
 * installs them and receive no access to the runtime kernel or mutable state.
 */
export interface RuntimeLifecycleObserver {
  onEventQueued?(event: EventVector): void;
  /** Return true to reject the event before its handler begins. */
  onEventStarted?(event: EventVector, committedRevision: number): boolean | void;
  onEventFinished?(event: EventVector, error?: unknown): void;
  onEventDropped?(
    events: readonly EventVector[],
    reason: 'queue-dropped' | 'disposed',
    error: unknown,
  ): void;
  /** Return true to abort the active event after a coeffect failure. */
  onEventError?(kind: RuntimeLifecycleErrorKind, error: unknown): boolean | void;
  onStatePlanned?(plan: RuntimeLifecycleStatePlan): void;
  onEffects?(effects: readonly unknown[]): void;
  onEffect?(effect: RuntimeLifecycleEffect): void;
  onStateCommitted?(previousDb: unknown, nextDb: unknown, committedRevision: number): void;
  onStatePublished?(db: unknown, publishedRevision: number): void;
  /** Optional correlation evidence merged into the current trace. */
  getTraceTags?(): Readonly<Record<string, unknown>>;
  onRuntimeDisposed?(): void;
}

const LIFECYCLE_OBSERVERS = createRuntimeStateKey<Set<RuntimeLifecycleObserver>>(
  'reflex.lifecycle-observers',
);

function getObservers(runtime: RuntimeKernel): Set<RuntimeLifecycleObserver> {
  return getOrCreateRuntimeState(runtime, LIFECYCLE_OBSERVERS, () => new Set());
}

/** @internal Register an observer without exposing the kernel to it. */
export function observeRuntimeLifecycleForKernel(
  runtime: RuntimeKernel,
  observer: RuntimeLifecycleObserver,
): () => void {
  const observers = getObservers(runtime);
  observers.add(observer);
  return () => observers.delete(observer);
}

/** @internal Return whether an optional lifecycle integration is installed. */
export function hasRuntimeLifecycleObservers(runtime: RuntimeKernel): boolean {
  return getObservers(runtime).size > 0;
}

/** @internal Notify optional runtime integrations. Observer failures are isolated. */
export function notifyRuntimeLifecycleForKernel<K extends keyof RuntimeLifecycleObserver>(
  runtime: RuntimeKernel,
  method: K,
  ...args: Parameters<NonNullable<RuntimeLifecycleObserver[K]>>
): void {
  for (const observer of getObservers(runtime)) {
    try {
      const callback = observer[method] as ((...values: unknown[]) => void) | undefined;
      callback?.(...args);
    } catch {
      // Observability must never change application event processing.
    }
  }
}

/** @internal Begin an observed event and return whether an observer rejected it. */
export function beginRuntimeLifecycleEventForKernel(
  runtime: RuntimeKernel,
  event: EventVector,
  committedRevision: number,
): boolean {
  let rejected = false;
  for (const observer of getObservers(runtime)) {
    try {
      rejected = observer.onEventStarted?.(event, committedRevision) === true || rejected;
    } catch {
      // Observability must never change application event processing.
    }
  }
  return rejected;
}

/** @internal Report a structured failure and return whether event execution should stop. */
export function reportRuntimeLifecycleErrorForKernel(
  runtime: RuntimeKernel,
  kind: RuntimeLifecycleErrorKind,
  error: unknown,
): boolean {
  let shouldAbort = false;
  for (const observer of getObservers(runtime)) {
    try {
      shouldAbort = observer.onEventError?.(kind, error) === true || shouldAbort;
    } catch {
      // Observability must never change application event processing.
    }
  }
  return shouldAbort;
}

/** @internal Merge optional observer-supplied correlation fields into a trace. */
export function getRuntimeLifecycleTraceTagsForKernel(
  runtime: RuntimeKernel,
): Readonly<Record<string, unknown>> {
  const tags: Record<string, unknown> = {};
  for (const observer of getObservers(runtime)) {
    try {
      Object.assign(tags, observer.getTraceTags?.());
    } catch {
      // Observability must never change application event processing.
    }
  }
  return tags;
}
