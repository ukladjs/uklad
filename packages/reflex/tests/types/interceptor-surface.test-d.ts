/**
 * Compile-time boundary for the two runtime-wide hooks.
 *
 * `addInterceptor` and `setEventErrorHandler` are deliberately not `reg*`:
 * the `reg*` family installs a handler under an id, whereas these apply to
 * every event regardless of which module installed them. They are
 * administrative capabilities, so the registrar an application receives from
 * `registerModule` must not offer them, and the public interceptor context
 * must not expose the pipeline's own bookkeeping — otherwise the before/after
 * execution model becomes frozen public API.
 */
import { createReflexRuntimeForTests } from '../../src/internal';
import { createReflexRuntime } from '../../src/vanilla';
import type { Interceptor, InterceptorContext } from '../../src/types';

const runtime = createReflexRuntime({ initialState: { count: 0 } });

// ---- application registrar ------------------------------------------

runtime.registerModule((registrar) => {
  registrar.regEvent('bump', ({ draftState }) => {
    draftState.count += 1;
  });
  registrar.regEffect('log', () => {});
  registrar.regCoeffect('now', (coeffects) => coeffects);
  registrar.regRootSub('count', 'count');
});

runtime.registerModule((registrar) => {
  // @ts-expect-error interceptors are administrative, not a registrar method
  registrar.addInterceptor({ id: 'nope', after: (context) => context });
});

runtime.registerModule((registrar) => {
  // @ts-expect-error the event error handler is administrative too
  registrar.setEventErrorHandler(() => {});
});

// @ts-expect-error and neither is reachable on the production runtime
runtime.addInterceptor({ id: 'nope' });

// ---- administrative surface -----------------------------------------

const admin = createReflexRuntimeForTests({ initialState: { count: 0 } });

admin.addInterceptor({
  id: 'audit',
  after: (context) => {
    // The four fields an interceptor legitimately needs.
    const [eventId] = context.coeffects.event;
    void eventId;
    void context.previousState;
    void context.newState;
    context.effects.push(['audit/write', { at: 0 }]);
    return context;
  },
});
admin.setEventErrorHandler(() => {});

// An interceptor outlives the module that added it, so removal is by id.
admin.removeInterceptor('audit');
// @ts-expect-error removal targets one interceptor; there is no clear-all form
admin.removeInterceptor();

// ---- the pipeline's bookkeeping stays internal -----------------------

declare const context: InterceptorContext;
// @ts-expect-error the remaining interceptor queue is not public
void context.queue;
// @ts-expect-error the traversed interceptor stack is not public
void context.stack;
// @ts-expect-error error routing state is not public
void context.originalException;

// Observe-only fields reject assignment. (A hook can still build a fresh
// object with different values — `readonly` constrains assignment, not object
// construction — so the runtime, not the type, is what keeps the effect list
// and state generations authoritative.)
declare const mutable: InterceptorContext;
// @ts-expect-error the shared effect list may be appended to, never replaced
mutable.effects = [];
// @ts-expect-error state generations are observe-only
mutable.previousState = {};
// @ts-expect-error state generations are observe-only
mutable.newState = {};

const appending: Interceptor = {
  id: 'ok',
  after: (ctx) => {
    ctx.effects.push(['audit/write', null]);
    return ctx;
  },
};
void appending;
