import { acquireTracing, registerTraceCallback, removeTraceCallback } from './core/tracing';
import { DISPATCH, DISPATCH_LATER } from './events/effects';
import {
  getDevelopmentOperationReference,
  observeDevelopmentExecution,
  type DevelopmentExecutionObserver,
} from './events/execution-observer';
import { isRuntimeDisposed, type RuntimeCore } from './runtime/core';

import type { TraceCallback } from './core/tracing';
import type { SubscriptionDiagnostic } from './runtime/subscriptions/engine';
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

const NEXT_TRACE_SUBSCRIPTION_ID = new WeakMap<RuntimeCore, number>();

function nextTraceSubscriptionId(runtime: RuntimeCore): number {
  const next = (NEXT_TRACE_SUBSCRIPTION_ID.get(runtime) ?? 0) + 1;
  NEXT_TRACE_SUBSCRIPTION_ID.set(runtime, next);
  return next;
}

// Devtools is an intentionally dynamic boundary. App-level payload-map
// augmentation must not narrow vectors arriving from an external inspector.
/** @internal Create an inspection adapter bound to one explicit runtime. */
export function createReflexInspector(runtime: RuntimeCore): ReflexInspector {
  const assertRuntimeActive = () => {
    if (isRuntimeDisposed(runtime)) {
      throw new Error(`[reflex] Runtime '${runtime.identity.runtimeId}' has been disposed.`);
    }
  };
  const operationRuntime: ReflexDevtoolsOperationRuntime = {
    runtimeId: runtime.identity.runtimeId,
    runtimeInstanceId: runtime.identity.runtimeInstanceId,
    dispatch(event: never) {
      assertRuntimeActive();
      const envelope = runtime.events.dispatch(event, true);
      const operation = getDevelopmentOperationReference(runtime, envelope?.tracking);
      if (!operation)
        throw new Error('[reflex] operation dispatch requires an installed development observer.');
      return operation.operationId;
    },
    flush() {
      assertRuntimeActive();
      return runtime.events.flush();
    },
    observeExecution(observer: DevelopmentExecutionObserver) {
      assertRuntimeActive();
      return observeDevelopmentExecution(runtime, observer);
    },
  };
  const inspector: ReflexInspector = {
    apiVersion: 2,
    runtimeId: runtime.identity.runtimeId,
    runtimeName: runtime.identity.runtimeName,
    getSnapshot(): ReflexInspectorSnapshot {
      assertRuntimeActive();
      return {
        state: runtime.state.get(),
        handlerKeys: getHandlerKeys(runtime),
        subscriptions: runtime.subscriptions.diagnostics(),
      };
    },
    subscribeTraces(callback: TraceCallback): () => void {
      assertRuntimeActive();
      const key = `reflex-inspector-${nextTraceSubscriptionId(runtime)}`;
      const releaseTracing = acquireTracing(runtime);
      try {
        registerTraceCallback(runtime, key, callback);
      } catch (error) {
        releaseTracing();
        throw error;
      }

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        removeTraceCallback(runtime, key);
        releaseTracing();
      };
    },
    dispatch(event: EventVector): void {
      assertRuntimeActive();
      runtime.events.dispatch(event as never);
    },
    evaluateSubscription(query: SubVector): unknown {
      assertRuntimeActive();
      return runtime.subscriptions.read(query);
    },
    getOperationRuntime(): ReflexDevtoolsOperationRuntime {
      assertRuntimeActive();
      return operationRuntime;
    },
  };

  return Object.freeze(inspector);
}

function getHandlerKeys(runtime: RuntimeCore): ReflexHandlerKeys {
  const handlers = runtime.registry.handlers;
  return {
    event: Object.keys(handlers.event),
    fx: Object.keys(handlers.fx).filter((id) => id !== DISPATCH && id !== DISPATCH_LATER),
    cofx: Object.keys(handlers.cofx),
    sub: Object.keys(handlers.sub),
  };
}
