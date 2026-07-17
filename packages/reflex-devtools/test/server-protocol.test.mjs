import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import WebSocket from 'ws';

import { DevtoolsServer } from '../dist/server/index.js';
import { reflexReplacer } from '../dist/serialization.js';

const activeServers = new Set();
const activeSockets = new Set();
const sessionsByBaseUrl = new Map();
const sessionsByWsUrl = new Map();

const PROTOCOL_VERSION = '1';
const WS_PROTOCOL = 'reflex-devtools.v1';

afterEach(async () => {
  for (const socket of activeSockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
  }
  activeSockets.clear();

  for (const server of activeServers) {
    await server.stop();
  }
  activeServers.clear();
  sessionsByBaseUrl.clear();
  sessionsByWsUrl.clear();
});

async function bootstrapSession(baseUrl, role) {
  const response = await fetch(`${baseUrl}/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Reflex-DevTools-Protocol-Version': PROTOCOL_VERSION,
    },
    body: JSON.stringify({ role }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.role, role);
  assert.equal(body.protocolVersion, 1);
  assert.equal(typeof body.token, 'string');
  assert(body.token.length >= 32);
  return body;
}

async function startServer(
  config = {},
  { grantTestCapabilities = true } = {},
) {
  const effectiveConfig = { ...config };
  if (grantTestCapabilities && effectiveConfig.capabilities === undefined) {
    // Existing protocol tests exercise mutation flows. Security-specific tests
    // opt out so they cover the server's actual read-only default.
    effectiveConfig.capabilities = ['inspect', 'dispatch'];
  }

  const server = new DevtoolsServer({
    port: 0,
    host: '127.0.0.1',
    enableMCP: true,
    ...effectiveConfig,
  });
  await server.start();
  activeServers.add(server);

  const address = server.server.address();
  assert(address && typeof address === 'object');

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}`;
  const sessions = Object.fromEntries(
    await Promise.all(
      ['runtime', 'ui', 'mcp'].map(async (role) => [
        role,
        await bootstrapSession(baseUrl, role),
      ]),
    ),
  );
  sessionsByBaseUrl.set(baseUrl, sessions);
  sessionsByWsUrl.set(wsUrl, sessions);

  return {
    server,
    baseUrl,
    wsUrl,
    sessions,
  };
}

async function connectSdk(wsUrl, onDispatch, onEvalSub = () => {}, onMessage = () => {}) {
  const session = sessionsByWsUrl.get(wsUrl);
  assert(session, `missing test session for ${wsUrl}`);

  const socket = new WebSocket(`${wsUrl}/sdk`, WS_PROTOCOL);
  activeSockets.add(socket);

  let resolveHello;
  let rejectHello;
  const helloReceived = new Promise((resolve, reject) => {
    resolveHello = resolve;
    rejectHello = reject;
  });
  const rejectBeforeHello = (code, reason) => {
    rejectHello(
      new Error(
        `runtime socket closed before server hello (${code}: ${reason.toString()})`,
      ),
    );
  };
  socket.once('close', rejectBeforeHello);
  socket.once('error', rejectHello);

  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'devtools-server-hello') {
      socket.runtimeSessionId = message.payload.runtimeSessionId;
      socket.serverHello = message.payload;
      resolveHello(message);
    }
    onMessage(message, socket);
    if (message.type === 'dispatch-to-client') {
      onDispatch(message, socket);
    } else if (message.type === 'eval-sub-to-client') {
      onEvalSub(message, socket);
    }
  });

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  assert.equal(socket.protocol, WS_PROTOCOL);
  socket.send(JSON.stringify({
    type: 'reflex-auth',
    payload: {
      role: 'runtime',
      protocolVersion: 1,
      inspectorApiVersion: 1,
      token: session.runtime.token,
    },
  }));
  await helloReceived;
  socket.removeListener('close', rejectBeforeHello);
  socket.removeListener('error', rejectHello);

  return socket;
}

async function connectUi(wsUrl) {
  const session = sessionsByWsUrl.get(wsUrl);
  assert(session, `missing test session for ${wsUrl}`);

  const socket = new WebSocket(`${wsUrl}/ui`, WS_PROTOCOL);
  activeSockets.add(socket);

  const connected = new Promise((resolve, reject) => {
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type !== 'devtools-connected') return;
      socket.removeListener('close', onClose);
      socket.removeListener('error', reject);
      resolve(message);
    };
    const onClose = (code, reason) => {
      socket.removeListener('message', onMessage);
      reject(
        new Error(
          `UI socket closed before authentication (${code}: ${reason.toString()})`,
        ),
      );
    };
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.once('error', reject);
  });

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  assert.equal(socket.protocol, WS_PROTOCOL);
  socket.send(JSON.stringify({
    type: 'reflex-auth',
    payload: {
      role: 'ui',
      protocolVersion: 1,
      token: session.ui.token,
    },
  }));
  await connected;

  return socket;
}

