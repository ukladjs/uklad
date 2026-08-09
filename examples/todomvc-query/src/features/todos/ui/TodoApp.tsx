import React, { useCallback, useState } from 'react';

import { appIds } from '../../../app/uklad/catalog';
import { useRuntime, useSubscription } from '../../../app/uklad/bindings';
import type { Todo, TodoId, TodosShowing } from '../state';
import { TodoInput } from './TodoInput';

/**
 * The view knows only Uklad commands and the feature's clean remote result.
 * QueryClient and TanStack observer lifecycle remain at the platform boundary.
 */
export const TodoApp: React.FC = () => {
  const runtime = useRuntime();
  const query = useSubscription([appIds.subscriptions.todosQuery], 'TodoQuery');
  const visibleTodos = useSubscription([appIds.subscriptions.todosVisible], 'TodoList');
  const allComplete = useSubscription([appIds.subscriptions.todosAllComplete], 'TodoList');
  const [active, done] = useSubscription(
    [appIds.subscriptions.todosFooterCounts],
    'TodoFooter',
  );
  const showing = useSubscription([appIds.subscriptions.todosShowing], 'TodoFooter');

  const addTodo = useCallback(
    (title: string) => runtime.dispatch([appIds.events.todosAdd, title]),
    [runtime],
  );
  const toggleTodo = useCallback(
    (id: TodoId, done: boolean) => runtime.dispatch([appIds.events.todosToggleDone, id, done]),
    [runtime],
  );
  const deleteTodo = useCallback(
    (id: TodoId) => runtime.dispatch([appIds.events.todosDelete, id]),
    [runtime],
  );
  const saveTodo = useCallback(
    (id: TodoId, title: string) => runtime.dispatch([appIds.events.todosSave, id, title]),
    [runtime],
  );
  const toggleAll = useCallback(
    () => runtime.dispatch([appIds.events.todosCompleteAll, !allComplete]),
    [runtime, allComplete],
  );
  const setShowing = useCallback(
    (next: TodosShowing) => runtime.dispatch([appIds.events.todosSetShowing, next]),
    [runtime],
  );
  const clearCompleted = useCallback(
    () => runtime.dispatch([appIds.events.todosClearCompleted]),
    [runtime],
  );
  const refresh = useCallback(
    () => runtime.dispatch([appIds.events.todosRefresh]),
    [runtime],
  );

  return (
    <>
      <section id="todoapp">
        <header id="header">
          <h1>todos</h1>
          <TodoInput
            id="new-todo"
            placeholder="What needs to be done?"
            onSave={(title) => {
              if (title.length > 0) addTodo(title);
            }}
          />
        </header>
        <p className="data-mode">TanStack Query cache · Uklad clean read model and local filter</p>
        {query.kind === 'loading' && <LoadingTodos />}
        {query.kind === 'error' && <QueryError message={query.message} onRetry={refresh} />}
        {query.kind === 'ready' && (
          <>
            <TodoList
              todos={visibleTodos}
              allComplete={allComplete}
              onToggleAll={toggleAll}
              onToggleTodo={toggleTodo}
              onDelete={deleteTodo}
              onSave={saveTodo}
            />
            <TodoFooter
              active={active}
              done={done}
              showing={showing}
              onSetShowing={setShowing}
              onClearCompleted={clearCompleted}
            />
          </>
        )}
      </section>
      <footer id="info">
        <p>Only changed Todo data enters Uklad; filters are derived locally.</p>
        <p>Double-click to edit a todo</p>
      </footer>
    </>
  );
};

interface TodoListProps {
  readonly todos: readonly Todo[];
  readonly allComplete: boolean;
  readonly onToggleAll: () => void;
  readonly onToggleTodo: (id: TodoId, done: boolean) => void;
  readonly onDelete: (id: TodoId) => void;
  readonly onSave: (id: TodoId, title: string) => void;
}

const TodoList: React.FC<TodoListProps> = ({
  todos,
  allComplete,
  onToggleAll,
  onToggleTodo,
  onDelete,
  onSave,
}) => (
  <section id="main">
    <input id="toggle-all" type="checkbox" checked={allComplete} onChange={onToggleAll} />
    <label htmlFor="toggle-all">Mark all as complete</label>
    <ul id="todo-list">
      {todos.map((todo) => (
        <TodoItem
          key={todo.id}
          todo={todo}
          onToggle={onToggleTodo}
          onDelete={onDelete}
          onSave={onSave}
        />
      ))}
    </ul>
  </section>
);

interface TodoItemProps {
  readonly todo: Todo;
  readonly onToggle: (id: TodoId, done: boolean) => void;
  readonly onDelete: (id: TodoId) => void;
  readonly onSave: (id: TodoId, title: string) => void;
}

const TodoItem: React.FC<TodoItemProps> = React.memo(({ todo, onToggle, onDelete, onSave }) => {
  const [editing, setEditing] = useState(false);

  const save = (title: string) => {
    if (title.length === 0) {
      onDelete(todo.id);
    } else {
      onSave(todo.id, title);
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
          onChange={() => onToggle(todo.id, !todo.done)}
        />
        <label onDoubleClick={() => setEditing(true)}>{todo.title}</label>
        <button className="destroy" onClick={() => onDelete(todo.id)} />
      </div>
      {editing && (
        <TodoInput
          className="edit"
          title={todo.title}
          onSave={save}
          onStop={() => setEditing(false)}
        />
      )}
    </li>
  );
});

interface TodoFooterProps {
  readonly active: number;
  readonly done: number;
  readonly showing: TodosShowing;
  readonly onSetShowing: (showing: TodosShowing) => void;
  readonly onClearCompleted: () => void;
}

const TodoFooter: React.FC<TodoFooterProps> = ({
  active,
  done,
  showing,
  onSetShowing,
  onClearCompleted,
}) => {
  const filterLink = (filter: TodosShowing, text: string) => (
    <a
      className={showing === filter ? 'selected' : ''}
      href={`#/${filter}`}
      onClick={(event) => {
        event.preventDefault();
        onSetShowing(filter);
      }}
    >
      {text}
    </a>
  );

  return (
    <footer id="footer">
      <span id="todo-count">
        <strong>{active}</strong> {active === 1 ? 'item' : 'items'} left
      </span>
      <ul id="filters">
        <li>{filterLink('all', 'All')}</li>
        <li>{filterLink('active', 'Active')}</li>
        <li>{filterLink('done', 'Completed')}</li>
      </ul>
      {done > 0 && (
        <button id="clear-completed" onClick={onClearCompleted}>
          Clear completed
        </button>
      )}
    </footer>
  );
};

const LoadingTodos: React.FC = () => (
  <section className="query-status" aria-live="polite">
    Loading remote todos…
  </section>
);

interface QueryErrorProps {
  readonly message: string;
  readonly onRetry: () => void;
}

const QueryError: React.FC<QueryErrorProps> = ({ message, onRetry }) => (
  <section className="query-status query-status-error" role="alert">
    <p>Could not load remote todos: {message}.</p>
    <button type="button" onClick={onRetry}>
      Retry
    </button>
  </section>
);
