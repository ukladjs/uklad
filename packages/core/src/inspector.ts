import { acquireTracing, registerTraceCallback, removeTraceCallback } from './runtime/tracing';
import { attachRuntimeProbe } from './runtime/probe';
import { DISPATCH, DISPATCH_LATER } from './events/built-in-effects';
import {
  getDevelopmentOperationReference,
  observeDevelopmentExecution,
} from './events/execution-observer';
import { type RuntimeCore } from './runtime/core';
import { assertRuntimeUsable } from './runtime/validation';

import type { TraceCallback } from './core/tracing-types';
import type { DevelopmentExecutionObserver } from './events/execution-observer-types';
import type { RuntimeProbe } from './runtime/probe-types';
import type {
  UkladDevtoolsOperationRuntime,
  UkladHandlerKeys,
  UkladInspector,
  UkladInspectorSnapshot,
  UkladStateRevisionsCallback,
} from './inspector-types';
import type { EventVector, SubVector } from './types';

export type {
  UkladDevtoolsOperationRuntime,
  UkladHandlerKeys,
  UkladInspector,
  UkladInspectorSnapshot,
  UkladStateRevisionsCallback,
} from './inspector-types';

const NEXT_TRACE_SUBSCRIPTION_ID = new WeakMap<RuntimeCore, number>();

// Devtools is an intentionally dynamic boundary. App-level payload-map
// augmentation must not narrow vectors arriving from an external inspector.
/** @internal Create an inspection adapter bound to one explicit runtime. */
export function createUkladInspector(runtime: RuntimeCore): UkladInspector {
  const operationRuntime: UkladDevtoolsOperationRuntime = {
    runtimeId: runtime.identity.runtimeId,
    runtimeInstanceId: runtime.identity.runtimeInstanceId,
    dispatch(event: never) {
      assertRuntimeUsable(runtime);
      const envelope = runtime.events.dispatch(event, true);
      const operation = getDevelopmentOperationReference(runtime, envelope?.tracking);
      if (!operation)
        throw new Error('[uklad] operation dispatch requires an installed development observer.');
      return operation.operationId;
    },
    flush() {
      assertRuntimeUsable(runtime);
      return runtime.events.flush();
    },
    observeExecution(observer: DevelopmentExecutionObserver) {
      assertRuntimeUsable(runtime);
      return observeDevelopmentExecution(runtime, observer);
    },
  };
  const inspector: UkladInspector = {
    apiVersion: 2,
    runtimeId: runtime.identity.runtimeId,
    runtimeName: runtime.identity.runtimeName,
    runtimeInstanceId: runtime.identity.runtimeInstanceId,
    getSnapshot(): UkladInspectorSnapshot {
      assertRuntimeUsable(runtime);
      return {
        state: runtime.state.get(),
        stateRevisions: runtime.state.getRevisions(),
        handlerKeys: getHandlerKeys(runtime),
        subscriptions: runtime.subscriptions.diagnostics(),
      };
    },
    subscribeTraces(callback: TraceCallback): () => void {
      assertRuntimeUsable(runtime);
      const key = `uklad-inspector-${nextTraceSubscriptionId(runtime)}`;
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
    subscribeStateRevisions(callback: UkladStateRevisionsCallback): () => void {
      assertRuntimeUsable(runtime);
      const probe: RuntimeProbe = Object.freeze({
        needsPatches: false,
        needsSubscriptionEvidence: false,
        needsSpans: false,
        stateCommitted(
          _previousState: unknown,
          _nextState: unknown,
          committedRevision: number,
        ): void {
          callback(
            Object.freeze({
              committedRevision,
              publishedRevision: runtime.state.publishedRevision,
            }),
          );
        },
        published(_state: unknown, publishedRevision: number): void {
          callback(
            Object.freeze({
              committedRevision: runtime.state.committedRevision,
              publishedRevision,
            }),
          );
        },
      });
      return attachRuntimeProbe(runtime, probe);
    },
    dispatch(event: EventVector): void {
      assertRuntimeUsable(runtime);
      runtime.events.dispatch(event as never);
    },
    evaluateSubscription(query: SubVector): unknown {
      assertRuntimeUsable(runtime);
      return runtime.subscriptions.read(query);
    },
    getOperationRuntime(): UkladDevtoolsOperationRuntime {
      assertRuntimeUsable(runtime);
      return operationRuntime;
    },
  };

  return Object.freeze(inspector);
}

function nextTraceSubscriptionId(runtime: RuntimeCore): number {
  const next = (NEXT_TRACE_SUBSCRIPTION_ID.get(runtime) ?? 0) + 1;
  NEXT_TRACE_SUBSCRIPTION_ID.set(runtime, next);
  return next;
}

function getHandlerKeys(runtime: RuntimeCore): UkladHandlerKeys {
  const handlers = runtime.registry.handlers;
  return {
    event: Object.keys(handlers.event),
    fx: Object.keys(handlers.fx).filter((id) => id !== DISPATCH && id !== DISPATCH_LATER),
    cofx: Object.keys(handlers.cofx),
    sub: Object.keys(handlers.sub),
  };
}
