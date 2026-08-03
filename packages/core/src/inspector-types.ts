import type { TraceCallback } from './core/tracing-types';
import type { DevelopmentExecutionObserver } from './events/execution-observer-types';
import type { SubscriptionDiagnostic } from './runtime/subscriptions/types';
import type { EventVector, SubVector } from './types';

export interface ReflexHandlerKeys {
  readonly event: readonly string[];
  readonly fx: readonly string[];
  readonly cofx: readonly string[];
  readonly sub: readonly string[];
}

export interface ReflexInspectorSnapshot {
  /** The live state write head. The value is not cloned or deep-frozen. */
  readonly state: unknown;
  /** User-facing handler ids; framework-owned effect ids are omitted. */
  readonly handlerKeys: ReflexHandlerKeys;
  /** Cache-only diagnostics. Reading a snapshot never evaluates subscriptions. */
  readonly subscriptions: readonly SubscriptionDiagnostic[];
}

/** @internal Structural runtime port consumed by optional DevTools operation snapshots. */
export interface ReflexDevtoolsOperationRuntime {
  readonly runtimeId: string;
  readonly runtimeInstanceId: string;
  dispatch(event: never): string;
  flush(): Promise<void>;
  observeExecution(observer: DevelopmentExecutionObserver): () => void;
}

/**
 * The Reflex-owned side of a development-tools integration.
 *
 * The adapter closes over the module instance that created it, so injected
 * consumers inspect and control that exact state, registry, subscription
 * cache, and trace callback registry.
 */
export interface ReflexInspector {
  readonly apiVersion: 2;
  readonly runtimeId: string;
  readonly runtimeName: string;
  getSnapshot(): ReflexInspectorSnapshot;
  /** Subscribe to trace batches and keep trace collection active until cleanup. */
  subscribeTraces(callback: TraceCallback): () => void;
  dispatch(event: EventVector): void;
  evaluateSubscription(query: SubVector): unknown;
  /** @internal Runtime port for optional DevTools operation snapshots. */
  getOperationRuntime(): ReflexDevtoolsOperationRuntime;
}