async function openWebSocket(url) {
  const socket = new WebSocket(url, WS_PROTOCOL);
  activeSockets.add(socket);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  assert.equal(socket.protocol, WS_PROTOCOL);
  return socket;
}

function waitForSocketMessage(socket, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('socket message was not received before timeout'));
    }, timeoutMs);
    const onMessage = (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onClose = (code, reason) => {
      cleanup();
      reject(
        new Error(
          `socket closed before expected message (${code}: ${reason.toString()})`,
        ),
      );
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeListener('message', onMessage);
      socket.removeListener('close', onClose);
      socket.removeListener('error', onError);
    };
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

function waitForSocketClose(socket, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('socket did not close before timeout'));
    }, timeoutMs);
    const onClose = (code, reason) => {
      cleanup();
      resolve({ code, reason: reason.toString() });
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeListener('close', onClose);
      socket.removeListener('error', onError);
    };
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

function rawHttpRequest(baseUrl, path, headers) {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.once('error', reject);
    request.end();
  });
}

function sendSdkEvent(socket, event) {
  socket.send(JSON.stringify(event, reflexReplacer));
}

function authenticatedFetch(baseUrl, path, init = {}, role = 'mcp') {
  const session = sessionsByBaseUrl.get(baseUrl);
  assert(session, `missing test session for ${baseUrl}`);
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${session[role].token}`);
  }
  if (!headers.has('Reflex-DevTools-Protocol-Version')) {
    headers.set('Reflex-DevTools-Protocol-Version', PROTOCOL_VERSION);
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function postDispatch(baseUrl, eventName, params = []) {
  return authenticatedFetch(baseUrl, '/api/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName, params }),
  });
}

function postEvalSub(baseUrl, id, args = []) {
  return authenticatedFetch(baseUrl, '/api/eval-sub', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, args }),
  });
}

async function getStatus(baseUrl) {
  const response = await authenticatedFetch(baseUrl, '/api/status');
  assert.equal(response.status, 200);
  return response.json();
}

// Poll /api/status until `predicate` holds — WebSocket processing is async
// relative to HTTP, so tests can't assert immediately after socket.send.
async function waitForStatus(baseUrl, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let status = await getStatus(baseUrl);
  while (!predicate(status)) {
    assert(Date.now() < deadline, `status never satisfied predicate: ${JSON.stringify(status)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    status = await getStatus(baseUrl);
  }
  return status;
}

async function waitForCondition(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert(Date.now() < deadline, 'condition was not satisfied before timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('the default read-only capability denies HTTP and UI dispatches and audits both', async () => {
  const { baseUrl, wsUrl } = await startServer(
    {},
    { grantTestCapabilities: false },
  );

  const status = await getStatus(baseUrl);
  assert.deepEqual(status.capabilities, ['inspect']);
  assert.equal(status.readOnly, true);

  const httpResponse = await postDispatch(
    baseUrl,
    'rotate-credentials',
    [{ password: 'must-not-be-audited' }],
  );
  const httpBody = await httpResponse.json();
  assert.equal(httpResponse.status, 403);
  assert.equal(httpBody.code, 'CAPABILITY_DENIED');
  assert.equal(httpBody.requiredCapability, 'dispatch');
  assert.equal(typeof httpBody.requestId, 'string');

  const uiSocket = await connectUi(wsUrl);
  const uiErrorPromise = waitForSocketMessage(
    uiSocket,
    (message) => message.type === 'devtools-error',
  );
  uiSocket.send(JSON.stringify({
    type: 'dispatch-to-client',
    payload: {
      eventName: 'rotate-credentials',
      params: [{ password: 'must-not-be-audited' }],
    },
  }));
  const uiError = await uiErrorPromise;
  assert.equal(uiError.payload.code, 'CAPABILITY_DENIED');
  assert.equal(typeof uiError.payload.requestId, 'string');

  const auditResponse = await authenticatedFetch(baseUrl, '/api/audit');
  const auditText = await auditResponse.text();
  assert.equal(auditResponse.status, 200);
  assert.equal(auditText.includes('must-not-be-audited'), false);
  const audit = JSON.parse(auditText);
  assert.deepEqual(
    audit.records
      .filter((record) =>
        record.requestId === httpBody.requestId
        || record.requestId === uiError.payload.requestId)
      .map((record) => ({
        principal: record.principal,
        transport: record.transport,
        status: record.status,
        reason: record.reason,
      })),
    [
      {
        principal: 'mcp',
        transport: 'http',
        status: 'denied',
        reason: 'capability-not-granted',
      },
      {
        principal: 'ui',
        transport: 'websocket',
        status: 'denied',
        reason: 'capability-not-granted',
      },
    ],
  );
});

