import type { Todo, TodoId, UpdateTodoRequest } from '../../features/todos/state';

export interface TodosApi {
  list(): Promise<readonly Todo[]>;
  create(title: string): Promise<Todo>;
  update(id: TodoId, patch: UpdateTodoRequest): Promise<Todo>;
  remove(id: TodoId): Promise<void>;
  completeAll(done: boolean): Promise<void>;
  clearCompleted(): Promise<void>;
}

/** Browser boundary for the local API started by `pnpm dev`. */
export const todosApi: TodosApi = {
  async list(): Promise<readonly Todo[]> {
    return parseTodos(await request('/api/todos'));
  },
  async create(title: string): Promise<Todo> {
    return parseTodo(await request('/api/todos', jsonRequest('POST', { title })));
  },
  async update(id: TodoId, patch: UpdateTodoRequest): Promise<Todo> {
    return parseTodo(await request(`/api/todos/${id}`, jsonRequest('PATCH', patch)));
  },
  async remove(id: TodoId): Promise<void> {
    await request(`/api/todos/${id}`, { method: 'DELETE' });
  },
  async completeAll(done: boolean): Promise<void> {
    await request('/api/todos/complete', jsonRequest('POST', { done }));
  },
  async clearCompleted(): Promise<void> {
    await request('/api/todos/completed', { method: 'DELETE' });
  },
};

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function request(pathname: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(pathname, init);
  if (!response.ok) {
    const problem = await response
      .json()
      .then((value) => (isRecord(value) && typeof value.error === 'string' ? value.error : undefined))
      .catch(() => undefined);
    throw new Error(problem ?? `Todo API returned ${response.status}.`);
  }
  if (response.status === 204) return undefined;
  return response.json() as Promise<unknown>;
}

function parseTodos(value: unknown): readonly Todo[] {
  if (!Array.isArray(value)) throw new Error('Todo API returned a non-array response.');
  return value.map(parseTodo);
}

function parseTodo(value: unknown): Todo {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.title !== 'string' ||
    typeof value.done !== 'boolean'
  ) {
    throw new Error('Todo API returned an invalid todo.');
  }
  return { id: value.id, title: value.title, done: value.done };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
