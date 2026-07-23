import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  type RuntimeKernel,
} from '../runtime/kernel';
import { applyExecutionOutcomeForKernel } from './operation-coordinator';

import type { EventVector } from '../types';

/**
 * Runtime-owned identity for one accepted event occurrence.
 *
 * The current public API still accepts event vectors, but every accepted vector
 * enters the executor through this envelope. The identity is intentionally
 * independent from tracing and from array object identity.
 */
export interface ExecutionEnvelope {
  readonly runtimeInstanceId: string;
  readonly operationId: string;
  readonly eventInstanceId: string;
  readonly parentEventInstanceId?: string;
  readonly sourceEffectId?: string;
  /** Index of the precise parent effect occurrence, when this is an effect child. */
  readonly sourceEffectIndex?: number;
  readonly acceptedSequence: number;
  readonly acceptedAtMs: number;
  readonly event: EventVector;
}

export interface TransitionOutcome {
  readonly type: 'transition';
  readonly envelope: ExecutionEnvelope;
  readonly status: 'completed' | 'missing-handler' | 'aborted' | 'failed';
  readonly previousState: unknown;
  readonly candidateState?: unknown;
  readonly effects: readonly unknown[];
  /** Legacy handler or interceptor effect values that could not be normalized as a vector. */
  readonly invalidEffects: readonly unknown[];
  readonly error?: unknown;
}

export interface CommitOutcome {
  readonly type: 'commit';
  readonly envelope: ExecutionEnvelope;
  readonly status: 'committed' | 'unchanged' | 'skipped';
  readonly committedRevision: number;
}

export interface EffectOutcome {
  readonly type: 'effect';
  readonly envelope: ExecutionEnvelope;
  readonly effectIndex: number;
  /** Stable within the parent event; unlike `effectId`, this identifies one occurrence. */
  readonly effectInstanceId: string;
  readonly effectId: string;
  readonly value: unknown;
  readonly status: 'succeeded' | 'returned' | 'failed' | 'unhandled' | 'invalid' | 'detached';
  readonly startedAtMs: number;
  readonly error?: unknown;
}

export interface QueuedOutcome {
  readonly type: 'queued';
  readonly envelope: ExecutionEnvelope;
  readonly committedRevision: number;
}

export interface StartedOutcome {
  readonly type: 'started';
  readonly envelope: ExecutionEnvelope;
  readonly committedRevision: number;
}

export type ExecutionOutcome =
  | QueuedOutcome
  | StartedOutcome
  | TransitionOutcome
  | CommitOutcome
  | EffectOutcome
  | {
      readonly type: 'finished';
      readonly envelope: ExecutionEnvelope;
      readonly status: 'completed' | 'rejected' | 'failed';
      readonly error?: unknown;
    }
  | {
      readonly type: 'dropped';
      readonly envelopes: readonly ExecutionEnvelope[];
      readonly reason: 'queue-dropped' | 'disposed';
      readonly error: unknown;
    }
  | {
      readonly type: 'published';
      readonly runtimeInstanceId: string;
      readonly publishedRevision: number;
    }
  | {
      readonly type: 'runtime-disposed';
      readonly runtimeInstanceId: string;
      readonly error: unknown;
    };

/** A passive consumer of immutable executor records. */
export interface ExecutionOutcomeObserver {
  onExecutionOutcome(outcome: ExecutionOutcome): void;
}

interface ExecutionIdentityState {
  nextSequence: number;
  nextOperationId: number;
  nextEventInstanceId: number;
}

const EXECUTION_IDENTITIES = createRuntimeStateKey<ExecutionIdentityState>(
  'reflex.execution-identities',
);
const EXECUTION_OBSERVERS = createRuntimeStateKey<Set<ExecutionOutcomeObserver>>(
  'reflex.execution-outcome-observers',
);

function getIdentityState(runtime: RuntimeKernel): ExecutionIdentityState {
  return getOrCreateRuntimeState(runtime, EXECUTION_IDENTITIES, () => ({
    nextSequence: 0,
    nextOperationId: 0,
    nextEventInstanceId: 0,
  }));
}

function getObservers(runtime: RuntimeKernel): Set<ExecutionOutcomeObserver> {
  return getOrCreateRuntimeState(runtime, EXECUTION_OBSERVERS, () => new Set());
}

/** @internal Create a runtime-owned execution envelope for one event occurrence. */
export function createExecutionEnvelopeForKernel(
  runtime: RuntimeKernel,
  event: EventVector,
  parent?: Pick<
    ExecutionEnvelope,
    'operationId' | 'eventInstanceId' | 'sourceEffectId' | 'sourceEffectIndex'
  >,
): ExecutionEnvelope {
  const state = getIdentityState(runtime);
  const eventInstanceId = `evt_${runtime.runtimeInstanceId}_${++state.nextEventInstanceId}`;
  const operationId =
    parent?.operationId ?? `op_${runtime.runtimeInstanceId}_${++state.nextOperationId}`;

  return Object.freeze({
    runtimeInstanceId: runtime.runtimeInstanceId,
    operationId,
    eventInstanceId,
    ...(parent?.eventInstanceId === undefined
      ? {}
      : { parentEventInstanceId: parent.eventInstanceId }),
    ...(parent?.sourceEffectId === undefined ? {} : { sourceEffectId: parent.sourceEffectId }),
    ...(parent?.sourceEffectIndex === undefined
      ? {}
      : { sourceEffectIndex: parent.sourceEffectIndex }),
    acceptedSequence: ++state.nextSequence,
    acceptedAtMs: Date.now(),
    event,
  });
}

/** @internal Observe executor records without gaining control over execution. */
export function observeExecutionOutcomesForKernel(
  runtime: RuntimeKernel,
  observer: ExecutionOutcomeObserver,
): () => void {
  const observers = getObservers(runtime);
  observers.add(observer);
  return () => observers.delete(observer);
}

/** @internal Project one immutable execution record to passive integrations. */
export function recordExecutionOutcomeForKernel(
  runtime: RuntimeKernel,
  outcome: ExecutionOutcome,
): void {
  const executionOutcome = Object.freeze(outcome);
  applyExecutionOutcomeForKernel(runtime, executionOutcome);
  const observerOutcome = snapshotExecutionOutcome(executionOutcome);
  for (const observer of getObservers(runtime)) {
    try {
      observer.onExecutionOutcome(observerOutcome);
    } catch {
      // Outcome observers are diagnostic integrations. They never affect event work.
    }
  }
}

/**
 * Copy execution data before it crosses into a passive integration. We cannot
 * expose the owned event, state candidate, or effect value directly: an
 * observer runs synchronously and could otherwise alter later execution.
 */
function snapshotExecutionOutcome(outcome: ExecutionOutcome): ExecutionOutcome {
  return immutableSnapshot(outcome) as ExecutionOutcome;
}

function immutableSnapshot(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function')
    return `[Function ${(value as { name?: string }).name || 'anonymous'}]`;

  if (seen.has(value as object)) return seen.get(value as object);
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(immutableSnapshot(item, seen));
    return Object.freeze(copy);
  }
  if (value instanceof Error) {
    return Object.freeze({
      $type: value.name,
      message: value.message,
      ...(typeof value.stack === 'string' ? { stack: value.stack } : {}),
    });
  }
  if (value instanceof Date) return Object.freeze({ $type: 'Date', value: value.toISOString() });

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return Object.freeze({ $type: prototype?.constructor?.name ?? 'Object' });

  const copy: Record<string, unknown> = {};
  seen.set(value as object, copy);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = immutableSnapshot(child, seen);
  }
  return Object.freeze(copy);
}
