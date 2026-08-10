import type { TraceCallback } from './core/tracing-types';
import type { DevelopmentExecutionObserver } from './events/execution-observer-types';
import type { SubscriptionDiagnostic } from './runtime/subscriptions/types';
import type { EventVector, SubVector } from './types';

export interface UkladHandlerKeys {
  readonly event: readonly string[];
  readonly fx: readonly string[];
  readonly cofx: readonly string[];
  readonly sub: readonly string[];
}

export interface UkladInspectorSnapshot {
  /** The live state write head. The value is not cloned or deep-frozen. */
  readonly state: unknown;
  /** User-facing handler ids; framework-owned effect ids are omitted. */
  readonly handlerKeys: UkladHandlerKeys;
  /** Cache-only diagnostics. Reading a snapshot never evaluates subscriptions. */
  readonly subscriptions: readonly SubscriptionDiagnostic[];
}

/** @internal Structural runtime port consumed by optional DevTools operation snapshots. */
export interface UkladDevtoolsOperationRuntime {
  readonly runtimeId: string;
  readonly runtimeInstanceId: string;
  dispatch(event: never): string;
  flush(): Promise<void>;
  observeExecution(observer: DevelopmentExecutionObserver): () => void;
}

/**
 * The Uklad-owned side of a development-tools integration.
 *
 * The adapter closes over the module instance that created it, so injected
 * consumers inspect and control that exact state, registry, subscription
 * cache, and trace callback registry.
 */
export interface UkladInspector {
  readonly apiVersion: 2;
  readonly runtimeId: string;
  readonly runtimeName: string;
  /** Exact in-memory runtime lifetime, available to optional diagnostics. */
  readonly runtimeInstanceId?: string;
  getSnapshot(): UkladInspectorSnapshot;
  /** Subscribe to trace batches and keep trace collection active until cleanup. */
  subscribeTraces(callback: TraceCallback): () => void;
  dispatch(event: EventVector): void;
  evaluateSubscription(query: SubVector): unknown;
  /** @internal Runtime port for optional DevTools operation snapshots. */
  getOperationRuntime(): UkladDevtoolsOperationRuntime;
}
