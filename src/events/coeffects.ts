import { consoleLog } from '../core/logging';
import { getHandler, registerHandler, registerSystemHandler } from '../runtime/handlers';

import type { CoEffectHandler, CoEffects, Context, Interceptor } from '../types';

const HANDLER_KIND = 'cofx';

export const NOW = 'now';
export const RANDOM = 'random';

/** Register a coeffect handler. */
export function regCoeffect(id: string, handler: CoEffectHandler): void {
  registerHandler(HANDLER_KIND, id, handler);
}

/** @internal Create an interceptor that injects a registered coeffect. */
export function getInjectCofxInterceptor(id: string): Interceptor;
export function getInjectCofxInterceptor(id: string, value: any): Interceptor;
export function getInjectCofxInterceptor(id: string, value?: any): Interceptor {
  return {
    id: `inject-${id}`,
    before(context: Context): Context {
      const handler = getHandler(HANDLER_KIND, id);
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

// Install framework-owned coeffects at module evaluation; handler clears
// restore these baseline implementations.
registerSystemHandler(HANDLER_KIND, NOW, (coeffects: CoEffects): CoEffects => ({
  ...coeffects,
  now: Date.now(),
}));

registerSystemHandler(HANDLER_KIND, RANDOM, (coeffects: CoEffects): CoEffects => ({
  ...coeffects,
  random: Math.random(),
}));