test('protected HTTP APIs reject missing or wrong credentials and protocol mismatches', async () => {
  const { baseUrl, sessions } = await startServer();

  let response = await fetch(`${baseUrl}/api/status`, {
    headers: {
      'Reflex-DevTools-Protocol-Version': PROTOCOL_VERSION,
    },
  });
  let body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, 'AUTH_REQUIRED');
  assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer /);

  response = await fetch(`${baseUrl}/api/status`, {
    headers: {
      Authorization: `Bearer ${'x'.repeat(43)}`,
      'Reflex-DevTools-Protocol-Version': PROTOCOL_VERSION,
    },
  });
  body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, 'AUTH_REQUIRED');

  response = await fetch(`${baseUrl}/api/status`, {
    headers: {
      Authorization: `Bearer ${sessions.mcp.token}`,
      'Reflex-DevTools-Protocol-Version': '999',
    },
  });
  body = await response.json();
  assert.equal(response.status, 426);
  assert.equal(body.code, 'PROTOCOL_MISMATCH');
  assert.deepEqual(body.supportedVersions, [1]);
});

test('HTTP requests reject disallowed Origin and Host values before API handling', async () => {
  const { baseUrl, sessions } = await startServer();
  const headers = {
    Authorization: `Bearer ${sessions.mcp.token}`,
    'Reflex-DevTools-Protocol-Version': PROTOCOL_VERSION,
  };

  const originResponse = await fetch(`${baseUrl}/api/status`, {
    headers: {
      ...headers,
      Origin: 'https://attacker.example',
    },
  });
  const originBody = await originResponse.json();
  assert.equal(originResponse.status, 403);
  assert.equal(originBody.code, 'ORIGIN_NOT_ALLOWED');

  const hostResponse = await rawHttpRequest(baseUrl, '/api/status', {
    ...headers,
    Host: 'attacker.example',
  });
  assert.equal(hostResponse.status, 403);
  assert.equal(hostResponse.body.code, 'HOST_NOT_ALLOWED');
});

test('failed or incompatible SDK authentication cannot supersede a valid runtime', async () => {
  const { baseUrl, wsUrl, sessions } = await startServer();
  const validSocket = await connectSdk(wsUrl, () => {});
  sendSdkEvent(validSocket, {
    type: 'reflex-app-db',
    payload: { retained: true },
  });
  await waitForStatus(
    baseUrl,
    (status) => status.sessionEpoch === 1 && status.stateAvailable,
  );

  const wrongTokenSocket = await openWebSocket(`${wsUrl}/sdk`);
  const wrongTokenClosed = waitForSocketClose(wrongTokenSocket);
  wrongTokenSocket.send(JSON.stringify({
    type: 'reflex-auth',
    payload: {
      role: 'runtime',
      protocolVersion: 1,
      inspectorApiVersion: 1,
      token: 'not-the-runtime-token',
    },
  }));
  assert.deepEqual(await wrongTokenClosed, {
    code: 1008,
    reason: 'Authentication failed',
  });

  const incompatibleSocket = await openWebSocket(`${wsUrl}/sdk`);
  const incompatibleClosed = waitForSocketClose(incompatibleSocket);
  incompatibleSocket.send(JSON.stringify({
    type: 'reflex-auth',
    payload: {
      role: 'runtime',
      protocolVersion: 1,
      inspectorApiVersion: 999,
      token: sessions.runtime.token,
    },
  }));
  assert.deepEqual(await incompatibleClosed, {
    code: 1002,
    reason: 'Unsupported inspector API version',
  });

  const status = await getStatus(baseUrl);
  assert.equal(status.appConnected, true);
  assert.equal(status.connectedApps, 1);
  assert.equal(status.sessionEpoch, 1);
  assert.equal(status.stateAvailable, true);
  assert.equal(validSocket.readyState, WebSocket.OPEN);
});

test('runtime HTTP fallback rejects a stale session after SDK reconnect', async () => {
  const { baseUrl, wsUrl } = await startServer();
  const firstSocket = await connectSdk(wsUrl, () => {});
  const staleSessionId = firstSocket.runtimeSessionId;
  const firstClosed = waitForSocketClose(firstSocket);

  const secondSocket = await connectSdk(wsUrl, () => {});
  await firstClosed;
  assert.notEqual(secondSocket.runtimeSessionId, staleSessionId);

  const response = await authenticatedFetch(baseUrl, '/event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Reflex-Runtime-Session': staleSessionId,
    },
    body: JSON.stringify({
      type: 'reflex-app-db',
      payload: { stale: true },
    }),
  }, 'runtime');
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, 'STALE_RUNTIME_SESSION');
  assert.equal(secondSocket.readyState, WebSocket.OPEN);
  const status = await getStatus(baseUrl);
  assert.equal(status.sessionEpoch, 2);
  assert.equal(status.stateAvailable, false);
});

