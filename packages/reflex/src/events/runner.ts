import { produce, produceWithPatches, type Draft } from 'immer';

import { IS_DEV } from '../core/environment';
import { ensurePatchesEnabled } from '../core/immer';
import { consoleLog } from '../core/logging';
import { isTraceEnabledForKernel, mergeOptionalTraceForKernel } from '../core/tracing';
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
  hasRuntimeLifecycleObservers,
  notifyRuntimeLifecycleForKernel,
} from '../runtime/lifecycle';
import { getStateForKernel } from '../runtime/state';
import { getGlobalInterceptorsForKernel } from './global-interceptors';
import { executeForKernel } from './interceptors';

import type { ExecutionEnvelope } from './envelope';

import type {
  Context,
  State,
  ErrorHandler,
  Effects,
  EventHandler,
  EventVector,
  Id,
  Interceptor,
  ReflexError,
} from '../types';

const HANDLER_KIND = 'event';
const ERROR_HANDLER_KIND = 'error';
const EVENT_ERROR_HANDLER_ID = 'event-handler';

interface PipelineState {
  handlingEventId: Id | null;
  handlingEnvelope: ExecutionEnvelope | null;
  runningHandlerEventId: Id | null;
}

/** The result exposed by the event runner, not by the interceptor pipeline. */
export interface EventRunResult {
  readonly status: 'completed' | 'missing-handler' | 'aborted';
  readonly previousState: unknown;
  readonly candidateState?: unknown;
  readonly effects: readonly unknown[];
  readonly invalidEffects: readonly unknown[];
  readonly error?: unknown;
}

const PIPELINE_STATE = createRuntimeStateKey<PipelineState>('reflex.pipeline');

function getPipelineState(runtime: RuntimeKernel): PipelineState {
  return getOrCreateRuntimeState(runtime, PIPELINE_STATE, () => ({
    handlingEventId: null,
    handlingEnvelope: null,
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

/** @internal Mark the complete event execution (runner, commit, effects) as active. */
export function beginHandlingEventForKernel(
  runtime: RuntimeKernel,
  envelope: ExecutionEnvelope,
): void {
  const state = getPipelineState(runtime);
  state.handlingEventId = envelope.event[0];
  state.handlingEnvelope = envelope;
}

/** @internal Clear the event-execution guard after effects have completed. */
export function endHandlingEventForKernel(runtime: RuntimeKernel): void {
  const state = getPipelineState(runtime);
  state.handlingEventId = null;
  state.handlingEnvelope = null;
}

/** @internal Return the event occurrence synchronously owning the execution lane. */
export function getHandlingEnvelopeForKernel(runtime: RuntimeKernel): ExecutionEnvelope | null {
  return getPipelineState(runtime).handlingEnvelope;
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

/**
 * Run an event through interceptors and its handler without committing state or
 * invoking effects. `Context` is confined to this component.
 */
export function runEventForKernel(runtime: RuntimeKernel, event: EventVector): EventRunResult {
  const previousState = getStateForKernel<State>(runtime);
  const eventId = event[0];
  const handler = getHandlerForKernel(runtime, HANDLER_KIND, eventId);
  if (!handler) {
    return Object.freeze({
      status: 'missing-handler' as const,
      previousState,
      effects: Object.freeze([]),
      invalidEffects: Object.freeze([]),
    });
  }

  const interceptors = [
    getInjectGlobalInterceptorsForKernel(runtime),
    ...getInterceptorsForKernel(runtime, eventId),
    createEventHandlerInterceptor(runtime, handler),
  ];

  const context = executeForKernel(runtime, event, interceptors);
  const finalEffects = Array.isArray(context.effects) ? context.effects : [];
  const invalidEffects = [
    ...(context.invalidEffects ?? []),
    ...(Array.isArray(context.effects) ? [] : [context.effects]),
  ];
  return Object.freeze({
    status: context.newState === undefined ? ('aborted' as const) : ('completed' as const),
    previousState: context.previousState,
    ...(context.newState === undefined ? {} : { candidateState: context.newState }),
    effects: Object.freeze([...finalEffects]),
    invalidEffects: Object.freeze(invalidEffects),
    ...(context.executionError === undefined ? {} : { error: context.executionError }),
  });
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
      let newState: State;

      const recipe = (draftState: Draft<State>) => {
        const coeffects = { ...context.coeffects, draftState };
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
        const [producedState, patches, reversePatches] = produceWithPatches(
          context.previousState as State,
          recipe,
        );
        newState = producedState;
        notifyRuntimeLifecycleForKernel(runtime, 'onStatePlanned', {
          previousState: context.previousState,
          plannedState: producedState,
          patches,
        });
        if (tracingEnabled)
          mergeOptionalTraceForKernel(runtime, () => ({ patches, reversePatches, effects }));
      } else {
        newState = produce(context.previousState as State, recipe);
      }

      if (IS_DEV) {
        try {
          JSON.stringify(effects);
        } catch {
          consoleLog(
            'warn',
            `[reflex] Effects ${effects} contain Proxy (probably an Immer draft). Use current() for draftState values.`,
          );
        }
      }

      if (!Array.isArray(effects)) {
        return {
          ...context,
          invalidEffects: [...(context.invalidEffects ?? []), effects],
          newState,
        };
      }

      const nextEffects = [...(context.effects || []), ...effects];
      return { ...context, effects: nextEffects, newState };
    },
  };
}

/** @internal Install the framework event error handler in one runtime. */
export function registerBuiltInErrorHandler(runtime: RuntimeKernel): void {
  registerSystemHandlerForKernel(
    runtime,
    ERROR_HANDLER_KIND,
    EVENT_ERROR_HANDLER_ID,
    defaultErrorHandler,
  );
}
