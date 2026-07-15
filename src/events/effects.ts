import { consoleLog } from '../core/logging';
import { mergeTrace } from '../core/tracing';
import { isEventVector } from '../core/validation';
import { updateAppDb } from '../runtime/app-db';
import { getHandler, registerHandler, registerSystemHandler } from '../runtime/handlers';

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

export const DISPATCH_LATER = 'dispatch-later';
export const DISPATCH = 'dispatch';

/** Register an effect handler. */
export function regEffect<K extends Id = Id>(id: K, handler: EffectHandler<EffectParams<K>>): void {
  registerHandler(HANDLER_KIND, id, handler);
}

/** @internal Commit event state and execute its effects. */
export const doFxInterceptor: Interceptor = {
  id: 'do-fx',
  after(context: Context): Context {
    if (context.newDb !== undefined) {
      updateAppDb(context.newDb);
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
      const handler = getHandler(HANDLER_KIND, id);
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
      mergeTrace({ tags: { effectErrors } });
    }

    return context;
  },
};

/** @internal Register dispatch effects once the router's dispatch function exists. */
export function registerBuiltInEffects(dispatchEvent: (event: DispatchVector) => void): void {
  registerSystemHandler(HANDLER_KIND, DISPATCH_LATER, (value: DispatchLaterEffect) => {
    dispatchLater(value, dispatchEvent);
  });

  registerSystemHandler(HANDLER_KIND, DISPATCH, (value: EventVector) => {
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

function dispatchLater(effect: unknown, dispatchEvent: (event: DispatchVector) => void): void {
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
  setTimeout(() => dispatchEvent(event as DispatchVector), Math.max(0, ms));
}
