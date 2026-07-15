import type {
  EffectHandler,
  EffectParams,
  Context,
  DispatchLaterEffect,
  DispatchVector,
  Id,
  Interceptor,
  EventVector,
  TraceErrorTag,
} from './types';
import { updateAppDb } from './db';
import { getHandler, registerHandler, registerSystemHandler } from './registrar';
import { consoleLog } from './loggers';
import { mergeTrace } from './trace';
import { isEventVector } from './validation';

// -- Registration -------------------------------------------------------

const KIND = 'fx';

// When the app augments EffectPayloads, the handler's value param is checked
// against the declared payload for K (undeclared ids stay `any`).
export function regEffect<K extends Id = Id>(id: K, handler: EffectHandler<EffectParams<K>>): void {
  registerHandler(KIND, id, handler);
}

// -- Interceptor --------------------------------------------------------

export const doFxInterceptor: Interceptor = {
  id: 'do-fx',
  after: (context: Context): Context => {
    // newDb is only set once the event handler interceptor ran; committing an
    // unchanged db is a no-op inside updateAppDb (same reference).
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
      if (!effect) {
        continue;
      }

      if (
        !Array.isArray(effect) ||
        effect.length === 0 ||
        effect.length > 2 ||
        typeof effect[0] !== 'string'
      ) {
        consoleLog('warn', `[reflex] invalid effect in effects:`, effect);
        continue;
      }
      const [key, value] = effect;

      const effectFn = getHandler(KIND, key) as EffectHandler | undefined;
      if (effectFn) {
        try {
          effectFn(value);
        } catch (error: unknown) {
          consoleLog('error', `[reflex] error in effects for ${key}:`, error);
          effectErrors.push({
            phase: 'effect',
            effect: key,
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && typeof error.stack === 'string'
              ? { stack: error.stack }
              : {}),
          });
        }
      } else {
        consoleLog(
          'warn',
          `[reflex] in 'effects' found ${key} which has no associated handler. Ignoring.`,
        );
      }
    }

    // Runs inside the event's withTrace scope, so failed effects land on the
    // event's own trace for devtools/MCP.
    if (effectErrors.length > 0) {
      mergeTrace({ tags: { effectErrors } });
    }

    return context;
  },
};

// -- Constants ---------------------------------------------------------

export const DISPATCH_LATER = 'dispatch-later';
export const DISPATCH = 'dispatch';

// -- Built-in Effect Handlers ------------------------------------------

function dispatchLater(effect: unknown, dispatchEvent: (event: DispatchVector) => void): void {
  if (typeof effect !== 'object' || effect === null) {
    consoleLog('error', '[reflex] ignoring bad dispatch-later value:', effect);
    return;
  }

  const { ms, dispatch: eventToDispatch } = effect as Partial<DispatchLaterEffect>;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || !isEventVector(eventToDispatch)) {
    consoleLog('error', '[reflex] ignoring bad dispatch-later value:', effect);
    return;
  }

  if (ms < 0) {
    consoleLog('warn', '[reflex] dispatch-later effect with negative delay:', ms);
  }
  // Cast: effect payloads are untyped at runtime; DispatchVector only narrows
  // for app code that augments EventPayloads.
  setTimeout(() => dispatchEvent(eventToDispatch as DispatchVector), Math.max(0, ms));
}

/**
 * Register the built-in dispatch effects against the router's dispatch
 * function. Dependency injection here keeps the event pipeline acyclic:
 * events -> effects, while the router composes both after it is initialized.
 */
export function registerBuiltInEffects(dispatchEvent: (event: DispatchVector) => void): void {
  registerSystemHandler(KIND, DISPATCH_LATER, (value: DispatchLaterEffect) => {
    dispatchLater(value, dispatchEvent);
  });

  registerSystemHandler(KIND, DISPATCH, (value: EventVector) => {
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
