import { produce, produceWithPatches, type Draft } from 'immer';

import { IS_DEV } from '../core/environment';
import { ensurePatchesEnabled } from '../core/immer';
import { consoleLog } from '../core/logging';
import { isTraceEnabled, mergeTrace, withTrace } from '../core/tracing';
import { getAppDb } from '../runtime/app-db';
import { getInterceptors } from '../runtime/event-metadata';
import { getHandler, registerHandler, registerSystemHandler } from '../runtime/handlers';
import { doFxInterceptor } from './effects';
import { getGlobalInterceptors } from './global-interceptors';
import { execute } from './interceptors';

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

let handlingEventId: Id | null = null;
let runningHandlerEventId: Id | null = null;

/** @internal Return the event whose interceptor chain is executing. */
export function getHandlingEventId(): Id | null {
  return handlingEventId;
}

/** @internal Return the event whose pure handler is executing. */
export function getRunningHandlerEventId(): Id | null {
  return runningHandlerEventId;
}

/** Register the handler for unhandled event-pipeline exceptions. */
export function regEventErrorHandler(handler: ErrorHandler): void {
  registerHandler(ERROR_HANDLER_KIND, EVENT_ERROR_HANDLER_ID, handler);
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
  const eventId = event[0];
  const handler = getHandler(HANDLER_KIND, eventId);

  if (!handler) {
    consoleLog('error', '[reflex] no event handler registered for:', eventId);
    const error: TraceErrorTag = {
      phase: 'missing-handler',
      message: `no event handler registered for: ${eventId}`,
      eventV: event,
    };
    withTrace({ operation: eventId, opType: HANDLER_KIND, tags: { event, error } }, () => {});
    return;
  }

  const interceptors = [
    doFxInterceptor,
    injectGlobalInterceptors,
    ...getInterceptors(eventId),
    createEventHandlerInterceptor(handler),
  ];

  handlingEventId = eventId;
  try {
    withTrace({ operation: eventId, opType: HANDLER_KIND, tags: { event } }, () => {
      execute(event, interceptors);
    });
  } finally {
    handlingEventId = null;
  }
}

/** @internal Inject the current global interceptors into an event pipeline. */
export const injectGlobalInterceptors: Interceptor = {
  id: 'inject-global-interceptors',
  before(context) {
    context.queue = [...getGlobalInterceptors(), ...context.queue];
    return context;
  },
};

function createEventHandlerInterceptor(handler: EventHandler<any>): Interceptor {
  return {
    id: 'fx-handler',
    before(context: Context) {
      const event = context.coeffects.event;
      const params = event.slice(1);
      let effects: Effects = [];

      const recipe = (draftDb: Draft<Db>) => {
        const coeffects = { ...context.coeffects, draftDb };
        runningHandlerEventId = event[0];
        try {
          effects = handler(coeffects, ...params) ?? [];
        } finally {
          runningHandlerEventId = null;
        }
      };

      if (isTraceEnabled()) {
        ensurePatchesEnabled();
        const [newDb, patches, reversePatches] = produceWithPatches(getAppDb<Db>(), recipe);
        context.newDb = newDb;
        mergeTrace({ tags: { patches, reversePatches, effects } });
      } else {
        context.newDb = produce(getAppDb<Db>(), recipe);
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
registerSystemHandler(ERROR_HANDLER_KIND, EVENT_ERROR_HANDLER_ID, defaultErrorHandler);