test('oversized runtime trace batches close only the offending socket without crashing the server', async () => {
  const { baseUrl, wsUrl } = await startServer();
  const socket = await connectSdk(wsUrl, () => {});
  const closed = waitForSocketClose(socket);

  sendSdkEvent(socket, {
    type: 'reflex-traces',
    payload: Array.from({ length: 2001 }, (_, id) => ({
      id,
      start: id,
      opType: 'event',
      operation: 'bounded-runtime-event',
    })),
  });

  assert.deepEqual(await closed, {
    code: 1008,
    reason: 'Invalid runtime event',
  });
  const disconnected = await waitForStatus(
    baseUrl,
    (status) => status.appConnected === false,
  );
  assert.equal(disconnected.sessionEpoch, 1);

  await connectSdk(wsUrl, () => {});
  const recovered = await waitForStatus(
    baseUrl,
    (status) => status.appConnected === true,
  );
  assert.equal(recovered.sessionEpoch, 2);
});

test('retention-limit rejection sends a bounded notice and keeps the runtime socket open', async () => {
  const { server, baseUrl, wsUrl } = await startServer();
  // Exercise the real storage limiter with a small test-only threshold. TS
  // private/readonly fields are compile-time constraints and remain ordinary
  // object properties in the emitted JavaScript.
  server.storage.maxAppStateBytes = 128;
  const socket = await connectSdk(wsUrl, () => {});

  const noticePromise = waitForSocketMessage(
    socket,
    (message) =>
      message.type === 'devtools-error'
      && message.payload?.code === 'RUNTIME_TELEMETRY_DROPPED',
  );
  sendSdkEvent(socket, {
    type: 'reflex-app-db',
    payload: { data: 'x'.repeat(512) },
  });
  const notice = await noticePromise;

  assert.deepEqual(notice.payload, {
    code: 'RUNTIME_TELEMETRY_DROPPED',
    reason: 'retention-limit',
    eventType: 'reflex-app-db',
  });
  assert(JSON.stringify(notice).length < 512);
  assert.equal(socket.readyState, WebSocket.OPEN);

  sendSdkEvent(socket, {
    type: 'reflex-app-db',
    payload: { retained: true },
  });
  const status = await waitForStatus(
    baseUrl,
    (candidate) => candidate.stateAvailable === true,
  );
  assert.equal(status.appConnected, true);
  assert.equal(status.sessionEpoch, 1);
});

test('server redaction failure drops telemetry nonfatally with no exception detail', async () => {
  const marker = 'server-redactor-secret-detail';
  const { wsUrl } = await startServer({
    redaction: {
      state() {
        throw new Error(marker);
      },
    },
  });
  const socket = await connectSdk(wsUrl, () => {});
  const noticePromise = waitForSocketMessage(
    socket,
    (message) =>
      message.type === 'devtools-error'
      && message.payload?.reason === 'redaction-failed',
  );

  sendSdkEvent(socket, {
    type: 'reflex-app-db',
    payload: { value: marker },
  });
  const notice = await noticePromise;

  assert.deepEqual(notice.payload, {
    code: 'RUNTIME_TELEMETRY_DROPPED',
    reason: 'redaction-failed',
    eventType: 'reflex-app-db',
  });
  assert.equal(JSON.stringify(notice).includes(marker), false);
  assert.equal(socket.readyState, WebSocket.OPEN);
});

test('control endpoints return 413 before parsing payloads above the configured limit', async () => {
  const { baseUrl } = await startServer({ maxControlPayloadBytes: 128 });

  const response = await authenticatedFetch(baseUrl, '/api/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventName: 'oversized-event',
      params: ['x'.repeat(1024)],
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.code, 'PAYLOAD_TOO_LARGE');
});

test('hard WebSocket frame limits may close oversized senders with 1009', async () => {
  const { baseUrl, wsUrl } = await startServer({
    maxRuntimePayloadBytes: 256,
  });
  const socket = await connectSdk(wsUrl, () => {});
  const closed = waitForSocketClose(socket);

  sendSdkEvent(socket, {
    type: 'reflex-app-db',
    payload: { data: 'x'.repeat(1024) },
  });

  assert.deepEqual(await closed, {
    code: 1009,
    reason: '',
  });
  const status = await waitForStatus(
    baseUrl,
    (candidate) => candidate.appConnected === false,
  );
  assert.equal(status.sessionEpoch, 1);
});

test('internal HTTP failures return a correlation id without raw error detail', async () => {
  const { server, baseUrl } = await startServer();
  const marker = 'internal-secret-error-detail';
  const originalGetTraces = server.storage.getTraces;
  const originalConsoleError = console.error;
  const diagnostics = [];
  const internalError = new Error(marker);
  Object.defineProperty(internalError, 'name', {
    get() {
      throw new Error('hostile error-name accessor');
    },
  });
  server.storage.getTraces = () => {
    throw internalError;
  };
  console.error = (...args) => diagnostics.push(args.map(String).join(' '));

  try {
    const response = await authenticatedFetch(baseUrl, '/api/traces');
    const text = await response.text();
    const body = JSON.parse(text);

    assert.equal(response.status, 500);
    assert.equal(body.success, false);
    assert.equal(body.code, 'INTERNAL_ERROR');
    assert.equal(body.error, 'An internal server error occurred.');
    assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(text.includes(marker), false);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], new RegExp(body.requestId));
    assert.equal(diagnostics[0].includes(marker), false);
  } finally {
    server.storage.getTraces = originalGetTraces;
    console.error = originalConsoleError;
  }
});

