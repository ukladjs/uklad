import type {
  EventVector,
  Interceptor,
  Context,
  CoEffects,
  ErrorHandler,
  InterceptorDirection,
  InterceptorErrorData,
  ReflexError,
  TraceErrorTag,
} from './types';

import { getHandler } from './registrar';
import { mergeTrace } from './trace';

/**
 * Attach a JSON-serializable description of an interceptor/handler exception
 * to the current event trace, so devtools/MCP can report why the event
 * failed. `e` may be the wrapped reflex error (with `.data`/`.cause`) or a
 * raw error from the no-error-handler path.
 */
function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;
  try {
    return new Error(String(value));
  } catch {
    return new Error('[Unprintable error]');
  }
}

function isReflexError(value: unknown): value is ReflexError {
  if (!(value instanceof Error) || typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ReflexError>;
  return candidate.cause instanceof Error && typeof candidate.data === 'object';
}

function traceError(value: unknown, eventV: EventVector): void {
  const reflexError = isReflexError(value) ? value : undefined;
  const original = reflexError?.cause ?? normalizeError(value);
  const error: TraceErrorTag = {
    phase: 'handler',
    message: original.message,
    ...(typeof original.stack === 'string' ? { stack: original.stack } : {}),
    ...(reflexError ? { interceptor: reflexError.data.interceptor } : {}),
    ...(reflexError ? { direction: reflexError.data.direction } : {}),
    eventV,
  };
  mergeTrace({ tags: { error } });
}

export function isInterceptor(value: unknown): value is Interceptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const hasBefore = typeof candidate.before === 'function';
  const hasAfter = typeof candidate.after === 'function';
  return (
    typeof candidate.id === 'string' &&
    (hasBefore || hasAfter) &&
    (candidate.before === undefined || hasBefore) &&
    (candidate.after === undefined || hasAfter)
  );
}

function toReflexError(
  value: unknown,
  interceptor: Interceptor,
  direction: InterceptorDirection,
): ReflexError {
  const originalError = normalizeError(value);
  return Object.assign(new Error(`Interceptor Exception: ${originalError.message}`), {
    data: { direction, interceptor: interceptor.id, originalError },
    cause: originalError,
  });
}

function mergeErrorData(error: ReflexError, data: Partial<InterceptorErrorData>): ReflexError {
  return Object.assign(new Error(error.message), {
    data: { ...error.data, ...data },
    cause: error.cause,
  });
}

function invokeInterceptorFn(
  context: Context,
  interceptor: Interceptor,
  direction: InterceptorDirection,
): Context {
  const fn = interceptor[direction];
  if (!fn) return context;

  if (context.originalException) {
    return fn(context);
  }

  try {
    return fn(context);
  } catch (error: unknown) {
    throw toReflexError(error, interceptor, direction);
  }
}

function invokeInterceptors(context: Context, direction: InterceptorDirection): Context {
  let ctx = { ...context };

  // For both before and after, we process from the queue
  // Before: queue contains interceptors to process, stack is where we accumulate processed interceptors
  // After: queue contains reversed interceptors to process, stack is unused
  while (ctx.queue.length > 0) {
    const next = ctx.queue[0]!;
    const rest = ctx.queue.slice(1);

    ctx = invokeInterceptorFn(
      {
        ...ctx,
        queue: rest,
        stack: direction === 'before' ? [...ctx.stack, next] : ctx.stack,
      },
      next,
      direction,
    );
  }

  return ctx;
}

function changeDirection(context: Context): Context {
  return {
    ...context,
    queue: [...context.stack].reverse(),
    stack: [],
  };
}

function createContext(eventV: EventVector, interceptors: Interceptor[]): Context {
  // Db-shape agnostic: the real draft is injected by eventHandlerInterceptor,
  // so this placeholder must not be typed against an augmented AppDb.
  const coeffects: CoEffects<Record<string, any>> = {
    event: eventV,
    draftDb: {},
  };

  return {
    coeffects,
    effects: [],
    queue: [...interceptors],
    stack: [],
    originalException: false,
  };
}

function executeInterceptors(ctx: Context): Context {
  const ctxAfterBeforePhase = invokeInterceptors(ctx, 'before');
  const ctxChangedDirection = changeDirection(ctxAfterBeforePhase);
  return invokeInterceptors(ctxChangedDirection, 'after');
}

/**
 * Execute interceptor chain with given event and interceptors
 */
export function execute(eventV: EventVector, interceptors: Interceptor[]): Context {
  const ctx = createContext(eventV, interceptors);
  const errorHandler: ErrorHandler | undefined = getHandler('error', 'event-handler');
  if (!errorHandler) {
    try {
      return executeInterceptors({ ...ctx, originalException: true });
    } catch (error: unknown) {
      traceError(error, eventV);
      throw error;
    }
  }
  try {
    return executeInterceptors(ctx);
  } catch (error: unknown) {
    const reflexError = mergeErrorData(
      isReflexError(error) ? error : toReflexError(error, { id: 'unknown-interceptor' }, 'before'),
      { eventV },
    );
    traceError(reflexError, eventV);
    errorHandler(reflexError.cause, reflexError);
    return ctx; // Return original context if error handler doesn't throw
  }
}
