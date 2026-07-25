import type { RuntimeProbeEffect, RuntimeProbePatch } from './probe-types';
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

export type RuntimeLifecycleEffect = RuntimeProbeEffect;
export type RuntimeLifecycleEffectStatus =
  'succeeded' | 'returned' | 'failed' | 'unhandled' | 'invalid' | 'detached';

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
