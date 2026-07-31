import React, { useState } from 'react';

import { appIds } from '../../../app/reflex/catalog';
import { useRuntime } from '../../../app/reflex/bindings';
import type { Todo } from '../state';
import { TodoInput } from './TodoInput';

interface TodoItemProps {
  todo: Todo;
}

export const TodoItem: React.FC<TodoItemProps> = React.memo(({ todo }) => {
  const runtime = useRuntime();
  const [editing, setEditing] = useState(false);

  const handleSave = (newTitle: string) => {
    if (newTitle.length === 0) {
      runtime.dispatch([appIds.events.todosDelete, todo.id]);
    } else {
      runtime.dispatch([appIds.events.todosSave, todo.id, newTitle]);
    }
    setEditing(false);
  };

  return (
    <li className={`${todo.done ? 'completed ' : ''}${editing ? 'editing' : ''}`}>
      <div className="view">
        <input
          className="toggle"
          type="checkbox"
          checked={todo.done}
          onChange={() => runtime.dispatch([appIds.events.todosToggleDone, todo.id])}
        />
        <label onDoubleClick={() => setEditing(true)}>{todo.title}</label>
        <button
          className="destroy"
          onClick={() => runtime.dispatch([appIds.events.todosDelete, todo.id])}
        />
      </div>
      {editing && (
        <TodoInput
          className="edit"
          title={todo.title}
          onSave={handleSave}
          onStop={() => setEditing(false)}
        />
      )}
    </li>
  );
});
