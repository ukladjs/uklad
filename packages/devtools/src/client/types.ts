import type { DevtoolsOperationRuntime } from './operations/runtime.js';

export interface UkladSubscriptionDiagnostic {
  readonly key: string;
  readonly query: readonly [string, ...any[]];
  readonly kind: 'root' | 'computed';
  readonly active: boolean;
  readonly version: number;
  readonly status: 'empty' | 'value' | 'error';
  readonly value?: unknown;
  readonly error?: string;
}

export interface UkladTrace {
  readonly id: number;
  readonly operation?: string;
  readonly opType?: string;
  readonly tags?: Record<string, unknown>;
}

export type UkladTraceCallback = (traces: UkladTrace[]) => void | Promise<void>;

export interface UkladHandlerKeys {
  readonly event: readonly string[];
  readonly fx: readonly string[];
  readonly cofx: readonly string[];
  readonly sub: readonly string[];
}

export interface UkladInspectorSnapshot {
  readonly state: unknown;
  readonly handlerKeys: UkladHandlerKeys;
  readonly subscriptions: readonly UkladSubscriptionDiagnostic[];
}

/**
 * Structural boundary returned by `createUkladInspector(runtime)` in Uklad.
 *
 * DevTools deliberately owns this small protocol instead of importing the
 * Uklad runtime, so package resolution can never make it inspect another
 * application runtime.
 */
export interface UkladInspector {
  readonly apiVersion: 2;
  /** Stable identity of the exact Uklad runtime owned by this inspector. */
  readonly runtimeId: string;
  /** Human-readable runtime label. Names are not routing identifiers. */
  readonly runtimeName: string;
  getSnapshot(): UkladInspectorSnapshot;
  subscribeTraces(callback: UkladTraceCallback): () => void;
  dispatch(event: [string, ...any[]]): void;
  evaluateSubscription(query: [string, ...any[]]): unknown;
  /** Optional internal port exposed by Uklad inspectors for operation snapshots. */
  getOperationRuntime?(): DevtoolsOperationRuntime;
  /** Optional DevTools-owned operation snapshot capability. */
  readonly operationApiVersion?: 1;
  /** Exact runtime-instance identity for operation snapshots. */
  readonly runtimeInstanceId?: string;
  executeEvent?(event: [string, ...any[]]): Promise<unknown>;
  getOperation?(operationId: string): unknown;
}
