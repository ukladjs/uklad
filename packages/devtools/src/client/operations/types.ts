import type { UkladInspector } from '../types.js';
import type { OperationEventVector } from './runtime.js';

/**
 * Immutable, DevTools-owned record of a dispatched operation.
 *
 * This mirrors Uklad's canonical coordinator snapshot. It deliberately
 * contains no trace, retry, or delivery timing data. Evidence such as effects
 * is collected through optional DevTools lifecycle observation.
 *
 * A snapshot is a copy taken when it was read. Detached effects settle after
 * their operation does, so a `completed` operation whose promise-returning
 * effect later rejects becomes `completed-with-errors` on the next read.
 */
export interface OperationSnapshot {
  readonly operationId: string;
  readonly rootEventInstanceId: string;
  readonly acceptedSequence: number;
  readonly acceptedRevision?: number;
  readonly startedRevision?: number;
  readonly publishedRevision?: number;
  readonly status:
    | 'queued'
    | 'running'
    | 'publishing'
    | 'completed'
    | 'completed-with-errors'
    | 'rejected'
    | 'failed';
  readonly eventInstanceIds: readonly string[];
  readonly events: readonly OperationEventSnapshot[];
  readonly pendingEventInstanceIds: readonly string[];
  readonly pendingPublishedRevision?: number;
  readonly committedRevisions: readonly number[];
  readonly errors: readonly unknown[];
}

export interface OperationEventSnapshot {
  readonly eventInstanceId: string;
  readonly parentEventInstanceId?: string;
  readonly sourceEffectId?: string;
  readonly sourceEffectIndex?: number;
  readonly acceptedSequence: number;
  readonly acceptedRevision?: number;
  readonly startedRevision?: number;
  readonly committedRevision?: number;
  readonly status: 'queued' | 'running' | 'completed' | 'rejected' | 'failed' | 'dropped';
  readonly effects: readonly OperationEffectSnapshot[];
}

export interface OperationEffectSnapshot {
  readonly id: string;
  readonly index: number;
  readonly value: unknown;
  readonly status: 'succeeded' | 'returned' | 'failed' | 'unhandled' | 'invalid' | 'detached';
  readonly durationMs: number;
  readonly error?: unknown;
}

export interface OperationWaitResult {
  readonly operation: OperationSnapshot;
}

export interface OperationHandle {
  readonly operationId: string;
  readonly runtimeInstanceId: string;
  readonly result: Promise<OperationWaitResult>;
}

export interface OperationClient {
  start(event: OperationEventVector): OperationHandle;
  dispatchAndWait(event: OperationEventVector): Promise<OperationWaitResult>;
  get(operationId: string): OperationSnapshot | undefined;
}

/** Optional DevTools capability backed directly by Uklad's coordinator. */
export interface UkladOperationInspector extends UkladInspector {
  readonly operationApiVersion: 1;
  readonly runtimeInstanceId: string;
  startEvent(event: OperationEventVector): OperationHandle;
  executeEvent(event: OperationEventVector): Promise<OperationWaitResult>;
  getOperation(operationId: string): OperationSnapshot | undefined;
}
