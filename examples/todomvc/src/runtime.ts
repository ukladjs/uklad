// Import from the subpath entrypoints: each entrypoint emits its own copy of
// the runtime types, so a runtime created through the package root cannot be
// inferred by packages (such as reflex-persist) that type against `/vanilla`.
import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import { createReflexHooks } from '@flexsurfer/reflex/react';

import type { TodoContracts } from './contracts';
import { createTodoState } from './state';

/** The TodoMVC application explicitly owns its single Reflex runtime. */
export const todoRuntime = createReflexRuntime<TodoContracts>({
  initialState: createTodoState(),
  runtimeId: 'todomvc',
  name: 'TodoMVC',
});

/**
 * Bindings for this runtime's contract, so views need no inline generics.
 *
 * The provider ships with the hooks rather than coming from the package, which
 * is what makes the pairing checkable: it accepts only a runtime built for
 * `TodoContracts`, so the hooks' inferred results cannot drift from the runtime
 * that actually serves them.
 */
export const { ReflexProvider, useSubscription } = createReflexHooks<TodoContracts>();

todoRuntime.registerModule((registrar) => {
  registrar.regCoeffect('now', (coeffects) => ({
    ...coeffects,
    now: Date.now(),
  }));
});

export const dispatch = todoRuntime.dispatch.bind(todoRuntime);
