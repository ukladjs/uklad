import { initAppDb } from '@lib/index';

export type TodoId = number;

export interface Todo {
  id: TodoId;
  title: string;
  done: boolean;
}

export type Todos = Map<TodoId, Todo>;

export type Showing = 'all' | 'active' | 'done';

export interface TodoDb {
  todos: Todos;
  showing: Showing;
}

const defaultDb: TodoDb = {
  todos: new Map<TodoId, Todo>(),
  showing: 'all',
};

initAppDb(defaultDb);
