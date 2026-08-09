import { createServer } from 'node:http';

const port = Number(process.env.TODO_API_PORT ?? 8787);
const host = process.env.TODO_API_HOST ?? '127.0.0.1';

let nextId = 4;
const todos = new Map([
  [1, { id: 1, title: 'TanStack Query owns this list', done: false }],
  [2, { id: 2, title: 'Uklad owns the active filter', done: false }],
  [3, { id: 3, title: 'Try a remote mutation', done: true }],
]);

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected Todo API error.';
    sendJson(response, status, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`[todomvc-query-api] listening at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

async function route(request, response) {
  setCors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`);
  const pathname = url.pathname;

  if (request.method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET' && pathname === '/api/todos') {
    sendJson(response, 200, listTodos());
    return;
  }
  if (request.method === 'POST' && pathname === '/api/todos') {
    const { title } = await readJson(request);
    const todo = { id: nextId++, title: requireTitle(title), done: false };
    todos.set(todo.id, todo);
    sendJson(response, 201, todo);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/todos/complete') {
    const { done } = await readJson(request);
    if (typeof done !== 'boolean') throw new HttpError(400, '`done` must be a boolean.');
    for (const todo of todos.values()) todo.done = done;
    sendEmpty(response, 204);
    return;
  }
  if (request.method === 'DELETE' && pathname === '/api/todos/completed') {
    for (const [id, todo] of todos) {
      if (todo.done) todos.delete(id);
    }
    sendEmpty(response, 204);
    return;
  }

  const todoId = matchTodoId(pathname);
  if (todoId !== undefined && request.method === 'PATCH') {
    const todo = todos.get(todoId);
    if (!todo) throw new HttpError(404, 'Todo not found.');
    const { title, done } = await readJson(request);
    if (title !== undefined) todo.title = requireTitle(title);
    if (done !== undefined) {
      if (typeof done !== 'boolean') throw new HttpError(400, '`done` must be a boolean.');
      todo.done = done;
    }
    sendJson(response, 200, todo);
    return;
  }
  if (todoId !== undefined && request.method === 'DELETE') {
    if (!todos.delete(todoId)) throw new HttpError(404, 'Todo not found.');
    sendEmpty(response, 204);
    return;
  }

  throw new HttpError(404, 'Route not found.');
}

function listTodos() {
  return Array.from(todos.values(), (todo) => ({ ...todo }));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  if (body.length === 0) return {};
  try {
    const value = JSON.parse(body);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new HttpError(400, 'Expected a JSON object.');
    }
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function requireTitle(value) {
  if (typeof value !== 'string') throw new HttpError(400, '`title` must be a string.');
  const title = value.trim();
  if (title.length === 0) throw new HttpError(400, '`title` cannot be empty.');
  return title;
}

function matchTodoId(pathname) {
  const match = /^\/api\/todos\/(\d+)$/.exec(pathname);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function setCors(response) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendEmpty(response, status) {
  response.writeHead(status).end();
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
