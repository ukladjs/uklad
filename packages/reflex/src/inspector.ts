import {
  acquireTracingForRuntime,
  registerTraceCallbackForRuntime,
  removeTraceCallbackForRuntime,
} from './core/tracing';
import { NOW, RANDOM } from './events/coeffects';
import { DISPATCH, DISPATCH_LATER } from './events/effects';
import { dispatchForRuntime } from './events/router';
import { getAppDbForRuntime } from './runtime/app-db';
import { getHandlersForRuntime } from './runtime/handlers';
import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  isRuntimeDisposed,
  type RuntimeScope,
} from './runtime/scope';
import { getSubscriptionDiagnosticsForRuntime } from './runtime/subscriptions/cache';
import { getSubscriptionValueForRuntime } from './subscriptions/queries';

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
  readonly runtimeId: string;
  readonly runtimeName: string;
  getSnapshot(): ReflexInspectorSnapshot;
  /** Subscribe to trace batches and keep trace collection active until cleanup. */
  subscribeTraces(callback: TraceCallback): () => void;
  dispatch(event: EventVector): void;
  evaluateSubscription(query: SubVector): unknown;
}

const NEXT_TRACE_SUBSCRIPTION_ID = createRuntimeStateKey<{ value: number }>(
  'reflex.inspector-trace-subscription-id',
);

function nextTraceSubscriptionId(runtime: RuntimeScope): number {
  return ++getOrCreateRuntimeState(runtime, NEXT_TRACE_SUBSCRIPTION_ID, () => ({ value: 0 })).value;
}

// Devtools is an intentionally dynamic boundary. App-level payload-map
// augmentation must not narrow vectors arriving from an external inspector.
/** @internal Create an inspection adapter bound to one explicit runtime. */
export function createReflexInspectorForRuntime(runtime: RuntimeScope): ReflexInspector {
  const assertRuntimeActive = () => {
    if (isRuntimeDisposed(runtime)) {
      throw new Error(`[reflex] Runtime '${runtime.runtimeId}' has been disposed.`);
    }
  };
  const inspector: ReflexInspector = {
    apiVersion: 2,
    runtimeId: runtime.runtimeId,
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
