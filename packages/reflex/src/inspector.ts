import { acquireTracing, registerTraceCallback, removeTraceCallback } from './core/tracing';
import { NOW, RANDOM } from './events/coeffects';
import { DISPATCH, DISPATCH_LATER } from './events/effects';
import { dispatch as dispatchEvent } from './events/router';
import { getAppDb } from './runtime/app-db';
import { getHandlers } from './runtime/handlers';
import { getSubscriptionDiagnostics } from './runtime/subscriptions/cache';
import { getSubscriptionValue } from './subscriptions/queries';

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
  readonly apiVersion: 1;
  getSnapshot(): ReflexInspectorSnapshot;
  /** Subscribe to trace batches and keep trace collection active until cleanup. */
  subscribeTraces(callback: TraceCallback): () => void;
  dispatch(event: EventVector): void;
  evaluateSubscription(query: SubVector): unknown;
}

let nextTraceSubscriptionId = 0;

// Devtools is an intentionally dynamic boundary. App-level payload-map
// augmentation must not narrow vectors arriving from an external inspector.
const dispatchInspectorEvent = dispatchEvent as (event: EventVector) => void;
const evaluateInspectorSubscription = getSubscriptionValue as (query: SubVector) => unknown;

/** Create an inspection adapter bound to this exact Reflex module instance. */
export function createReflexInspector(): ReflexInspector {
  const inspector: ReflexInspector = {
    apiVersion: 1,
    getSnapshot(): ReflexInspectorSnapshot {
      return {
        appDb: getAppDb(),
        handlerKeys: getHandlerKeys(),
        subscriptions: getSubscriptionDiagnostics(),
      };
    },
    subscribeTraces(callback: TraceCallback): () => void {
      const key = `reflex-inspector-${++nextTraceSubscriptionId}`;
      const releaseTracing = acquireTracing();
      try {
        registerTraceCallback(key, callback);
      } catch (error) {
        releaseTracing();
        throw error;
      }

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        removeTraceCallback(key);
        releaseTracing();
      };
    },
    dispatch(event: EventVector): void {
      dispatchInspectorEvent(event);
    },
    evaluateSubscription(query: SubVector): unknown {
      return evaluateInspectorSubscription(query);
    },
  };

  return Object.freeze(inspector);
}

function getHandlerKeys(): ReflexHandlerKeys {
  const handlers = getHandlers();
  return {
    event: Object.keys(handlers.event),
    fx: Object.keys(handlers.fx).filter((id) => id !== DISPATCH && id !== DISPATCH_LATER),
    cofx: Object.keys(handlers.cofx).filter((id) => id !== NOW && id !== RANDOM),
    sub: Object.keys(handlers.sub),
  };
}
