import { consoleLog } from '../core/logging';
import { getHandlerForKernel, registerHandlerForKernel } from '../runtime/handlers';
import { reportRuntimeLifecycleErrorForKernel } from '../runtime/lifecycle';
import type { RuntimeKernel } from '../runtime/kernel';

import type { CoEffectHandler, Context, Interceptor } from '../types';

const HANDLER_KIND = 'cofx';

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
