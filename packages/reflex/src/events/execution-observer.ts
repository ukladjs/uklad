import { createRuntimeStateKey, getRuntimeState, type RuntimeKernel } from '../runtime/kernel';

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
 * Narrow, optional development seam. Core reports execution facts but never
 * creates operation records, snapshots, or outcome objects itself.
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
  finished(
    operation: DevelopmentOperationReference,
    status: 'completed' | 'rejected' | 'failed',
    error?: unknown,
  ): void;
  dropped(operations: readonly DevelopmentOperationReference[], error: unknown): void;
  published(publishedRevision: number): void;
  disposed(error: unknown): void;
}

const DEVELOPMENT_EXECUTION_OBSERVER = createRuntimeStateKey<DevelopmentExecutionObserver>(
  'reflex.development-execution-observer',
);

/** @internal Install one optional development observer for this runtime. */
export function observeDevelopmentExecutionForKernel(
  runtime: RuntimeKernel,
  observer: DevelopmentExecutionObserver,
): () => void {
  if (getRuntimeState(runtime, DEVELOPMENT_EXECUTION_OBSERVER) !== undefined) {
    throw new Error('[reflex] A development execution observer is already installed.');
  }
  runtime.extensions.set(DEVELOPMENT_EXECUTION_OBSERVER.symbol, observer);
  return () => {
    if (getRuntimeState(runtime, DEVELOPMENT_EXECUTION_OBSERVER) === observer)
      runtime.extensions.delete(DEVELOPMENT_EXECUTION_OBSERVER.symbol);
  };
}

/** @internal Read the observer without allocating runtime extension state. */
export function getDevelopmentExecutionObserverForKernel(
  runtime: RuntimeKernel,
): DevelopmentExecutionObserver | undefined {
  return getRuntimeState(runtime, DEVELOPMENT_EXECUTION_OBSERVER);
}
