import { initAppDb } from '@lib/index';

// -- Types -------------------------------------------------------------------
// The value in appDb should always match these types. TypeScript will help
// ensure type safety at compile time.

export type TodoId = number;

export interface Todo {
  id: TodoId;
  title: string;
  done: boolean;
}

export type Todos = Map<TodoId, Todo>;

export type Showing = 'all' | 'active' | 'done';

export interface DB {
  todos: Todos;
  showing: Showing;
}

// -- Default appDb Value  ---------------------------------------------------
//
// When the application first starts, this will be the value put in appDb

const defaultDB: DB = {
  todos: new Map<TodoId, Todo>(), // an empty map of todos, keyed by id
  showing: 'all', // show all todos
};

initAppDb(defaultDB);
