import type { ReflexInspector } from '../types.js';
import type { OperationEventVector, OperationSubVector, RuntimeLifecycleErrorKind } from './runtime.js';

export type OperationCompletionBoundary = 'cascade-published';
export type OperationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'rejected';
export type OperationOutcome =
  | 'pending'
  | 'succeeded'
  | 'effects-failed'
  | 'incomplete'
  | 'failed'
  | 'rejected';
export type OperationWaitStatus = 'settled' | 'timed-out';
export type OperationEffectMode =
  | 'runtime-defined'
  | 'real'
  | 'stubbed'
  | 'fixture-backed'
  | 'suppressed';
export type OperationEffectStatus =
  | 'succeeded'
  | 'returned'
  | 'failed'
  | 'unhandled'
  | 'invalid'
  | 'detached';
export type OperationEventStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dropped';
export type OperationEventStateStatus = 'not-attempted' | 'unchanged' | 'committed';

export interface OperationExecutionContextInput {
  readonly profile: string;
  readonly defaultEffectMode?: OperationEffectMode;
  readonly effectModes?: Readonly<Record<string, OperationEffectMode>>;
  readonly fixtureSetId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OperationExecutionContext extends OperationExecutionContextInput {
  readonly source: 'runtime-default' | 'caller-declared';
  readonly enforced: false;
}

export interface OperationOptions {
  readonly completion?: OperationCompletionBoundary;
  readonly timeoutMs?: number;
  readonly idempotencyKey?: string;
  readonly expectedRevision?: number;
  readonly observe?: readonly OperationSubVector[];
  readonly executionContext?: OperationExecutionContextInput;
}

/** Compatibility name used by the original in-runtime API. */
export type DispatchAndWaitOptions = OperationOptions;

export type OperationLookup =
  | { readonly operationId: string; readonly idempotencyKey?: never }
  | { readonly idempotencyKey: string; readonly operationId?: never };

export interface OperationPatch {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
}

export interface OperationError {
  readonly kind:
    | RuntimeLifecycleErrorKind
    | 'observation'
    | 'idempotency-conflict'
    | 'revision-conflict'
    | 'capacity';
  readonly message: string;
  readonly eventInstanceId?: string;
  readonly effectId?: string;
  readonly stack?: string;
}

export interface OperationEventStateResult {
  readonly status: OperationEventStateStatus;
  readonly fromRevision: number;
  readonly committedRevision: number | null;
  readonly plannedPatches: readonly OperationPatch[];
  readonly committedPatches: readonly OperationPatch[];
  readonly truncated: boolean;
}

export interface OperationEventResult {
  readonly eventInstanceId: string;
  readonly parentEventInstanceId: string | null;
  readonly event: OperationEventVector;
  readonly status: OperationEventStatus;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly state: OperationEventStateResult;
  readonly effectIds: readonly string[];
  readonly errors: readonly OperationError[];
}

export interface OperationEffectResult {
  readonly effectId: string;
  readonly eventInstanceId: string;
  readonly type: string;
  readonly value: unknown;
  readonly mode: OperationEffectMode;
  readonly status: OperationEffectStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly error?: OperationError;
}

export interface OperationObservationResult {
  readonly query: OperationSubVector;
  readonly status: 'succeeded' | 'failed';
  readonly value?: unknown;
  readonly error?: OperationError;
}

/** One cached subscription recomputed while this operation's final publication settled. */
export interface OperationRecalculatedSubscription {
  readonly key: string;
  readonly query: OperationSubVector;
  readonly kind: 'root' | 'computed';
  readonly active: boolean;
  readonly version: number;
  readonly status: 'value' | 'error';
  readonly value?: unknown;
  readonly error?: string;
}

/** User-visible subscription evidence captured after the dispatch cascade publishes. */
export interface OperationSubscriptionsSummary {
  readonly status: 'settled';
  readonly publishedRevision: number;
  /** Includes subscriptions that recomputed to an equal value and emitted no listener update. */
  readonly recalculated: readonly OperationRecalculatedSubscription[];
}

export interface OperationStateSummary {
  readonly status: 'unchanged' | 'committed' | 'partially-committed' | 'failed';
  readonly patches: readonly OperationPatch[];
  readonly truncated: boolean;
}

export interface OperationEffectsSummary {
  readonly status: 'none' | 'succeeded' | 'failed' | 'incomplete';
  readonly items: readonly OperationEffectResult[];
  readonly truncated: boolean;
}

export interface OperationRevisionSummary {
  readonly accepted: number;
  readonly expected: number | null;
  readonly rootStart: number | null;
  readonly lastCommitted: number | null;
  readonly published: number;
  readonly observed: number;
  readonly concurrentChangesObserved: boolean;
}

export interface OperationCompletionResult {
  readonly boundary: OperationCompletionBoundary;
  readonly satisfied: boolean;
  readonly pendingEvents: number;
}

export interface OperationDeliveryResult {
  readonly status: OperationWaitStatus;
  readonly timeoutMs: number | null;
}

export interface OperationRetention {
  readonly scope: 'runtime-instance';
  readonly durability: 'memory';
  readonly maxOperations: number;
  readonly currentlyRetained: boolean;
  readonly terminalEvictionPolicy: 'oldest-terminal';
}

export interface OperationReceipt {
  /** Experimental receipt shape; the RFC's stable v1 schema is not frozen yet. */
  readonly schemaVersion: 0;
  readonly operationId: string;
  readonly runtimeId: string;
  readonly runtimeInstanceId: string;
  readonly status: OperationStatus;
  readonly outcome: OperationOutcome;
  readonly idempotencyKey: string | null;
  readonly acceptedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly rootEventInstanceId: string;
  readonly completion: OperationCompletionResult;
  readonly executionContext: OperationExecutionContext;
  readonly revisions: OperationRevisionSummary;
  readonly events: readonly OperationEventResult[];
  readonly state: OperationStateSummary;
  readonly subscriptions: OperationSubscriptionsSummary;
  readonly effects: OperationEffectsSummary;
  readonly observations: readonly OperationObservationResult[];
  readonly errors: readonly OperationError[];
  readonly truncated: boolean;
  readonly retention: OperationRetention;
}

export interface OperationWaitResult {
  readonly operation: OperationReceipt;
  readonly delivery: OperationDeliveryResult;
  readonly replayed: boolean;
}

export interface OperationHandle {
  readonly operationId: string;
  readonly runtimeInstanceId: string;
  readonly result: Promise<OperationWaitResult>;
}

export interface OperationClient {
  start(event: OperationEventVector, options?: OperationOptions): OperationHandle;
  dispatchAndWait(event: OperationEventVector, options?: OperationOptions): Promise<OperationWaitResult>;
  get(lookup: string | OperationLookup): OperationReceipt | undefined;
}

/** The optional inspector capability supplied by the DevTools operation ledger. */
export interface ReflexOperationInspector extends ReflexInspector {
  readonly operationApiVersion: 1;
  readonly runtimeInstanceId: string;
  startEvent(event: OperationEventVector, options?: OperationOptions): OperationHandle;
  executeEvent(event: OperationEventVector, options?: OperationOptions): Promise<OperationWaitResult>;
  getOperation(lookup: string | OperationLookup): OperationReceipt | undefined;
}
