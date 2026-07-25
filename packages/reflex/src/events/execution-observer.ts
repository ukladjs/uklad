import { attachRuntimeProbe, getRuntimeTrackingToken, type RuntimeProbe } from '../runtime/probe';

import type { RuntimeCore } from '../runtime/core';
import type { RuntimeProbeEffect } from '../runtime/probe';
import type { RuntimeTrackingContext } from '../runtime/probe';
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

interface ObserverAttachment {
  readonly observer: DevelopmentExecutionObserver;
  readonly probe: RuntimeProbe;
  readonly detach: () => void;
}

const OBSERVERS = new WeakMap<RuntimeCore, ObserverAttachment>();

/** @internal Install the DevTools observer through the runtime's sole probe channel. */
export function observeDevelopmentExecution(
  runtime: RuntimeCore,
  observer: DevelopmentExecutionObserver,
): () => void {
  if (OBSERVERS.has(runtime)) {
    throw new Error('[reflex] A development execution observer is already installed.');
  }

  const probe: RuntimeProbe = {
    needsPatches: false,
    needsSubscriptionEvidence: false,
    needsSpans: false,
    tracksOperations: true,
    eventAccepted(event, parent): DevelopmentOperationReference {
      const parentOperation = getRuntimeTrackingToken(parent?.tracking, probe) as
        DevelopmentOperationReference | undefined;
      return observer.accept(
        event,
        parentOperation === undefined
          ? undefined
          : {
              operation: parentOperation,
              ...(parent?.sourceEffectId === undefined
                ? {}
                : { sourceEffectId: parent.sourceEffectId }),
              ...(parent?.sourceEffectIndex === undefined
                ? {}
                : { sourceEffectIndex: parent.sourceEffectIndex }),
            },
      );
    },
    eventQueued(token, revision): void {
      observer.queued(token as DevelopmentOperationReference, revision);
    },
    eventStarted(token, revision): void {
      observer.started(token as DevelopmentOperationReference, revision);
    },
    transition(token, result): void {
      observer.transition(token as DevelopmentOperationReference, result.status, result.error);
    },
    committed(token, result): void {
      observer.committed(
        token as DevelopmentOperationReference,
        result.status,
        result.committedRevision,
      );
    },
    effect(token, result): void {
      observer.effect?.(token as DevelopmentOperationReference, result);
    },
    eventFinished(token, status, error): void {
      observer.finished(token as DevelopmentOperationReference, status, error);
    },
    eventsDropped(tokens, _reason, error): void {
      observer.dropped(tokens as readonly DevelopmentOperationReference[], error);
    },
    published(_state, revision): void {
      observer.published(revision);
    },
    runtimeDisposed(error): void {
      observer.disposed(error);
    },
  };

  const detachProbe = attachRuntimeProbe(runtime, probe);
  const attachment: ObserverAttachment = {
    observer,
    probe,
    detach: detachProbe,
  };
  OBSERVERS.set(runtime, attachment);

  let observing = true;
  return () => {
    if (!observing) return;
    observing = false;
    if (OBSERVERS.get(runtime) === attachment) OBSERVERS.delete(runtime);
    detachProbe();
  };
}

/** @internal Read the optional observer without allocating any runtime state. */
export function getDevelopmentExecutionObserver(
  runtime: RuntimeCore,
): DevelopmentExecutionObserver | undefined {
  return OBSERVERS.get(runtime)?.observer;
}

/** @internal Resolve the DevTools operation reference from one accepted envelope. */
export function getDevelopmentOperationReference(
  runtime: RuntimeCore,
  tracking: RuntimeTrackingContext | undefined,
): DevelopmentOperationReference | undefined {
  const probe = OBSERVERS.get(runtime)?.probe;
  if (!probe) return undefined;
  return getRuntimeTrackingToken(tracking, probe) as DevelopmentOperationReference | undefined;
}
