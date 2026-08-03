/** Interceptor validation and before/after chain execution. */
import { mergeRuntimeProbeSpan, notifyRuntimeProbe } from '../runtime/probe';
import type { RuntimeCore } from '../runtime/core';

import type {
  CoEffects,
  Context,
  InterceptorContext,
  State,
  ErrorHandler,
  EventVector,
  Interceptor,
  InterceptorDirection,
  InterceptorErrorData,
  UkladError,
} from '../types';
import type { TraceErrorTag } from '../core/tracing-types';

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

/** @internal Execute an event interceptor chain in one runtime. */
export function execute(
  runtime: RuntimeCore,
  event: EventVector,
  interceptors: Interceptor[],
): Context {
  const context = createContext(runtime, event, interceptors, runtime.state.get<State>());
  const errorHandler: ErrorHandler | undefined = runtime.registry.error.get('event-handler');

  if (!errorHandler) {
    try {
      return executeAndTraceFinalEffects(runtime, { ...context, originalException: true });
    } catch (error: unknown) {
      traceError(runtime, error, event);
      throw error;
    }
  }

  try {
    return executeAndTraceFinalEffects(runtime, context);
  } catch (error: unknown) {
    const ukladError = mergeErrorData(
      isUkladError(error) ? error : toUkladError(error, { id: 'unknown-interceptor' }, 'before'),
      { eventV: event },
    );
    traceError(runtime, ukladError, event);
    errorHandler(ukladError.cause, ukladError);
    return { ...context, executionError: ukladError.cause };
  }
}

function executeAndTraceFinalEffects(runtime: RuntimeCore, context: Context): Context {
  const result = executeInterceptors(context);
  // Event handlers publish their initial effects while patches are produced,
  // but `after` interceptors may append or replace effects later in the same
  // pipeline. Record the final list so traces describe what the post-commit
  // effect executor receives.
  mergeRuntimeProbeSpan(runtime, () => ({ effects: result.effects }));
  return result;
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;

  try {
    return new Error(String(value));
  } catch {
    return new Error('[Unprintable error]');
  }
}

function isUkladError(value: unknown): value is UkladError {
  if (!(value instanceof Error) || typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<UkladError>;
  return candidate.cause instanceof Error && typeof candidate.data === 'object';
}

function traceError(runtime: RuntimeCore, value: unknown, event: EventVector): void {
  const ukladError = isUkladError(value) ? value : undefined;
  const originalError = ukladError?.cause ?? normalizeError(value);
  const traceErrorTag: TraceErrorTag = {
    phase: 'handler',
    message: originalError.message,
    ...(typeof originalError.stack === 'string' ? { stack: originalError.stack } : {}),
    ...(ukladError ? { interceptor: ukladError.data.interceptor } : {}),
    ...(ukladError ? { direction: ukladError.data.direction } : {}),
    eventV: event,
  };
  mergeRuntimeProbeSpan(runtime, () => ({ error: traceErrorTag }));
  notifyRuntimeProbe(runtime, 'error', 'handler', originalError);
}

function toUkladError(
  value: unknown,
  interceptor: Interceptor,
  direction: InterceptorDirection,
): UkladError {
  const originalError = normalizeError(value);
  return Object.assign(new Error(`Interceptor Exception: ${originalError.message}`), {
    data: { direction, interceptor: interceptor.id, originalError },
    cause: originalError,
  });
}

function mergeErrorData(error: UkladError, data: Partial<InterceptorErrorData>): UkladError {
  return Object.assign(new Error(error.message), {
    data: { ...error.data, ...data },
    cause: error.cause,
  });
}

/**
 * An extension sees only `InterceptorContext`, so a hook that rebuilds the
 * object it was handed can legitimately return one without the pipeline's
 * bookkeeping. Restore it rather than losing the traversal.
 */
function restorePipelineState(context: Context, result: InterceptorContext): Context {
  const returned = result as Context;
  if (returned === context) return context;
  if (returned.queue !== undefined && returned.stack !== undefined) return returned;
  return {
    ...context,
    ...returned,
    queue: returned.queue ?? context.queue,
    stack: returned.stack ?? context.stack,
  };
}

function invokeInterceptor(
  context: Context,
  interceptor: Interceptor,
  direction: InterceptorDirection,
): Context {
  const interceptorFunction = interceptor[direction];
  if (!interceptorFunction) return context;

  if (context.originalException) {
    return restorePipelineState(context, interceptorFunction(context));
  }

  try {
    return restorePipelineState(context, interceptorFunction(context));
  } catch (error: unknown) {
    throw toUkladError(error, interceptor, direction);
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

function createContext(
  runtime: RuntimeCore,
  event: EventVector,
  interceptors: Interceptor[],
  previousState: State,
): Context {
  const coeffects: CoEffects<Record<string, any>> = {
    event,
    draftState: {},
  };

  // Global interceptors are resolved here rather than baked into the event's
  // chain, because they can be added or removed after the event was
  // registered. Composing them directly saves the chain an injector entry,
  // which every event would otherwise pay for in both phases.
  const globalInterceptors = runtime.events.hasGlobalInterceptors
    ? runtime.events.getInterceptors()
    : undefined;

  return {
    coeffects,
    previousState,
    effects: [],
    invalidEffects: [],
    queue: globalInterceptors ? [...globalInterceptors, ...interceptors] : [...interceptors],
    stack: [],
    originalException: false,
  };
}

function executeInterceptors(context: Context): Context {
  const afterBeforePhase = invokeInterceptors(context, 'before');
  return invokeInterceptors(changeDirection(afterBeforePhase), 'after');
}
