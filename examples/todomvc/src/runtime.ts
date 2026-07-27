import { createReflexRuntime } from '@flexsurfer/reflex';

import { createTodoState } from './state';

/** The TodoMVC application explicitly owns its single Reflex runtime. */
export const todoRuntime = createReflexRuntime({
  initialState: createTodoState(),
  runtimeId: 'todomvc',
  name: 'TodoMVC',
});

todoRuntime.registerModule((registrar) => {
  registrar.regCoeffect('now', (coeffects) => ({
    ...coeffects,
    now: Date.now(),
  }));
});

export const dispatch = todoRuntime.dispatch.bind(todoRuntime);
