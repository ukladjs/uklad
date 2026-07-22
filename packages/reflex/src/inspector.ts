import {
  acquireTracingForKernel,
  registerTraceCallbackForKernel,
  removeTraceCallbackForKernel,
} from './core/tracing';
import { NOW, RANDOM } from './events/coeffects';
import { DISPATCH, DISPATCH_LATER } from './events/effects';
import { dispatchForKernel, flushRuntime } from './events/router';
import { getStateForKernel, getStateRevisionsForKernel } from './runtime/state';
import { getHandlersForKernel } from './runtime/handlers';
import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  isRuntimeDisposed,
  type RuntimeKernel,
} from './runtime/kernel';
import {
  observeRuntimeLifecycleForKernel,
  type RuntimeLifecycleObserver,
} from './runtime/lifecycle';
import { getSubscriptionDiagnosticsForKernel } from './runtime/subscriptions/cache';
import { getSubscriptionValueForKernel } from './subscriptions/queries';

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
  readonly appState: unknown;
  /** User-facing handler ids; framework-owned effect and coeffect ids are omitted. */
  readonly handlerKeys: ReflexHandlerKeys;
  /** Cache-only diagnostics. Reading a snapshot never evaluates subscriptions. */
  readonly subscriptions: readonly SubscriptionDiagnostic[];
}

/** @internal Structural runtime port consumed by the optional DevTools operation ledger. */
export interface ReflexDevtoolsOperationRuntime {
  readonly runtimeId: string;
  readonly runtimeInstanceId: string;
  getStateRevisions(): { readonly committedRevision: number; readonly publishedRevision: number };
  dispatch(event: never): void;
  flush(): Promise<void>;
  getSubscriptionValue(query: never): unknown;
  observeLifecycle(observer: RuntimeLifecycleObserver): () => void;
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
  /** @internal Runtime port for optional DevTools operation receipts. */
  getOperationRuntime(): ReflexDevtoolsOperationRuntime;
}

const NEXT_TRACE_SUBSCRIPTION_ID = createRuntimeStateKey<{ value: number }>(
  'reflex.inspector-trace-subscription-id',
);

function nextTraceSubscriptionId(runtime: RuntimeKernel): number {
  return ++getOrCreateRuntimeState(runtime, NEXT_TRACE_SUBSCRIPTION_ID, () => ({ value: 0 })).value;
}

// Devtools is an intentionally dynamic boundary. App-level payload-map
// augmentation must not narrow vectors arriving from an external inspector.
/** @internal Create an inspection adapter bound to one explicit runtime. */
export function createReflexInspectorForKernel(runtime: RuntimeKernel): ReflexInspector {
  const assertRuntimeActive = () => {
    if (isRuntimeDisposed(runtime)) {
      throw new Error(`[reflex] Runtime '${runtime.runtimeId}' has been disposed.`);
    }
  };
  const operationRuntime: ReflexDevtoolsOperationRuntime = {
    runtimeId: runtime.runtimeId,
    runtimeInstanceId: runtime.runtimeInstanceId,
    getStateRevisions() {
      assertRuntimeActive();
      return getStateRevisionsForKernel(runtime);
    },
    dispatch(event: never) {
      assertRuntimeActive();
      dispatchForKernel(runtime, event);
    },
    flush() {
      assertRuntimeActive();
      return flushRuntime(runtime);
    },
    getSubscriptionValue(query: never) {
      assertRuntimeActive();
      return getSubscriptionValueForKernel(runtime, query);
    },
    observeLifecycle(observer: RuntimeLifecycleObserver) {
      assertRuntimeActive();
      return observeRuntimeLifecycleForKernel(runtime, observer);
    },
  };
  const inspector: ReflexInspector = {
    apiVersion: 2,
    runtimeId: runtime.runtimeId,
    runtimeName: runtime.runtimeName,
    getSnapshot(): ReflexInspectorSnapshot {
      assertRuntimeActive();
      return {
        appState: getStateForKernel(runtime),
        handlerKeys: getHandlerKeys(runtime),
        subscriptions: getSubscriptionDiagnosticsForKernel(runtime),
      };
    },
    subscribeTraces(callback: TraceCallback): () => void {
      assertRuntimeActive();
      const key = `reflex-inspector-${nextTraceSubscriptionId(runtime)}`;
      const releaseTracing = acquireTracingForKernel(runtime);
      try {
        registerTraceCallbackForKernel(runtime, key, callback);
      } catch (error) {
        releaseTracing();
        throw error;
      }

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        removeTraceCallbackForKernel(runtime, key);
        releaseTracing();
      };
    },
    dispatch(event: EventVector): void {
      assertRuntimeActive();
      dispatchForKernel(runtime, event as never);
    },
    evaluateSubscription(query: SubVector): unknown {
      assertRuntimeActive();
      return getSubscriptionValueForKernel(runtime, query);
    },
    getOperationRuntime(): ReflexDevtoolsOperationRuntime {
      assertRuntimeActive();
      return operationRuntime;
    },
  };

  return Object.freeze(inspector);
}

function getHandlerKeys(runtime: RuntimeKernel): ReflexHandlerKeys {
  const handlers = getHandlersForKernel(runtime);
  return {
    event: Object.keys(handlers.event),
    fx: Object.keys(handlers.fx).filter((id) => id !== DISPATCH && id !== DISPATCH_LATER),
    cofx: Object.keys(handlers.cofx).filter((id) => id !== NOW && id !== RANDOM),
    sub: Object.keys(handlers.sub),
  };
}