test('server-side redaction prevents state, trace, dispatch, and audit secret leakage', async () => {
  const { baseUrl, wsUrl } = await startServer();
  const secret = 'security-regression-secret-marker';
  const trace = {
    id: 401,
    opType: 'event',
    operation: 'save-account',
    start: Date.now(),
    duration: 1,
    tags: {
      event: ['save-account'],
      patches: [
        {
          op: 'replace',
          path: ['account', 'password'],
          value: secret,
        },
      ],
      reversePatches: [
        {
          op: 'replace',
          path: ['account', 'password'],
          value: secret,
        },
      ],
      metadata: { access_token: secret },
      effects: [],
    },
  };

  const sdkSocket = await connectSdk(wsUrl, (message, socket) => {
    assert.equal(message.payload.params[0].password, secret);
    sendSdkEvent(socket, { type: 'reflex-traces', payload: [trace] });
    sendSdkEvent(socket, {
      type: 'reflex-dispatch-result',
      payload: {
        dispatchId: message.payload.dispatchId,
        trace,
      },
    });
  });
  sendSdkEvent(sdkSocket, {
    type: 'reflex-app-db',
    payload: {
      account: {
        displayName: 'Ada',
        password: secret,
        apiKey: secret,
      },
    },
  });
  await waitForStatus(baseUrl, (status) => status.stateAvailable);

  const dispatchResponse = await postDispatch(
    baseUrl,
    'save-account',
    [{ password: secret }],
  );
  const dispatchText = await dispatchResponse.text();
  assert.equal(dispatchResponse.status, 200);
  assert.equal(dispatchText.includes(secret), false);
  const dispatchBody = JSON.parse(dispatchText);
  assert.equal(dispatchBody.outcome, 'succeeded');
  assert.equal(dispatchBody.patches[0].value, '[REDACTED]');

  const stateResponse = await authenticatedFetch(baseUrl, '/api/state');
  const stateText = await stateResponse.text();
  assert.equal(stateResponse.status, 200);
  assert.equal(stateText.includes(secret), false);
  const stateBody = JSON.parse(stateText);
  assert.equal(stateBody.state.account.displayName, 'Ada');
  assert.equal(stateBody.state.account.password, '[REDACTED]');
  assert.equal(stateBody.state.account.apiKey, '[REDACTED]');

  const traceResponse = await authenticatedFetch(baseUrl, '/api/traces/401');
  const traceText = await traceResponse.text();
  assert.equal(traceResponse.status, 200);
  assert.equal(traceText.includes(secret), false);
  const traceBody = JSON.parse(traceText);
  assert.equal(traceBody.trace.tags.patches[0].value, '[REDACTED]');
  assert.equal('reversePatches' in traceBody.trace.tags, false);
  assert.equal(traceBody.trace.tags.metadata.access_token, '[REDACTED]');

  const auditResponse = await authenticatedFetch(baseUrl, '/api/audit');
  const auditText = await auditResponse.text();
  assert.equal(auditResponse.status, 200);
  assert.equal(auditText.includes(secret), false);
  const auditBody = JSON.parse(auditText);
  const dispatchAudit = auditBody.records.filter(
    (record) => record.requestId === dispatchBody.requestId,
  );
  assert.deepEqual(
    dispatchAudit.map((record) => record.status),
    ['accepted', 'succeeded'],
  );
  assert(dispatchAudit.every((record) => !('params' in record)));
});

test('browser-origin requests cannot bootstrap the MCP principal', async () => {
  const { baseUrl } = await startServer({
    allowedOrigins: ['http://127.0.0.1:9999'],
  });

  const response = await fetch(`${baseUrl}/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:9999',
      'Reflex-DevTools-Protocol-Version': PROTOCOL_VERSION,
    },
    body: JSON.stringify({ role: 'mcp' }),
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, 'BROWSER_ROLE_DENIED');
});

test('an unlisted loopback browser origin cannot bootstrap or take over the runtime role', async () => {
  const { baseUrl } = await startServer();

  const response = await fetch(`${baseUrl}/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:9999',
      'Reflex-DevTools-Protocol-Version': PROTOCOL_VERSION,
    },
    body: JSON.stringify({ role: 'runtime' }),
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, 'ORIGIN_NOT_ALLOWED');
});

