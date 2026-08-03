import React from 'react';

import { appIds } from '../../../app/uklad/catalog';
import { useRuntime } from '../../../app/uklad/bindings';
import { TodoInput } from './TodoInput';

export const TaskEntry: React.FC = () => {
  const runtime = useRuntime();

  return (
    <header id="header">
      <h1>todos</h1>
      <TodoInput
        id="new-todo"
        placeholder="What needs to be done?"
        onSave={(title) => {
          if (title.length > 0) {
            runtime.dispatch([appIds.events.todosAdd, title]);
          }
        }}
      />
    </header>
  );
};
