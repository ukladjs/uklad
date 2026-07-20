import {
  acquireTracingForRuntime,
  registerTraceCallbackForRuntime,
  removeTraceCallbackForRuntime,
} from './core/tracing';
import { NOW, RANDOM } from './events/coeffects';
import { DISPATCH, DISPATCH_LATER } from './events/effects';
import { dispatchForRuntime } from './events/router';
import { dispatchAndWaitForRuntime, startOperationForRuntime } from './events/router';
import { getAppDbForRuntime } from './runtime/app-db';
import { getHandlersForRuntime } from './runtime/handlers';
import { getOperationForRuntime } from './runtime/operations';
import { defaultRuntimeScope, isRuntimeDisposed, type RuntimeScope } from './runtime/scope';
import { getSubscriptionDiagnosticsForRuntime } from './runtime/subscriptions/cache';
import { getSubscriptionValueForRuntime } from './subscriptions/queries';

import type { TraceCallback } from './core/tracing';
import type { SubscriptionDiagnostic } from './runtime/subscriptions/engine';
import type {
  DispatchAndWaitOptions,
  OperationHandle,
  OperationLookup,
  OperationReceipt,
  OperationWaitResult,
} from './runtime/operations';
import type { EventVector, SubVector } from './types';

export interface ReflexHandlerKeys {
  readonly event: readonly string[];
  readonly fx: readonly string[];
  readonly cofx: readonly string[];
  readonly sub: readonly string[];
}

export interface ReflexInspectorSnapshot {
  /** The live app-db write head. The value is not cloned or deep-frozen. */
  readonly appDb: unknown;
  /** User-facing handler ids; framework-owned effect and coeffect ids are omitted. */
  readonly handlerKeys: ReflexHandlerKeys;
  /** Cache-only diagnostics. Reading a snapshot never evaluates subscriptions. */
  readonly subscriptions: readonly SubscriptionDiagnostic[];
}

/**
 * The Reflex-owned side of a development-tools integration.
 *
 * The adapter closes over the module instance that created it, so injected
 * consumers inspect and control that exact app-db, registry, subscription
 * cache, and trace callback registry.
 */
export interface ReflexInspector {
  readonly apiVersion: 2;
  /** Additive authoritative-operation capability; absent on older v2 inspectors. */
  readonly operationApiVersion?: 1;
  readonly runtimeId: string;
  readonly runtimeInstanceId?: string;
  readonly runtimeName: string;
  getSnapshot(): ReflexInspectorSnapshot;
  /** Subscribe to trace batches and keep trace collection active until cleanup. */
  subscribeTraces(callback: TraceCallback): () => void;
  dispatch(event: EventVector): void;
  startEvent?(event: EventVector, options?: DispatchAndWaitOptions): OperationHandle;
  executeEvent?(event: EventVector, options?: DispatchAndWaitOptions): Promise<OperationWaitResult>;
  getOperation?(query: OperationLookup): OperationReceipt | undefined;
  evaluateSubscription(query: SubVector): unknown;
}

export interface ReflexOperationInspector extends ReflexInspector {
  readonly operationApiVersion: 1;
  readonly runtimeInstanceId: string;
  startEvent(event: EventVector, options?: DispatchAndWaitOptions): OperationHandle;
  executeEvent(event: EventVector, options?: DispatchAndWaitOptions): Promise<OperationWaitResult>;
  getOperation(query: OperationLookup): OperationReceipt | undefined;
}

const nextTraceSubscriptionIds = new WeakMap<RuntimeScope, number>();

function nextTraceSubscriptionId(runtime: RuntimeScope): number {
  const next = (nextTraceSubscriptionIds.get(runtime) ?? 0) + 1;
  nextTraceSubscriptionIds.set(runtime, next);
  return next;
}

// Devtools is an intentionally dynamic boundary. App-level payload-map
// augmentation must not narrow vectors arriving from an external inspector.
/** Create an inspection adapter bound to this exact Reflex module instance. */
export function createReflexInspector(): ReflexOperationInspector {
  return createReflexInspectorForRuntime(defaultRuntimeScope);
}

/** @internal Create an inspection adapter bound to one explicit runtime. */
export function createReflexInspectorForRuntime(runtime: RuntimeScope): ReflexOperationInspector {
  const assertRuntimeActive = () => {
    if (isRuntimeDisposed(runtime)) {
      throw new Error(`[reflex] Runtime '${runtime.runtimeId}' has been disposed.`);
    }
  };
  const inspector: ReflexOperationInspector = {
    apiVersion: 2,
    operationApiVersion: 1,
    runtimeId: runtime.runtimeId,
    runtimeInstanceId: runtime.runtimeInstanceId,
    runtimeName: runtime.runtimeName,
    getSnapshot(): ReflexInspectorSnapshot {
      assertRuntimeActive();
      return {
        appDb: getAppDbForRuntime(runtime),
        handlerKeys: getHandlerKeys(runtime),
        subscriptions: getSubscriptionDiagnosticsForRuntime(runtime),
      };
    },
    subscribeTraces(callback: TraceCallback): () => void {
      assertRuntimeActive();
      const key = `reflex-inspector-${nextTraceSubscriptionId(runtime)}`;
      const releaseTracing = acquireTracingForRuntime(runtime);
      try {
        registerTraceCallbackForRuntime(runtime, key, callback);
      } catch (error) {
        releaseTracing();
        throw error;
      }

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        removeTraceCallbackForRuntime(runtime, key);
        releaseTracing();
      };
    },
    dispatch(event: EventVector): void {
      assertRuntimeActive();
      dispatchForRuntime(runtime, event as never);
    },
    executeEvent(
      event: EventVector,
      options?: DispatchAndWaitOptions,
    ): Promise<OperationWaitResult> {
      assertRuntimeActive();
      return dispatchAndWaitForRuntime(runtime, event as never, options);
    },
    startEvent(event: EventVector, options?: DispatchAndWaitOptions): OperationHandle {
      assertRuntimeActive();
      return startOperationForRuntime(runtime, event as never, options);
    },
    getOperation(query: OperationLookup): OperationReceipt | undefined {
      return getOperationForRuntime(runtime, query);
    },
    evaluateSubscription(query: SubVector): unknown {
      assertRuntimeActive();
      return getSubscriptionValueForRuntime(runtime, query);
    },
  };

  return Object.freeze(inspector);
}

function getHandlerKeys(runtime: RuntimeScope): ReflexHandlerKeys {
  const handlers = getHandlersForRuntime(runtime);
  return {
    event: Object.keys(handlers.event),
    fx: Object.keys(handlers.fx).filter((id) => id !== DISPATCH && id !== DISPATCH_LATER),
    cofx: Object.keys(handlers.cofx).filter((id) => id !== NOW && id !== RANDOM),
    sub: Object.keys(handlers.sub),
  };
}
