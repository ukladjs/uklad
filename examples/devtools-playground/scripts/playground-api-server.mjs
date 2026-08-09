import { createServer } from 'node:http';

const port = Number(process.env.PLAYGROUND_API_PORT ?? 8788);
const host = process.env.PLAYGROUND_API_HOST ?? '127.0.0.1';
const startedAt = Date.now();
const itemRequests = new Map();
const regionRequests = new Map();

const items = new Map([
  [1, 'Compiler telemetry'],
  [2, 'Subscription graph'],
  [3, 'Remote feature flags'],
  [4, 'Deployment status'],
]);

const regions = new Map([
  ['eu', { city: 'Berlin', temperatureC: 21 }],
  ['us', { city: 'New York', temperatureC: 25 }],
  ['apac', { city: 'Tokyo', temperatureC: 28 }],
]);

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected playground API error.';
    sendJson(response, status, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`[devtools-playground-api] listening at http://${host}:${port}`);
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

  if (request.method === 'GET' && pathname === '/api/playground/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET' && pathname === '/api/playground/clock') {
    await delay(80);
    sendJson(response, 200, {
      tick: Math.floor((Date.now() - startedAt) / 1_000),
      serverTime: new Date().toISOString(),
    });
    return;
  }

  const itemId = matchPath(pathname, /^\/api\/playground\/items\/(\d+)$/);
  if (request.method === 'GET' && itemId !== undefined) {
    const title = items.get(itemId);
    if (title === undefined) throw new HttpError(404, 'Server item not found.');
    await delay(180);
    const requestCount = (itemRequests.get(itemId) ?? 0) + 1;
    itemRequests.set(itemId, requestCount);
    sendJson(response, 200, {
      id: itemId,
      title,
      requestCount,
      serverTime: new Date().toISOString(),
    });
    return;
  }

  const region = matchPath(pathname, /^\/api\/playground\/regions\/(eu|us|apac)$/);
  if (request.method === 'GET' && typeof region === 'string') {
    const summary = regions.get(region);
    if (summary === undefined) throw new HttpError(404, 'Server region not found.');
    await delay(140);
    const requestCount = (regionRequests.get(region) ?? 0) + 1;
    regionRequests.set(region, requestCount);
    sendJson(response, 200, {
      region,
      ...summary,
      requestCount,
      serverTime: new Date().toISOString(),
    });
    return;
  }

  throw new HttpError(404, 'Route not found.');
}

function matchPath(pathname, pattern) {
  const match = pattern.exec(pathname);
  if (!match) return undefined;
  if (/^\d+$/.test(match[1])) {
    const value = Number(match[1]);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  return match[1];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function setCors(response) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('cache-control', 'no-store');
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
