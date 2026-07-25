import { attachRuntimeProbe } from './probe';

import type { RuntimeCore } from './core';
import type { RuntimeProbe, RuntimeProbeSubscription, RuntimeProbeTransition } from './probe-types';
import type { RuntimeLifecycleErrorKind, RuntimeLifecycleObserver } from './lifecycle-types';
import type { EventVector } from '../types';

export type {
  RuntimeLifecycleEffect,
  RuntimeLifecycleEffectStatus,
  RuntimeLifecycleErrorKind,
  RuntimeLifecycleObserver,
  RuntimeLifecyclePatch,
  RuntimeLifecycleStatePlan,
  RuntimeLifecycleSubscription,
} from './lifecycle-types';

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
