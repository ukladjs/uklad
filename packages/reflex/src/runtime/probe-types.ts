import type { EventVector, SubVector } from '../types';

export interface RuntimeProbeParent {
  readonly tracking: RuntimeTrackingContext;
  readonly sourceEffectId?: string;
  readonly sourceEffectIndex?: number;
}

export interface RuntimeProbeTransition {
  readonly status: 'completed' | 'missing-handler' | 'aborted' | 'failed';
  readonly previousState?: unknown;
  readonly candidateState?: unknown;
  readonly effects?: readonly unknown[];
  readonly invalidEffects?: readonly unknown[];
  readonly patches?: readonly RuntimeProbePatch[];
  readonly reversePatches?: readonly RuntimeProbePatch[];
  readonly error?: unknown;
}

export interface RuntimeProbeCommit {
  readonly status: 'committed' | 'unchanged' | 'skipped';
  readonly committedRevision: number;
}

export interface RuntimeProbePatch {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
}

export interface RuntimeProbeEffect {
  readonly type: string;
  readonly value: unknown;
  readonly index: number;
  readonly status: 'succeeded' | 'returned' | 'failed' | 'unhandled' | 'invalid' | 'detached';
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly error?: unknown;
}

export interface RuntimeProbeSubscription {
  readonly key: string;
  readonly query: Readonly<SubVector>;
  readonly kind: 'root' | 'computed';
  readonly active: boolean;
  readonly version: number;
  readonly status: 'value' | 'error';
  readonly value?: unknown;
  readonly error?: string;
}

export interface RuntimeProbeSpan {
  readonly operation?: string;
  readonly opType?: string;
  readonly tags?: Readonly<Record<string, unknown>>;
}

/**
 * The sole optional instrumentation capability installed on a runtime core.
 *
 * Every callback is observational. Return values are opaque correlation tokens
 * only; they can never accept, reject, abort, or otherwise steer execution.
 */
export interface RuntimeProbe {
  readonly needsPatches: boolean;
  readonly needsSubscriptionEvidence: boolean;
  readonly needsSpans: boolean;
  /** Marks a probe that can back explicit tracked-operation dispatch. */
  readonly tracksOperations?: boolean;

  eventAccepted?(event: EventVector, parent?: RuntimeProbeParent): unknown;
  eventQueued?(token: unknown, committedRevision: number): void;
  eventStarted?(token: unknown, committedRevision: number): void;
  transition?(token: unknown, result: RuntimeProbeTransition): void;
  committed?(token: unknown, result: RuntimeProbeCommit): void;
  effect?(token: unknown, result: RuntimeProbeEffect): void;
  eventFinished?(
    token: unknown,
    status: 'completed' | 'rejected' | 'failed',
    error?: unknown,
  ): void;
  eventsDropped?(
    tokens: readonly unknown[],
    reason: 'queue-dropped' | 'disposed',
    error: unknown,
  ): void;
  error?(kind: string, error: unknown): void;

  stateCommitted?(previousState: unknown, nextState: unknown, committedRevision: number): void;
  published?(
    state: unknown,
    publishedRevision: number,
    subscriptions?: readonly RuntimeProbeSubscription[],
  ): void;
  runtimeDisposed?(error: unknown): void;

  spanStarted?(span: RuntimeProbeSpan): unknown;
  spanFinished?(token: unknown, span?: RuntimeProbeSpan): void;
}

/** @internal One installed probe and its attachment lifecycle. */
export interface RuntimeProbeAttachment {
  readonly probe: RuntimeProbe;
  active: boolean;
}

/** @internal One probe-specific token carried by accepted work. */
export interface RuntimeTrackingEntry {
  readonly attachment: RuntimeProbeAttachment;
  readonly token: unknown;
}

/**
 * Minimal optional context carried by accepted queue work. The entries and
 * tokens remain private to the probe host.
 */
export interface RuntimeTrackingContext {
  readonly operationTracked: boolean;
  readonly entries: readonly RuntimeTrackingEntry[];
}

/** @internal Probe-specific tokens for one optional instrumentation span. */
export interface RuntimeSpanContext {
  readonly entries: readonly RuntimeTrackingEntry[];
}
