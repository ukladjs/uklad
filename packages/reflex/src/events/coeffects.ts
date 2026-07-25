import { consoleLog } from '../core/logging';
import { notifyRuntimeProbe } from '../runtime/probe';
import type { RuntimeCore } from '../runtime/core';

import type { Context, Interceptor } from '../types';

/** @internal Create a coeffect interceptor bound to one runtime. */
export function getInjectCofxInterceptor(
  runtime: RuntimeCore,
  id: string,
  value?: any,
): Interceptor {
  return {
    id: `inject-${id}`,
    before(context: Context): Context {
      const handler = runtime.registry.get('cofx', id);
      if (!handler) {
        const error = new Error(`[reflex] No cofx handler registered for ${id}`);
        consoleLog('error', '[reflex] No cofx handler registered for', id);
        notifyRuntimeProbe(runtime, 'error', 'missing-coeffect', error);
        return context;
      }

      try {
        context.coeffects = handler({ ...context.coeffects }, value);
      } catch (error: unknown) {
        consoleLog('error', `[reflex] Error in :${id} coeffect handler:`, error);
        notifyRuntimeProbe(runtime, 'error', 'coeffect', error);
      }
      return context;
    },
  };
}
