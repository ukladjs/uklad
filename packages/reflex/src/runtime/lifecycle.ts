import { attachRuntimeProbe } from './probe';

import type { RuntimeCore } from './core';
import type {
  RuntimeProbe,
  RuntimeProbeEffect,
  RuntimeProbePatch,
  RuntimeProbeSubscription,
  RuntimeProbeTransition,
} from './probe';
import type { EventVector, SubVector } from '../types';

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

export type RuntimeLifecycleEffect = RuntimeProbeEffect;

export interface RuntimeLifecycleStatePlan {
  readonly previousState: unknown;
  readonly plannedState: unknown;
  readonly patches: readonly RuntimeLifecyclePatch[];
}

export type RuntimeLifecyclePatch = RuntimeProbePatch;

export interface RuntimeLifecycleSubscription {
  readonly key: string;
  readonly query: Readonly<SubVector>;
  readonly kind: 'root' | 'computed';
  readonly active: boolean;
  readonly version: number;
  readonly status: 'value' | 'error';
  readonly value?: unknown;
  readonly error?: string;
}

/**
 * Compatibility observer projected onto the passive runtime probe.
 *
 * Boolean returns remain accepted for source compatibility, but are ignored:
 * observability cannot reject events or change coeffect failure policy.
 */
export interface RuntimeLifecycleObserver {
  onEventQueued?(event: EventVector): void;
  onEventStarted?(event: EventVector, committedRevision: number): boolean | void;
  onEventFinished?(event: EventVector, error?: unknown): void;
  onEventDropped?(
    events: readonly EventVector[],
    reason: 'queue-dropped' | 'disposed',
    error: unknown,
  ): void;
  onEventError?(kind: RuntimeLifecycleErrorKind, error: unknown): boolean | void;
  onStatePlanned?(plan: RuntimeLifecycleStatePlan): void;
  onEffects?(effects: readonly unknown[]): void;
  onEffect?(effect: RuntimeLifecycleEffect): void;
  onStateCommitted?(previousState: unknown, nextState: unknown, committedRevision: number): void;
  onStatePublished?(
    state: unknown,
    publishedRevision: number,
    recalculated: readonly RuntimeLifecycleSubscription[],
  ): void;
  getTraceTags?(): Readonly<Record<string, unknown>>;
  onRuntimeDisposed?(): void;
}

interface LifecycleEventToken {
  readonly event: EventVector;
}

/** @internal Register a passive compatibility observer through the single probe slot. */
export function observeRuntimeLifecycle(
  runtime: RuntimeCore,
  observer: RuntimeLifecycleObserver,
): () => void {
  const probe: RuntimeProbe = {
    needsPatches: observer.onStatePlanned !== undefined,
    needsSubscriptionEvidence: observer.onStatePublished !== undefined,
    needsSpans: false,
    eventAccepted(event): LifecycleEventToken {
      return { event };
    },
    eventQueued(token): void {
      observer.onEventQueued?.((token as LifecycleEventToken).event);
    },
    eventStarted(token, revision): void {
      observer.onEventStarted?.((token as LifecycleEventToken).event, revision);
    },
    transition(_token, result): void {
      reportTransition(observer, result);
    },
    effect(_token, effect): void {
      observer.onEffect?.(effect);
    },
    eventFinished(token, _status, error): void {
      observer.onEventFinished?.((token as LifecycleEventToken).event, error);
    },
    eventsDropped(tokens, reason, error): void {
      observer.onEventDropped?.(
        tokens.map((token) => (token as LifecycleEventToken).event),
        reason,
        error,
      );
    },
    error(kind, error): void {
      observer.onEventError?.(kind as RuntimeLifecycleErrorKind, error);
    },
    stateCommitted(previousState, nextState, revision): void {
      observer.onStateCommitted?.(previousState, nextState, revision);
    },
    published(state, revision, subscriptions): void {
      observer.onStatePublished?.(
        state,
        revision,
        (subscriptions ?? []) as readonly RuntimeProbeSubscription[],
      );
    },
    runtimeDisposed(): void {
      observer.onRuntimeDisposed?.();
    },
  };
  const detach = attachRuntimeProbe(runtime, probe);

  let observing = true;
  return () => {
    if (!observing) return;
    observing = false;
    detach();
  };
}

function reportTransition(
  observer: RuntimeLifecycleObserver,
  result: RuntimeProbeTransition,
): void {
  if (
    observer.onStatePlanned &&
    result.candidateState !== undefined &&
    result.previousState !== undefined
  ) {
    observer.onStatePlanned({
      previousState: result.previousState,
      plannedState: result.candidateState,
      patches: result.patches ?? [],
    });
  }
  if (result.effects !== undefined) observer.onEffects?.(result.effects);
  if (result.error !== undefined && result.status !== 'completed') {
    observer.onEventError?.(
      result.status === 'missing-handler' ? 'missing-handler' : 'handler',
      result.error,
    );
  }
}