test('non-loopback binding is refused without an explicit remote security configuration', () => {
  assert.throws(
    () => new DevtoolsServer({ port: 0, host: '0.0.0.0' }),
    /Refusing non-loopback host/,
  );
  assert.throws(
    () => new DevtoolsServer({
      port: 0,
      host: '127.0.0.1',
      allowedHosts: ['localhost:4000'],
    }),
    /allowedHosts entries must be exact host names without ports/,
  );
});

test('/api/status answers without MCP instead of a 503', async () => {
  const { baseUrl } = await startServer({ enableMCP: false });

  const status = await getStatus(baseUrl);

  assert.equal(status.success, true);
  assert.equal(status.mcpEnabled, false);
  assert.equal(status.appConnected, false);
  assert.equal(status.sessionEpoch, 0);
  assert.equal(status.runtime, null);
  assert.equal(status.handlers, null);
});

test('MCP keeps SDK tracing demand active when the browser UI disconnects', async () => {
  const { wsUrl } = await startServer({ enableMCP: true });
  const tracingDemand = [];
  await connectSdk(
    wsUrl,
    () => {},
    () => {},
    (message) => {
      if (message.type === 'ui-connection-status') {
        tracingDemand.push(message.payload.connectedUIs);
      }
    },
  );

  await waitForCondition(() => tracingDemand.length >= 1);
  assert.equal(tracingDemand.at(-1), 1);

  const uiSocket = await connectUi(wsUrl);
  await waitForCondition(() => tracingDemand.length >= 2);
  assert.equal(tracingDemand.at(-1), 1);

  const uiClosed = new Promise((resolve) => uiSocket.once('close', resolve));
  uiSocket.close();
  await uiClosed;
  await waitForCondition(() => tracingDemand.length >= 3);

  assert.equal(tracingDemand.at(-1), 1);
  assert.equal(tracingDemand.includes(0), false);
});

test('without MCP the final browser UI disconnect removes SDK tracing demand', async () => {
  const { wsUrl } = await startServer({ enableMCP: false });
  const tracingDemand = [];
  await connectSdk(
    wsUrl,
    () => {},
    () => {},
    (message) => {
      if (message.type === 'ui-connection-status') {
        tracingDemand.push(message.payload.connectedUIs);
      }
    },
  );

  await waitForCondition(() => tracingDemand.length >= 1);
  assert.equal(tracingDemand.at(-1), 0);

  const uiSocket = await connectUi(wsUrl);
  await waitForCondition(() => tracingDemand.at(-1) === 1);

  const uiClosed = new Promise((resolve) => uiSocket.once('close', resolve));
  uiSocket.close();
  await uiClosed;
  await waitForCondition(() => tracingDemand.at(-1) === 0 && tracingDemand.length >= 3);

  assert.deepEqual(tracingDemand.slice(0, 3), [0, 1, 0]);
});

test('/api/status reports runtime info and bumps sessionEpoch per SDK session', async () => {
  const { baseUrl, wsUrl } = await startServer();

  // Before any app connects
  let status = await getStatus(baseUrl);
  assert.equal(status.mcpEnabled, true);
  assert.equal(status.appConnected, false);
  assert.equal(status.sessionEpoch, 0);
  assert.equal(status.stateAvailable, false);

  // First SDK session reports a headless runtime with safe adapters
  const socket = await connectSdk(wsUrl, () => {});
  sendSdkEvent(socket, {
    type: 'reflex-runtime-info',
    payload: {
      runtime: 'headless',
      effectMode: 'safe',
      effects: { 'local-storage-set': 'memory', 'set-document-title': 'noop' },
      tracing: true,
    },
  });
  sendSdkEvent(socket, {
    type: 'reflex-handler-keys',
    payload: { event: ['a', 'b'], fx: ['c'], cofx: [], sub: ['d', 'e', 'f'] },
  });

  status = await waitForStatus(baseUrl, (s) => s.runtime !== null && s.handlers !== null);
  assert.equal(status.appConnected, true);
  assert.equal(status.sessionEpoch, 1);
  assert.equal(status.runtime, 'headless');
  assert.equal(status.effectMode, 'safe');
  assert.deepEqual(status.effects, {
    'local-storage-set': 'memory',
    'set-document-title': 'noop',
  });
  assert.equal(status.tracing, true);
  assert.deepEqual(status.handlers, { event: 2, fx: 1, cofx: 0, sub: 3 });

  // A reconnect is a new session: epoch bumps, stale runtime info is gone
  socket.close();
  await waitForStatus(baseUrl, (s) => s.appConnected === false);

  await connectSdk(wsUrl, () => {});
  status = await waitForStatus(baseUrl, (s) => s.appConnected === true);
  assert.equal(status.sessionEpoch, 2);
  assert.equal(status.runtime, null);
  assert.equal(status.handlers, null);
});

