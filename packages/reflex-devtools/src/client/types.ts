import type { DevtoolsOperationRuntime } from './operations/runtime.js';

export interface ReflexSubscriptionDiagnostic {
  readonly key: string;
  readonly query: readonly [string, ...any[]];
  readonly kind: 'root' | 'computed';
  readonly active: boolean;
  readonly version: number;
  readonly status: 'empty' | 'value' | 'error';
  readonly value?: unknown;
  readonly error?: string;
}

export interface ReflexTrace {
  readonly id: number;
  readonly operation?: string;
  readonly opType?: string;
  readonly tags?: Record<string, unknown>;
}

export type ReflexTraceCallback = (traces: ReflexTrace[]) => void | Promise<void>;

export interface ReflexHandlerKeys {
  readonly event: readonly string[];
  readonly fx: readonly string[];
  readonly cofx: readonly string[];
  readonly sub: readonly string[];
}

export interface ReflexInspectorSnapshot {
  readonly state: unknown;
  readonly handlerKeys: ReflexHandlerKeys;
  readonly subscriptions: readonly ReflexSubscriptionDiagnostic[];
}

/**
 * Structural boundary implemented by `runtime.createInspector()` in Reflex.
 *
 * DevTools deliberately owns this small protocol instead of importing the
 * Reflex runtime, so package resolution can never make it inspect another
 * application runtime.
 */
export interface ReflexInspector {
  readonly apiVersion: 2;
  /** Stable identity of the exact Reflex runtime owned by this inspector. */
  readonly runtimeId: string;
  /** Human-readable runtime label. Names are not routing identifiers. */
  readonly runtimeName: string;
  getSnapshot(): ReflexInspectorSnapshot;
  subscribeTraces(callback: ReflexTraceCallback): () => void;
  dispatch(event: [string, ...any[]]): void;
  evaluateSubscription(query: [string, ...any[]]): unknown;
  /** Optional internal port exposed by Reflex inspectors for operation receipts. */
  getOperationRuntime?(): DevtoolsOperationRuntime;
  /** Optional retained-operation receipt capability enabled through DevtoolsConfig. */
  readonly operationApiVersion?: 1;
  /** Exact runtime-instance identity for retained operation receipts. */
  readonly runtimeInstanceId?: string;
  executeEvent?(event: [string, ...any[]], options?: unknown): Promise<unknown>;
  getOperation?(lookup: unknown): unknown;
}

/** A Reflex runtime capable of creating an inspector for DevTools. */
export interface ReflexDevtoolsRuntime {
  createInspector(): ReflexInspector;
}
