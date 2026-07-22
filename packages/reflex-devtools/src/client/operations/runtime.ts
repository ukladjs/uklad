/**
 * Structural runtime port used by the optional operation ledger.
 *
 * Keeping this contract local lets the DevTools browser client remain free of
 * a runtime import. DevTools consumes the port only when operations are
 * enabled through `enableDevtools(..., { operations: { ... } })`.
 */
export type OperationEventVector = [string, ...any[]];
export type OperationSubVector = [string, ...any[]];

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

export interface RuntimeLifecycleEffect {
  readonly type: string;
  readonly value: unknown;
  readonly status: 'succeeded' | 'returned' | 'failed' | 'unhandled' | 'invalid' | 'detached';
  readonly startedAtMs: number;
  readonly error?: unknown;
}

export interface RuntimeLifecyclePatch {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
}

export interface RuntimeLifecycleStatePlan {
  readonly previousState: unknown;
  readonly plannedState: unknown;
  readonly patches: readonly RuntimeLifecyclePatch[];
}

export interface RuntimeLifecycleSubscription {
  readonly key: string;
  readonly query: Readonly<OperationSubVector>;
  readonly kind: 'root' | 'computed';
  readonly active: boolean;
  readonly version: number;
  readonly status: 'value' | 'error';
  readonly value?: unknown;
  readonly error?: string;
}

export interface RuntimeLifecycleObserver {
  onEventQueued?(event: OperationEventVector): void;
  onEventStarted?(event: OperationEventVector, committedRevision: number): boolean | void;
  onEventFinished?(event: OperationEventVector, error?: unknown): void;
  onEventDropped?(
    events: readonly OperationEventVector[],
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

export interface DevtoolsOperationRuntime {
  readonly runtimeId: string;
  readonly runtimeInstanceId: string;
  getStateRevisions(): { readonly committedRevision: number; readonly publishedRevision: number };
  dispatch(event: never): void;
  flush(): Promise<void>;
  getSubscriptionValue(query: never): unknown;
  observeLifecycle(observer: RuntimeLifecycleObserver): () => void;
}