test('a new SDK connection supersedes the previous one instead of double-dispatching', async () => {
  const { baseUrl, wsUrl } = await startServer();

  let firstClientDispatches = 0;
  const firstSocket = await connectSdk(wsUrl, () => {
    firstClientDispatches++;
  });
  const firstClosed = new Promise((resolve) => firstSocket.once('close', resolve));

  await connectSdk(wsUrl, (message, socket) => {
    const trace = {
      id: 1,
      opType: 'event',
      operation: 'increment-counter',
      start: Date.now(),
      duration: 1,
      tags: { event: ['increment-counter'], patches: [], effects: [] },
    };
    sendSdkEvent(socket, {
      type: 'reflex-dispatch-result',
      payload: { dispatchId: message.payload.dispatchId, trace },
    });
  });

  // The server terminates the stale first connection...
  await firstClosed;
  const status = await waitForStatus(baseUrl, (s) => s.connectedApps === 1);
  assert.equal(status.sessionEpoch, 2);

  // ...so a dispatch reaches only the new session's app.
  const response = await postDispatch(baseUrl, 'increment-counter');
  const body = await response.json();

  assert.equal(body.outcome, 'succeeded');
  assert.equal(firstClientDispatches, 0);
});

test('a session restart fails in-flight dispatches instead of leaving them to time out', async () => {
  const { baseUrl, wsUrl } = await startServer();

  // First session receives the dispatch but never reports an outcome
  let dispatchDelivered;
  const delivered = new Promise((resolve) => { dispatchDelivered = resolve; });
  await connectSdk(wsUrl, () => dispatchDelivered());

  const responsePromise = postDispatch(baseUrl, 'increment-counter');
  await delivered;

  // App restarts mid-flight: a new SDK session connects
  await connectSdk(wsUrl, () => {});

  const response = await responsePromise;
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.outcome, 'unknown');
  // The session-boundary message, not the 5s "no trace" timeout and not the
  // all-clients-gone disconnect message.
  assert.match(body.message, /session restarted/);
});

test('/api/dispatch requires MCP mode', async () => {
  const { baseUrl } = await startServer({ enableMCP: false });

  const response = await postDispatch(baseUrl, 'increment-counter');
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.success, false);
  assert.match(body.error, /MCP dispatch requires/);
});

test('/api/dispatch reports when no SDK app is connected', async () => {
  const { baseUrl } = await startServer();

  const response = await postDispatch(baseUrl, 'increment-counter');
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.success, false);
  assert.match(body.error, /No app connected/);
});

test('/api/dispatch rejects malformed params before broadcasting', async () => {
  const { baseUrl } = await startServer();

  const response = await authenticatedFetch(baseUrl, '/api/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: 'increment-counter', params: { amount: 1 } }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /params must be an array/);
});

test('/api/dispatch resolves with the observed successful trace', async () => {
  const { baseUrl, wsUrl } = await startServer();
  const trace = {
    id: 101,
    opType: 'event',
    operation: 'increment-counter',
    start: Date.now(),
    duration: 2.5,
    tags: {
      event: ['increment-counter', 3],
      patches: [
        { op: 'replace', path: ['counter'], value: new Map([['value', 3]]) },
      ],
      effects: [['log-counter', new Set(['counter'])]],
      reversePatches: [
        { op: 'replace', path: ['counter'], value: 2 },
      ],
    },
  };

  await connectSdk(wsUrl, (message, socket) => {
    assert.equal(message.payload.eventName, 'increment-counter');
    assert.deepEqual(message.payload.params, [3]);

    sendSdkEvent(socket, { type: 'reflex-traces', payload: [trace] });
    sendSdkEvent(socket, {
      type: 'reflex-dispatch-result',
      payload: { dispatchId: message.payload.dispatchId, trace },
    });
  });

  const response = await postDispatch(baseUrl, 'increment-counter', [3]);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.outcome, 'succeeded');
  assert.equal(body.traceId, 101);
  assert.equal(body.event[0], 'increment-counter');
  assert.deepEqual(body.patches[0].value, {
    type: 'map',
    entries: [['value', 3]],
  });
  assert.deepEqual(body.effects[0][1], {
    type: 'set',
    values: ['counter'],
  });

  const traceResponse = await authenticatedFetch(baseUrl, '/api/traces/101');
  const traceBody = await traceResponse.json();

  assert.equal(traceResponse.status, 200);
  assert.equal(traceBody.trace.id, 101);
  assert.deepEqual(traceBody.trace.tags.patches[0].value, {
    type: 'map',
    entries: [['value', 3]],
  });
  assert.equal('reversePatches' in traceBody.trace.tags, false);
});

