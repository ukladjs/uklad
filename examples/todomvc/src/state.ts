export type TodoId = number;

export interface Todo {
  id: TodoId;
  title: string;
  done: boolean;
}

export type Todos = Map<TodoId, Todo>;

export type Showing = 'all' | 'active' | 'done';

export interface TodoState {
  todos: Todos;
  showing: Showing;
}

export function createTodoState(): TodoState {
  return {
    todos: new Map<TodoId, Todo>(),
    showing: 'all',
  };
}
