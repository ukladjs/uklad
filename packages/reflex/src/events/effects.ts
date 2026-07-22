import { consoleLog } from '../core/logging';
import { mergeTraceForKernel } from '../core/tracing';
import { isEventVector } from '../core/validation';
import { updateStateForKernel } from '../runtime/state';
import { notifyRuntimeLifecycleForKernel } from '../runtime/lifecycle';
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

import type {
  Context,
  DispatchLaterEffect,
  DispatchVector,
  EffectHandler,
  EffectParams,
  EventVector,
  Id,
  Interceptor,
  TraceErrorTag,
} from '../types';

const HANDLER_KIND = 'fx';
const DELAYED_EFFECT_TIMERS =
  createRuntimeStateKey<Set<ReturnType<typeof setTimeout>>>('reflex.delayed-effects');

function getDelayedEffectTimers(runtime: RuntimeKernel): Set<ReturnType<typeof setTimeout>> {
  return getOrCreateRuntimeState(runtime, DELAYED_EFFECT_TIMERS, () => new Set());
}

export const DISPATCH_LATER = 'dispatch-later';
export const DISPATCH = 'dispatch';

/** @internal Register an effect handler in one runtime. */
export function regEffectForKernel<K extends Id = Id>(
  runtime: RuntimeKernel,
  id: K,
  handler: EffectHandler<EffectParams<K>>,
): void {
  registerHandlerForKernel(runtime, HANDLER_KIND, id, handler);
}

const DO_FX_INTERCEPTOR = createRuntimeStateKey<Interceptor>('reflex.do-fx-interceptor');

/** @internal Commit event state and execute its effects. */
export function getDoFxInterceptorForKernel(runtime: RuntimeKernel): Interceptor {
  return getOrCreateRuntimeState(runtime, DO_FX_INTERCEPTOR, () => createDoFxInterceptor(runtime));
}

function createDoFxInterceptor(runtime: RuntimeKernel): Interceptor {
  return {
    id: 'do-fx',
    after(context: Context): Context {
      if (context.newState !== undefined) {
        updateStateForKernel(runtime, context.newState);
      }

      const effects = context.effects;
      if (!Array.isArray(effects)) {
        consoleLog('warn', `[reflex] effects expects a vector, but was given ${typeof effects}`);
        notifyRuntimeLifecycleForKernel(runtime, 'onEffect', {
          type: '<invalid>',
          value: effects,
          status: 'invalid',
          startedAtMs: Date.now(),
        });
        return context;
      }

      notifyRuntimeLifecycleForKernel(runtime, 'onEffects', effects);

      const effectErrors: TraceErrorTag[] = [];
      for (const effect of effects as unknown[]) {
        if (
          !Array.isArray(effect) ||
          effect.length === 0 ||
          effect.length > 2 ||
          typeof effect[0] !== 'string'
        ) {
          consoleLog('warn', '[reflex] invalid effect in effects:', effect);
          notifyRuntimeLifecycleForKernel(runtime, 'onEffect', {
            type: '<invalid>',
            value: effect,
            status: 'invalid',
            startedAtMs: Date.now(),
          });
          continue;
        }

        const [id, value] = effect;
        const handler = getHandlerForKernel(runtime, HANDLER_KIND, id);
        if (!handler) {
          consoleLog(
            'warn',
            `[reflex] in 'effects' found ${id} which has no associated handler. Ignoring.`,
          );
          notifyRuntimeLifecycleForKernel(runtime, 'onEffect', {
            type: id,
            value,
            status: 'unhandled',
            startedAtMs: Date.now(),
          });
          continue;
        }

        const startedAtMs = Date.now();
        try {
          const result = (handler as (effectValue: unknown) => unknown)(value);
          const invalidDispatch =
            (id === DISPATCH && !isEventVector(value)) ||
            (id === DISPATCH_LATER && !isValidDispatchLaterEffect(value));
          notifyRuntimeLifecycleForKernel(runtime, 'onEffect', {
            type: id,
            value,
            status: invalidDispatch
              ? 'failed'
              : id === DISPATCH
                ? 'succeeded'
                : id === DISPATCH_LATER || isThenable(result)
                  ? 'detached'
                  : 'returned',
            startedAtMs,
            ...(invalidDispatch
              ? { error: new Error(`[reflex] Invalid ${id} effect payload.`) }
              : {}),
          });
        } catch (error: unknown) {
          consoleLog('error', `[reflex] error in effects for ${id}:`, error);
          effectErrors.push({
            phase: 'effect',
            effect: id,
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && typeof error.stack === 'string'
              ? { stack: error.stack }
              : {}),
          });
          notifyRuntimeLifecycleForKernel(runtime, 'onEffect', {
            type: id,
            value,
            status: 'failed',
            startedAtMs,
            error,
          });
        }
      }

      if (effectErrors.length > 0) {
        mergeTraceForKernel(runtime, { tags: { effectErrors } });
      }

      return context;
    },
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function isValidDispatchLaterEffect(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const effect = value as Partial<DispatchLaterEffect>;
  return (
    typeof effect.ms === 'number' && Number.isFinite(effect.ms) && isEventVector(effect.dispatch)
  );
}

/** @internal Install dispatch effects in one runtime. */
export function registerBuiltInEffectsForKernel(
  runtime: RuntimeKernel,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  registerSystemHandlerForKernel(
    runtime,
    HANDLER_KIND,
    DISPATCH_LATER,
    (value: DispatchLaterEffect) => {
      dispatchLater(runtime, value, dispatchEvent);
    },
  );

  registerSystemHandlerForKernel(runtime, HANDLER_KIND, DISPATCH, (value: EventVector) => {
    if (!isEventVector(value)) {
      consoleLog(
        'error',
        '[reflex] ignoring bad dispatch value. Expected a vector, but got:',
        value,
      );
      return;
    }
    dispatchEvent(value as DispatchVector);
  });
}

function dispatchLater(
  runtime: RuntimeKernel,
  effect: unknown,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  if (typeof effect !== 'object' || effect === null) {
    consoleLog('error', '[reflex] ignoring bad dispatch-later value:', effect);
    return;
  }

  const { ms, dispatch: event } = effect as Partial<DispatchLaterEffect>;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || !isEventVector(event)) {
    consoleLog('error', '[reflex] ignoring bad dispatch-later value:', effect);
    return;
  }

  if (ms < 0) {
    consoleLog('warn', '[reflex] dispatch-later effect with negative delay:', ms);
  }
  const timers = getDelayedEffectTimers(runtime);
  const timeout = setTimeout(
    () => {
      timers.delete(timeout);
      dispatchEvent(event as DispatchVector);
    },
    Math.max(0, ms),
  );
  timers.add(timeout);
}

/** @internal Cancel delayed dispatch effects owned by one runtime. */
export function clearDelayedEffectsForKernel(runtime: RuntimeKernel): void {
  const timers = getDelayedEffectTimers(runtime);
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}
