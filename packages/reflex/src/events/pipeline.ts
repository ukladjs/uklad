import { produce, produceWithPatches, type Draft } from 'immer';

import { IS_DEV } from '../core/environment';
import { ensurePatchesEnabled } from '../core/immer';
import { consoleLog } from '../core/logging';
import { isTraceEnabledForKernel, mergeTraceForKernel, withTraceForKernel } from '../core/tracing';
import { getAppDbRevisionsForKernel } from '../runtime/app-db';
import { getInterceptorsForKernel } from '../runtime/event-metadata';
import {
  getHandlerForKernel,
  registerHandlerForKernel,
  registerSystemHandlerForKernel,
} from '../runtime/handlers';
import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  type RuntimeKernel,
} from '../runtime/kernel';
import {
  beginRuntimeLifecycleEventForKernel,
  getRuntimeLifecycleTraceTagsForKernel,
  hasRuntimeLifecycleObservers,
  notifyRuntimeLifecycleForKernel,
  reportRuntimeLifecycleErrorForKernel,
} from '../runtime/lifecycle';
import { getDoFxInterceptorForKernel } from './effects';
import { getGlobalInterceptorsForKernel } from './global-interceptors';
import { executeForKernel } from './interceptors';

import type {
  Context,
  Db,
  ErrorHandler,
  Effects,
  EventHandler,
  EventVector,
  Id,
  Interceptor,
  ReflexError,
  TraceErrorTag,
} from '../types';

const HANDLER_KIND = 'event';
const ERROR_HANDLER_KIND = 'error';
const EVENT_ERROR_HANDLER_ID = 'event-handler';

interface PipelineState {
  handlingEventId: Id | null;
  runningHandlerEventId: Id | null;
}

const PIPELINE_STATE = createRuntimeStateKey<PipelineState>('reflex.pipeline');

function getPipelineState(runtime: RuntimeKernel): PipelineState {
  return getOrCreateRuntimeState(runtime, PIPELINE_STATE, () => ({
    handlingEventId: null,
    runningHandlerEventId: null,
  }));
}

/** @internal Return the event being handled by one runtime. */
export function getHandlingEventIdForKernel(runtime: RuntimeKernel): Id | null {
  return getPipelineState(runtime).handlingEventId;
}

/** @internal Return the pure handler currently running in one runtime. */
export function getRunningHandlerEventIdForKernel(runtime: RuntimeKernel): Id | null {
  return getPipelineState(runtime).runningHandlerEventId;
}

/** @internal Register one runtime's event-pipeline error handler. */
export function regEventErrorHandlerForKernel(runtime: RuntimeKernel, handler: ErrorHandler): void {
  registerHandlerForKernel(runtime, ERROR_HANDLER_KIND, EVENT_ERROR_HANDLER_ID, handler);
}

/** Log and rethrow an unhandled event-pipeline exception. */
export function defaultErrorHandler(originalError: Error, reflexError: ReflexError): void {
  consoleLog('error', '[reflex] Interceptor Exception:', {
    originalError,
    reflexError,
    data: reflexError.data,
  });
  throw originalError;
}

/** @internal Run a registered event through one runtime's pipeline. */
export function handleForKernel(runtime: RuntimeKernel, event: EventVector): void {
  if (
    beginRuntimeLifecycleEventForKernel(
      runtime,
      event,
      getAppDbRevisionsForKernel(runtime).committedRevision,
    )
  ) {
    notifyRuntimeLifecycleForKernel(runtime, 'onEventFinished', event);
    return;
  }
  const eventId = event[0];
  const handler = getHandlerForKernel(runtime, HANDLER_KIND, eventId);

  if (!handler) {
    consoleLog('error', '[reflex] no event handler registered for:', eventId);
    const error: TraceErrorTag = {
      phase: 'missing-handler',
      message: `no event handler registered for: ${eventId}`,
      eventV: event,
    };
    reportRuntimeLifecycleErrorForKernel(runtime, 'missing-handler', new Error(error.message));
    withTraceForKernel(
      runtime,
      {
        operation: eventId,
        opType: HANDLER_KIND,
        tags: { event, error, ...getRuntimeLifecycleTraceTagsForKernel(runtime) },
      },
      () => {},
    );
    notifyRuntimeLifecycleForKernel(runtime, 'onEventFinished', event);
    return;
  }

  const interceptors = [
    getDoFxInterceptorForKernel(runtime),
    getInjectGlobalInterceptorsForKernel(runtime),
    ...getInterceptorsForKernel(runtime, eventId),
    createEventHandlerInterceptor(runtime, handler),
  ];

  const state = getPipelineState(runtime);
  state.handlingEventId = eventId;
  let error: unknown;
  try {
    withTraceForKernel(
      runtime,
      {
        operation: eventId,
        opType: HANDLER_KIND,
        tags: { event, ...getRuntimeLifecycleTraceTagsForKernel(runtime) },
      },
      () => {
        executeForKernel(runtime, event, interceptors);
      },
    );
  } catch (caughtError) {
    error = caughtError;
    throw caughtError;
  } finally {
    state.handlingEventId = null;
    notifyRuntimeLifecycleForKernel(runtime, 'onEventFinished', event, error);
  }
}

