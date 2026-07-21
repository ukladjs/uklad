import { consoleLog } from '../core/logging';
import {
  getHandlerForKernel,
  registerHandlerForKernel,
  registerSystemHandlerForKernel,
} from '../runtime/handlers';
import { reportRuntimeLifecycleErrorForKernel } from '../runtime/lifecycle';
import type { RuntimeKernel } from '../runtime/kernel';

import type { CoEffectHandler, CoEffects, Context, Interceptor } from '../types';

const HANDLER_KIND = 'cofx';

export const NOW = 'now';
export const RANDOM = 'random';

/** @internal Register a coeffect in one runtime. */
export function regCoeffectForKernel(
  runtime: RuntimeKernel,
  id: string,
  handler: CoEffectHandler,
): void {
  registerHandlerForKernel(runtime, HANDLER_KIND, id, handler);
}

/** @internal Create a coeffect interceptor bound to one runtime. */
export function getInjectCofxInterceptorForKernel(
  runtime: RuntimeKernel,
  id: string,
  value?: any,
): Interceptor {
  return {
    id: `inject-${id}`,
    before(context: Context): Context {
      const handler = getHandlerForKernel(runtime, HANDLER_KIND, id);
      if (!handler) {
        const error = new Error(`[reflex] No cofx handler registered for ${id}`);
        consoleLog('error', '[reflex] No cofx handler registered for', id);
        if (reportRuntimeLifecycleErrorForKernel(runtime, 'missing-coeffect', error)) throw error;
        return context;
      }

      try {
        context.coeffects = handler({ ...context.coeffects }, value);
      } catch (error: unknown) {
        consoleLog('error', `[reflex] Error in :${id} coeffect handler:`, error);
        if (reportRuntimeLifecycleErrorForKernel(runtime, 'coeffect', error)) throw error;
      }
      return context;
    },
  };
}

/** @internal Install framework coeffects in one runtime. */
export function registerBuiltInCoeffects(runtime: RuntimeKernel): void {
  registerSystemHandlerForKernel(runtime, HANDLER_KIND, NOW, (coeffects: CoEffects): CoEffects => ({
    ...coeffects,
    now: Date.now(),
  }));

  registerSystemHandlerForKernel(
    runtime,
    HANDLER_KIND,
    RANDOM,
    (coeffects: CoEffects): CoEffects => ({
      ...coeffects,
      random: Math.random(),
    }),
  );
}
