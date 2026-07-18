import { produce, produceWithPatches, type Draft } from 'immer';

import { IS_DEV } from '../core/environment';
import { ensurePatchesEnabled } from '../core/immer';
import { consoleLog } from '../core/logging';
import {
  isTraceEnabledForRuntime,
  mergeTraceForRuntime,
  withTraceForRuntime,
} from '../core/tracing';
import { getAppDbForRuntime } from '../runtime/app-db';
import { getInterceptorsForRuntime } from '../runtime/event-metadata';
import {
  getHandlerForRuntime,
  registerHandlerForRuntime,
  registerSystemHandlerForRuntime,
} from '../runtime/handlers';
import { defaultRuntimeScope, type RuntimeScope } from '../runtime/scope';
import { getDoFxInterceptorForRuntime } from './effects';
import { getGlobalInterceptorsForRuntime } from './global-interceptors';
import { executeForRuntime } from './interceptors';

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

const pipelineStates = new WeakMap<RuntimeScope, PipelineState>();

function getPipelineState(runtime: RuntimeScope): PipelineState {
  let state = pipelineStates.get(runtime);
  if (!state) {
    state = { handlingEventId: null, runningHandlerEventId: null };
    pipelineStates.set(runtime, state);
  }
  return state;
}

/** @internal Return the event whose interceptor chain is executing. */
export function getHandlingEventId(): Id | null {
  return getHandlingEventIdForRuntime(defaultRuntimeScope);
}

/** @internal Return the event being handled by one runtime. */
export function getHandlingEventIdForRuntime(runtime: RuntimeScope): Id | null {
  return getPipelineState(runtime).handlingEventId;
}

/** @internal Return the event whose pure handler is executing. */
export function getRunningHandlerEventId(): Id | null {
  return getRunningHandlerEventIdForRuntime(defaultRuntimeScope);
}

/** @internal Return the pure handler currently running in one runtime. */
export function getRunningHandlerEventIdForRuntime(runtime: RuntimeScope): Id | null {
  return getPipelineState(runtime).runningHandlerEventId;
}

/** Register the handler for unhandled event-pipeline exceptions. */
export function regEventErrorHandler(handler: ErrorHandler): void {
  regEventErrorHandlerForRuntime(defaultRuntimeScope, handler);
}

/** @internal Register one runtime's event-pipeline error handler. */
export function regEventErrorHandlerForRuntime(runtime: RuntimeScope, handler: ErrorHandler): void {
  registerHandlerForRuntime(runtime, ERROR_HANDLER_KIND, EVENT_ERROR_HANDLER_ID, handler);
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

/** @internal Run a registered event through its interceptor pipeline. */
export function handle(event: EventVector): void {
  handleForRuntime(defaultRuntimeScope, event);
}

/** @internal Run a registered event through one runtime's pipeline. */
export function handleForRuntime(runtime: RuntimeScope, event: EventVector): void {
  const eventId = event[0];
  const handler = getHandlerForRuntime(runtime, HANDLER_KIND, eventId);

  if (!handler) {
    consoleLog('error', '[reflex] no event handler registered for:', eventId);
    const error: TraceErrorTag = {
      phase: 'missing-handler',
      message: `no event handler registered for: ${eventId}`,
      eventV: event,
    };
    withTraceForRuntime(
      runtime,
      { operation: eventId, opType: HANDLER_KIND, tags: { event, error } },
      () => {},
    );
    return;
  }

  const interceptors = [
    getDoFxInterceptorForRuntime(runtime),
    getInjectGlobalInterceptorsForRuntime(runtime),
    ...getInterceptorsForRuntime(runtime, eventId),
    createEventHandlerInterceptor(runtime, handler),
  ];

  const state = getPipelineState(runtime);
  state.handlingEventId = eventId;
  try {
    withTraceForRuntime(
      runtime,
      { operation: eventId, opType: HANDLER_KIND, tags: { event } },
      () => {
        executeForRuntime(runtime, event, interceptors);
      },
    );
  } finally {
    state.handlingEventId = null;
  }
}

const injectGlobalInterceptorsByRuntime = new WeakMap<RuntimeScope, Interceptor>();

/** @internal Inject the current global interceptors into an event pipeline. */
export function getInjectGlobalInterceptorsForRuntime(runtime: RuntimeScope): Interceptor {
  let interceptor = injectGlobalInterceptorsByRuntime.get(runtime);
  if (!interceptor) {
    interceptor = {
      id: 'inject-global-interceptors',
      before(context) {
        context.queue = [...getGlobalInterceptorsForRuntime(runtime), ...context.queue];
        return context;
      },
    };
    injectGlobalInterceptorsByRuntime.set(runtime, interceptor);
  }
  return interceptor;
}

export const injectGlobalInterceptors: Interceptor =
  getInjectGlobalInterceptorsForRuntime(defaultRuntimeScope);

function createEventHandlerInterceptor(
  runtime: RuntimeScope,
  handler: EventHandler<any>,
): Interceptor {
  return {
    id: 'fx-handler',
    before(context: Context) {
      const event = context.coeffects.event;
      const params = event.slice(1);
      let effects: Effects = [];

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

      if (isTraceEnabledForRuntime(runtime)) {
        ensurePatchesEnabled();
        const [newDb, patches, reversePatches] = produceWithPatches(
          getAppDbForRuntime<Db>(runtime),
          recipe,
        );
        context.newDb = newDb;
        mergeTraceForRuntime(runtime, { tags: { patches, reversePatches, effects } });
      } else {
        context.newDb = produce(getAppDbForRuntime<Db>(runtime), recipe);
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

      if (!Array.isArray(effects)) {
        consoleLog('warn', `[reflex] effects expects a vector, but was given ${typeof effects}`);
      } else {
        // Untyped interceptors historically could return a context without an
        // effects field. Preserve that JS boundary fallback so the produced DB
        // still reaches the commit interceptor.
        context.effects = [...(context.effects || []), ...effects];
      }

      return context;
    },
  };
}

// Install the framework default at module evaluation. User overrides remain
// replaceable, while handler clears restore this baseline.
/** @internal Install the framework event error handler in one runtime. */
export function registerBuiltInErrorHandler(runtime: RuntimeScope): void {
  registerSystemHandlerForRuntime(
    runtime,
    ERROR_HANDLER_KIND,
    EVENT_ERROR_HANDLER_ID,
    defaultErrorHandler,
  );
}

// Compatibility APIs can import this module without constructing defaultRuntime.
// Install the default-scope baseline at module evaluation; explicit runtimes are
// initialized by ReflexRuntimeImplementation.
registerBuiltInErrorHandler(defaultRuntimeScope);
