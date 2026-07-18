import { consoleLog } from '../core/logging';
import {
  getHandlerForRuntime,
  registerHandlerForRuntime,
  registerSystemHandlerForRuntime,
} from '../runtime/handlers';
import { defaultRuntimeScope, type RuntimeScope } from '../runtime/scope';

import type { CoEffectHandler, CoEffects, Context, Interceptor } from '../types';

const HANDLER_KIND = 'cofx';

export const NOW = 'now';
export const RANDOM = 'random';

/** Register a coeffect handler. */
export function regCoeffect(id: string, handler: CoEffectHandler): void {
  regCoeffectForRuntime(defaultRuntimeScope, id, handler);
}

/** @internal Register a coeffect in one runtime. */
export function regCoeffectForRuntime(
  runtime: RuntimeScope,
  id: string,
  handler: CoEffectHandler,
): void {
  registerHandlerForRuntime(runtime, HANDLER_KIND, id, handler);
}

/** @internal Create an interceptor that injects a registered coeffect. */
export function getInjectCofxInterceptor(id: string): Interceptor;
export function getInjectCofxInterceptor(id: string, value: any): Interceptor;
export function getInjectCofxInterceptor(id: string, value?: any): Interceptor {
  return getInjectCofxInterceptorForRuntime(defaultRuntimeScope, id, value);
}

/** @internal Create a coeffect interceptor bound to one runtime. */
export function getInjectCofxInterceptorForRuntime(
  runtime: RuntimeScope,
  id: string,
  value?: any,
): Interceptor {
  return {
    id: `inject-${id}`,
    before(context: Context): Context {
      const handler = getHandlerForRuntime(runtime, HANDLER_KIND, id);
      if (!handler) {
        consoleLog('error', '[reflex] No cofx handler registered for', id);
        return context;
      }

      try {
        context.coeffects = handler({ ...context.coeffects }, value);
      } catch (error: unknown) {
        consoleLog('error', `[reflex] Error in :${id} coeffect handler:`, error);
      }
      return context;
    },
  };
}

/** @internal Install framework coeffects in one runtime. */
export function registerBuiltInCoeffects(runtime: RuntimeScope): void {
  registerSystemHandlerForRuntime(
    runtime,
    HANDLER_KIND,
    NOW,
    (coeffects: CoEffects): CoEffects => ({
      ...coeffects,
      now: Date.now(),
    }),
  );

  registerSystemHandlerForRuntime(
    runtime,
    HANDLER_KIND,
    RANDOM,
    (coeffects: CoEffects): CoEffects => ({
      ...coeffects,
      random: Math.random(),
    }),
  );
}

// Compatibility APIs can import this module without constructing defaultRuntime.
// Install the default-scope baseline at module evaluation; explicit runtimes are
// initialized by ReflexRuntimeImplementation.
registerBuiltInCoeffects(defaultRuntimeScope);
