import { createRuntimeStateKey, getRuntimeState, type RuntimeKernel } from '../runtime/kernel';
import { consoleLog } from '../core/logging';

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

type DevelopmentExecutionNotification = Exclude<keyof DevelopmentExecutionObserver, 'accept'>;

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

/**
 * Ask the optional observer to accept an operation without allowing a
 * diagnostic failure to block ordinary dispatch. Explicit operation callers
 * can require the resulting reference before enqueuing work.
 */
export function acceptDevelopmentExecutionForKernel(
  runtime: RuntimeKernel,
  event: EventVector,
  parent?: DevelopmentExecutionParent,
): DevelopmentOperationReference | undefined {
  const observer = getDevelopmentExecutionObserverForKernel(runtime);
  if (!observer) return undefined;
  try {
    return observer.accept(event, parent);
  } catch (error) {
    consoleLog('warn', '[reflex] development execution observer failed during accept.', error);
    return undefined;
  }
}

/**
 * Notify the optional development observer without allowing diagnostic code to
 * change application execution.
 */
export function notifyDevelopmentExecutionForKernel(
  runtime: RuntimeKernel,
  method: DevelopmentExecutionNotification,
  ...args: unknown[]
): void {
  const observer = getDevelopmentExecutionObserverForKernel(runtime);
  if (!observer) return;
  try {
    const callback = observer[method] as (...values: unknown[]) => void;
    callback.apply(observer, args);
  } catch (error) {
    consoleLog('warn', `[reflex] development execution observer failed during ${method}.`, error);
  }
}
