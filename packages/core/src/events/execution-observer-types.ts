import type { RuntimeProbeEffect } from '../runtime/probe-types';
import type { EventVector } from '../types';

/** Opaque development metadata created and owned by an optional integration. */
export interface DevelopmentOperationReference {
  readonly operationId: string;
  readonly value: unknown;
}

export interface DevelopmentExecutionParent {
  readonly operation: DevelopmentOperationReference;
  readonly sourceEffectId?: string;
  readonly sourceEffectIndex?: number;
}

/**
 * Structural compatibility contract consumed by DevTools. It is installed as
 * one passive RuntimeProbe; core retains no operation model.
 */
export interface DevelopmentExecutionObserver {
  accept(event: EventVector, parent?: DevelopmentExecutionParent): DevelopmentOperationReference;
  queued(operation: DevelopmentOperationReference, committedRevision: number): void;
  started(operation: DevelopmentOperationReference, committedRevision: number): void;
  transition(
    operation: DevelopmentOperationReference,
    status: 'completed' | 'missing-handler' | 'aborted' | 'failed',
    error?: unknown,
  ): void;
  committed(
    operation: DevelopmentOperationReference,
    status: 'committed' | 'unchanged' | 'skipped',
    committedRevision: number,
  ): void;
  effect?(operation: DevelopmentOperationReference, result: RuntimeProbeEffect): void;
  finished(
    operation: DevelopmentOperationReference,
    status: 'completed' | 'rejected' | 'failed',
    error?: unknown,
  ): void;
  dropped(operations: readonly DevelopmentOperationReference[], error: unknown): void;
  published(publishedRevision: number): void;
  disposed(error: unknown): void;
}