test('/api/dispatch derives failed and effects-failed outcomes from trace tags', async () => {
  const { baseUrl, wsUrl } = await startServer();
  const traces = [
    {
      id: 201,
      opType: 'event',
      operation: 'missing-handler',
      start: Date.now(),
      duration: 1,
      tags: {
        event: ['missing-handler'],
        error: { phase: 'missing-handler', message: 'No handler registered' },
      },
    },
    {
      id: 202,
      opType: 'event',
      operation: 'effect-fails',
      start: Date.now(),
      duration: 3,
      tags: {
        event: ['effect-fails'],
        patches: [{ op: 'replace', path: ['saved'], value: true }],
        effects: [['persist']],
        effectErrors: [{ effect: 'persist', message: 'disk full' }],
      },
    },
  ];

  await connectSdk(wsUrl, (message, socket) => {
    const trace = traces.shift();
    assert(trace);

    sendSdkEvent(socket, { type: 'reflex-traces', payload: [trace] });
    sendSdkEvent(socket, {
      type: 'reflex-dispatch-result',
      payload: { dispatchId: message.payload.dispatchId, trace },
    });
  });

  const failedResponse = await postDispatch(baseUrl, 'missing-handler');
  const failedBody = await failedResponse.json();

  assert.equal(failedResponse.status, 200);
  assert.equal(failedBody.outcome, 'failed');
  assert.equal(failedBody.traceId, 201);
  assert.equal(failedBody.error.phase, 'missing-handler');

  const effectsResponse = await postDispatch(baseUrl, 'effect-fails');
  const effectsBody = await effectsResponse.json();

  assert.equal(effectsResponse.status, 200);
  assert.equal(effectsBody.outcome, 'effects-failed');
  assert.equal(effectsBody.traceId, 202);
  assert.deepEqual(effectsBody.patches, [
    { op: 'replace', path: ['saved'], value: true },
  ]);
  assert.deepEqual(effectsBody.effectErrors, [
    { effect: 'persist', message: 'disk full' },
  ]);
});

test('/api/dispatch reports unknown when the SDK disconnects before the outcome', async () => {
  const { baseUrl, wsUrl } = await startServer();

  await connectSdk(wsUrl, (_message, socket) => {
    socket.close();
  });

  const response = await postDispatch(baseUrl, 'slow-event');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.outcome, 'unknown');
  assert.match(body.message, /disconnected/);
});

test('/api/eval-sub requires MCP mode and a connected app', async () => {
  let server = await startServer({ enableMCP: false });
  let response = await postEvalSub(server.baseUrl, 'counter');
  let body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /MCP subscription evaluation requires/);

  for (const activeServer of activeServers) {
    await activeServer.stop();
  }
  activeServers.clear();

  server = await startServer();
  response = await postEvalSub(server.baseUrl, 'counter');
  body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /No app connected/);
});

test('/api/eval-sub rejects malformed args before broadcasting', async () => {
  const { baseUrl } = await startServer();
  const response = await authenticatedFetch(baseUrl, '/api/eval-sub', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'user-by-id', args: { id: 1 } }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /args must be an array/);
});

test('/api/eval-sub returns a one-shot subscription value with Map and Set data', async () => {
  const { baseUrl, wsUrl } = await startServer();

  await connectSdk(wsUrl, () => {}, (message, socket) => {
    assert.equal(message.payload.id, 'user-summary');
    assert.deepEqual(message.payload.args, [7]);
    sendSdkEvent(socket, {
      type: 'reflex-eval-sub-result',
      payload: {
        evalId: message.payload.evalId,
        value: {
          user: new Map([['id', 7]]),
          permissions: new Set(['read', 'write']),
        },
      },
    });
  });

  const response = await postEvalSub(baseUrl, 'user-summary', [7]);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.value, {
    user: { type: 'map', entries: [['id', 7]] },
    permissions: { type: 'set', values: ['read', 'write'] },
  });
});

test('/api/eval-sub surfaces missing handlers and evaluation errors', async () => {
  const { baseUrl, wsUrl } = await startServer();

  await connectSdk(wsUrl, () => {}, (message, socket) => {
    const missing = message.payload.id === 'missing-sub';
    sendSdkEvent(socket, {
      type: 'reflex-eval-sub-result',
      payload: {
        evalId: message.payload.evalId,
        error: missing
          ? { phase: 'missing-handler', message: 'No subscription handler registered' }
          : { phase: 'evaluation', message: 'selector exploded' },
      },
    });
  });

  let response = await postEvalSub(baseUrl, 'missing-sub');
  let body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.phase, 'missing-handler');

  response = await postEvalSub(baseUrl, 'broken-sub');
  body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.phase, 'evaluation');
  assert.equal(body.error.message, 'selector exploded');
});

test('/api/eval-sub fails promptly if the app disconnects', async () => {
  const { baseUrl, wsUrl } = await startServer();
  await connectSdk(wsUrl, () => {}, (_message, socket) => socket.close());

  const response = await postEvalSub(baseUrl, 'slow-sub');
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /disconnected/);
});

test('/api/traces/:id rejects malformed trace ids', async () => {
  const { baseUrl } = await startServer();

  const response = await authenticatedFetch(baseUrl, '/api/traces/12abc');
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /Trace id must be a number/);
});