const GLOBAL_INTERCEPTOR = createRuntimeStateKey<Interceptor>('reflex.inject-global-interceptors');

/** @internal Inject the current global interceptors into an event pipeline. */
export function getInjectGlobalInterceptorsForKernel(runtime: RuntimeKernel): Interceptor {
  return getOrCreateRuntimeState(runtime, GLOBAL_INTERCEPTOR, () => ({
    id: 'inject-global-interceptors',
    before(context) {
      context.queue = [...getGlobalInterceptorsForKernel(runtime), ...context.queue];
      return context;
    },
  }));
}

function createEventHandlerInterceptor(
  runtime: RuntimeKernel,
  handler: EventHandler<any>,
): Interceptor {
  return {
    id: 'fx-handler',
    before(context: Context) {
      const event = context.coeffects.event;
      const params = event.slice(1);
      let effects: Effects = [];
      let newDb: Db;

      const recipe = (draftDb: Draft<Db>) => {
        const coeffects = { ...context.coeffects, draftDb };
        const state = getPipelineState(runtime);
        state.runningHandlerEventId = event[0];
        try {
          effects = handler(coeffects, ...params) ?? [];
        } finally {
          state.runningHandlerEventId = null;
        }
      };

      const tracingEnabled = isTraceEnabledForKernel(runtime);
      if (tracingEnabled || hasRuntimeLifecycleObservers(runtime)) {
        ensurePatchesEnabled();
        const [producedDb, patches, reversePatches] = produceWithPatches(
          context.previousDb as Db,
          recipe,
        );
        newDb = producedDb;
        notifyRuntimeLifecycleForKernel(runtime, 'onStatePlanned', {
          previousDb: context.previousDb,
          plannedDb: producedDb,
          patches,
        });
        if (tracingEnabled) {
          mergeTraceForKernel(runtime, { tags: { patches, reversePatches, effects } });
        }
      } else {
        newDb = produce(context.previousDb as Db, recipe);
      }

      if (IS_DEV) {
        try {
          JSON.stringify(effects);
        } catch {
          consoleLog(
            'warn',
            `[reflex] Effects ${effects} contain Proxy (probably an Immer draft). Use current() for draftDb values.`,
          );
        }
      }

      let nextEffects = context.effects;
      if (!Array.isArray(effects)) {
        consoleLog('warn', `[reflex] effects expects a vector, but was given ${typeof effects}`);
        notifyRuntimeLifecycleForKernel(runtime, 'onEffect', {
          type: '<invalid>',
          value: effects,
          status: 'invalid',
          startedAtMs: Date.now(),
        });
      } else {
        // Untyped interceptors historically could return a context without an
        // effects field. Preserve that JS boundary fallback so the produced DB
        // still reaches the commit interceptor.
        nextEffects = [...(context.effects || []), ...effects];
      }

      return { ...context, effects: nextEffects, newDb };
    },
  };
}

// Install the framework default at module evaluation. User overrides remain
// replaceable, while handler clears restore this baseline.
/** @internal Install the framework event error handler in one runtime. */
export function registerBuiltInErrorHandler(runtime: RuntimeKernel): void {
  registerSystemHandlerForKernel(
    runtime,
    ERROR_HANDLER_KIND,
    EVENT_ERROR_HANDLER_ID,
    defaultErrorHandler,
  );
}
