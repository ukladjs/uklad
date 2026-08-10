import type { UkladInspector } from '../types.js';
import type { OperationEventVector } from './runtime.js';

/**
 * Immutable, DevTools-owned record of a dispatched operation.
 *
 * This is an experimental DevTools snapshot, assembled from passive runtime
 * execution facts. It deliberately contains no trace, retry, or delivery
 * timing data. Evidence such as effects is collected through optional
 * DevTools lifecycle observation. Each event's eventInstanceId is neutral
 * runtime metadata also carried by related trace rows; traces never control
 * operation settlement.
 *
 * A snapshot is a copy taken when it was read. Detached effects settle after
 * their operation does, so a `completed` operation whose promise-returning
 * effect later rejects becomes `completed-with-errors` on the next read.
 */
export interface OperationSnapshot {
  /** Experimental DevTools operation-snapshot schema. */
  readonly schemaVersion: 0;
  /** Exact in-memory runtime lifetime that produced this snapshot. */
  readonly runtimeInstanceId: string;
  /** The settled boundary represented by this snapshot. */
  readonly completion: 'cascade-published';
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
  /** Evidence configured for this coordinator and retained in this snapshot. */
  readonly evidence: OperationEvidenceSnapshot;
  /** Compact evidence counts for agents that do not need to scan every item. */
  readonly summary: OperationSummary;
  /** At least one effect escaped the settled synchronous cascade. */
  readonly hasDetachedEffects: boolean;
}

export type OperationStateChangeEvidence = 'none' | 'patches';

export interface OperationEvidenceOptions {
  readonly stateChanges: OperationStateChangeEvidence;
}

export interface OperationEvidenceSnapshot extends OperationEvidenceOptions {
  /** Number of state patches retained across all operation events. */
  readonly retainedStatePatchCount: number;
  /** At least one event exceeded the fixed per-event state-patch limit. */
  readonly statePatchesTruncated: boolean;
}

export interface OperationSummary {
  readonly eventCount: number;
  readonly state: {
    readonly committed: number;
    readonly unchanged: number;
    readonly skipped: number;
  };
  readonly effects: {
    readonly total: number;
    readonly succeeded: number;
    readonly returned: number;
    readonly failed: number;
    readonly unhandled: number;
    readonly invalid: number;
    readonly detached: number;
  };
  readonly errorCount: number;
}

export interface OperationEventSnapshot {
  readonly eventInstanceId: string;
  /** Stable handler/event id for this concrete event occurrence. */
  readonly eventId: string;
  readonly parentEventInstanceId?: string;
  readonly sourceEffectId?: string;
  readonly sourceEffectIndex?: number;
  readonly acceptedSequence: number;
  readonly acceptedRevision?: number;
  readonly startedRevision?: number;
  readonly committedRevision?: number;
  /** Commit disposition reported by the runtime, when the event reached it. */
  readonly stateStatus?: 'committed' | 'unchanged' | 'skipped';
  /** Forward patches, present only when state-change evidence was configured. */
  readonly statePatches?: readonly OperationStatePatchSnapshot[];
  /** This event had more state patches than DevTools retained. */
  readonly statePatchesTruncated?: boolean;
  readonly status: 'queued' | 'running' | 'completed' | 'rejected' | 'failed' | 'dropped';
  readonly effects: readonly OperationEffectSnapshot[];
}

export interface OperationStatePatchSnapshot {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
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

/** Optional DevTools operation-snapshot capability exposed by an inspector. */
export interface UkladOperationInspector extends UkladInspector {
  readonly operationApiVersion: 1;
  readonly runtimeInstanceId: string;
  /** Evidence collection configured by the application for operation snapshots. */
  readonly operationEvidence: OperationEvidenceOptions;
  startEvent(event: OperationEventVector): OperationHandle;
  executeEvent(event: OperationEventVector): Promise<OperationWaitResult>;
  getOperation(operationId: string): OperationSnapshot | undefined;
}
