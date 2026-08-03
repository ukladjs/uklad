import React from 'react';

import { appIds } from '../../../app/uklad/catalog';
import { useRuntime, useSubscription } from '../../../app/uklad/bindings';
import { TodoItem } from './TodoItem';

/**
 * Split from `TaskList` on purpose: the list re-renders when the visible todos
 * change, while the toggle-all checkbox re-renders only when completeness does.
 */
const VisibleTodos: React.FC = () => {
  const visibleTodos = useSubscription([appIds.subscriptions.todosVisible], 'VisibleTodos');

  return (
    <ul id="todo-list">
      {visibleTodos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  );
};

export const TaskList: React.FC = () => {
  const runtime = useRuntime();
  const allComplete = useSubscription([appIds.subscriptions.todosAllComplete], 'TaskList');

  return (
    <section id="main">
      <input
        id="toggle-all"
        type="checkbox"
        checked={allComplete}
        onChange={() => runtime.dispatch([appIds.events.todosCompleteAllToggle])}
      />
      <label htmlFor="toggle-all">Mark all as complete</label>
      <VisibleTodos />
    </section>
  );
};
