import { mergeTraceForRuntime } from '../core/tracing';
import { getHandlerForRuntime } from '../runtime/handlers';
import { defaultRuntimeScope, type RuntimeScope } from '../runtime/scope';

import type {
  CoEffects,
  Context,
  ErrorHandler,
  EventVector,
  Interceptor,
  InterceptorDirection,
  InterceptorErrorData,
  ReflexError,
  TraceErrorTag,
} from '../types';

const ERROR_HANDLER_KIND = 'error';
const EVENT_ERROR_HANDLER_ID = 'event-handler';

/** @internal Check whether a value is a valid interceptor. */
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

/** @internal Execute an event's interceptor chain. */
export function execute(event: EventVector, interceptors: Interceptor[]): Context {
  return executeForRuntime(defaultRuntimeScope, event, interceptors);
}

/** @internal Execute an event interceptor chain in one runtime. */
export function executeForRuntime(
  runtime: RuntimeScope,
  event: EventVector,
  interceptors: Interceptor[],
): Context {
  const context = createContext(event, interceptors);
  const errorHandler: ErrorHandler | undefined = getHandlerForRuntime(
    runtime,
    ERROR_HANDLER_KIND,
    EVENT_ERROR_HANDLER_ID,
  );

  if (!errorHandler) {
    try {
      return executeInterceptors({ ...context, originalException: true });
    } catch (error: unknown) {
      traceError(runtime, error, event);
      throw error;
    }
  }

  try {
    return executeInterceptors(context);
  } catch (error: unknown) {
    const reflexError = mergeErrorData(
      isReflexError(error) ? error : toReflexError(error, { id: 'unknown-interceptor' }, 'before'),
      { eventV: event },
    );
    traceError(runtime, reflexError, event);
    errorHandler(reflexError.cause, reflexError);
    return context;
  }
}

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

function traceError(runtime: RuntimeScope, value: unknown, event: EventVector): void {
  const reflexError = isReflexError(value) ? value : undefined;
  const originalError = reflexError?.cause ?? normalizeError(value);
  const traceErrorTag: TraceErrorTag = {
    phase: 'handler',
    message: originalError.message,
    ...(typeof originalError.stack === 'string' ? { stack: originalError.stack } : {}),
    ...(reflexError ? { interceptor: reflexError.data.interceptor } : {}),
    ...(reflexError ? { direction: reflexError.data.direction } : {}),
    eventV: event,
  };
  mergeTraceForRuntime(runtime, { tags: { error: traceErrorTag } });
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

function invokeInterceptor(
  context: Context,
  interceptor: Interceptor,
  direction: InterceptorDirection,
): Context {
  const interceptorFunction = interceptor[direction];
  if (!interceptorFunction) return context;

  if (context.originalException) {
    return interceptorFunction(context);
  }

  try {
    return interceptorFunction(context);
  } catch (error: unknown) {
    throw toReflexError(error, interceptor, direction);
  }
}

function invokeInterceptors(context: Context, direction: InterceptorDirection): Context {
  let nextContext = { ...context };

  while (nextContext.queue.length > 0) {
    const interceptor = nextContext.queue[0]!;
    const remainingInterceptors = nextContext.queue.slice(1);

    nextContext = invokeInterceptor(
      {
        ...nextContext,
        queue: remainingInterceptors,
        stack: direction === 'before' ? [...nextContext.stack, interceptor] : nextContext.stack,
      },
      interceptor,
      direction,
    );
  }

  return nextContext;
}

function changeDirection(context: Context): Context {
  return {
    ...context,
    queue: [...context.stack].reverse(),
    stack: [],
  };
}

function createContext(event: EventVector, interceptors: Interceptor[]): Context {
  const coeffects: CoEffects<Record<string, any>> = {
    event,
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

function executeInterceptors(context: Context): Context {
  const afterBeforePhase = invokeInterceptors(context, 'before');
  return invokeInterceptors(changeDirection(afterBeforePhase), 'after');
}
