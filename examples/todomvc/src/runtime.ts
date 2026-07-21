import { createReflexRuntime } from '@flexsurfer/reflex';

import { createTodoDb } from './db';

/** The TodoMVC application explicitly owns its single Reflex runtime. */
export const todoRuntime = createReflexRuntime({
  initialDb: createTodoDb(),
  runtimeId: 'todomvc',
  name: 'TodoMVC',
});

export const dispatch = todoRuntime.dispatch.bind(todoRuntime);
