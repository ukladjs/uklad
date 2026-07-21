import { consoleLog } from '../core/logging';
import { mergeTraceForRuntime } from '../core/tracing';
import { isEventVector } from '../core/validation';
import { updateAppDbForRuntime } from '../runtime/app-db';
import {
  getHandlerForRuntime,
  registerHandlerForRuntime,
  registerSystemHandlerForRuntime,
} from '../runtime/handlers';
import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  type RuntimeScope,
} from '../runtime/scope';

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

function getDelayedEffectTimers(runtime: RuntimeScope): Set<ReturnType<typeof setTimeout>> {
  return getOrCreateRuntimeState(runtime, DELAYED_EFFECT_TIMERS, () => new Set());
}

export const DISPATCH_LATER = 'dispatch-later';
export const DISPATCH = 'dispatch';

/** @internal Register an effect handler in one runtime. */
export function regEffectForRuntime<K extends Id = Id>(
  runtime: RuntimeScope,
  id: K,
  handler: EffectHandler<EffectParams<K>>,
): void {
  registerHandlerForRuntime(runtime, HANDLER_KIND, id, handler);
}

const DO_FX_INTERCEPTOR = createRuntimeStateKey<Interceptor>('reflex.do-fx-interceptor');

/** @internal Commit event state and execute its effects. */
export function getDoFxInterceptorForRuntime(runtime: RuntimeScope): Interceptor {
  return getOrCreateRuntimeState(runtime, DO_FX_INTERCEPTOR, () => createDoFxInterceptor(runtime));
}

function createDoFxInterceptor(runtime: RuntimeScope): Interceptor {
  return {
    id: 'do-fx',
    after(context: Context): Context {
      if (context.newDb !== undefined) {
        updateAppDbForRuntime(runtime, context.newDb);
      }

      const effects = context.effects;
      if (!Array.isArray(effects)) {
        consoleLog('warn', `[reflex] effects expects a vector, but was given ${typeof effects}`);
        return context;
      }

      const effectErrors: TraceErrorTag[] = [];
      for (const effect of effects as unknown[]) {
        if (!effect) continue;

        if (
          !Array.isArray(effect) ||
          effect.length === 0 ||
          effect.length > 2 ||
          typeof effect[0] !== 'string'
        ) {
          consoleLog('warn', '[reflex] invalid effect in effects:', effect);
          continue;
        }

        const [id, value] = effect;
        const handler = getHandlerForRuntime(runtime, HANDLER_KIND, id);
        if (!handler) {
          consoleLog(
            'warn',
            `[reflex] in 'effects' found ${id} which has no associated handler. Ignoring.`,
          );
          continue;
        }

        try {
          handler(value);
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
        }
      }

      if (effectErrors.length > 0) {
        mergeTraceForRuntime(runtime, { tags: { effectErrors } });
      }

      return context;
    },
  };
}

/** @internal Install dispatch effects in one runtime. */
export function registerBuiltInEffectsForRuntime(
  runtime: RuntimeScope,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  registerSystemHandlerForRuntime(
    runtime,
    HANDLER_KIND,
    DISPATCH_LATER,
    (value: DispatchLaterEffect) => {
      dispatchLater(runtime, value, dispatchEvent);
    },
  );

  registerSystemHandlerForRuntime(runtime, HANDLER_KIND, DISPATCH, (value: EventVector) => {
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
  runtime: RuntimeScope,
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
export function clearDelayedEffectsForRuntime(runtime: RuntimeScope): void {
  const timers = getDelayedEffectTimers(runtime);
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}
