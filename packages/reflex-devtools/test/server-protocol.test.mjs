import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import { DevtoolsServer } from '../dist/server/index.js';
import { reflexReplacer } from '../dist/serialization.js';

const activeServers = new Set();
const activeSockets = new Set();

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
});

async function startServer(config = {}) {
  const server = new DevtoolsServer({
    port: 0,
    host: '127.0.0.1',
    enableMCP: true,
    ...config,
  });
  await server.start();
  activeServers.add(server);

  const address = server.server.address();
  assert(address && typeof address === 'object');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}`,
  };
}

async function connectSdk(wsUrl, onDispatch, onEvalSub = () => {}) {
  const socket = new WebSocket(`${wsUrl}/sdk`);
  activeSockets.add(socket);

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'dispatch-to-client') {
      onDispatch(message, socket);
    } else if (message.type === 'eval-sub-to-client') {
      onEvalSub(message, socket);
    }
  });

  return socket;
}

function sendSdkEvent(socket, event) {
  socket.send(JSON.stringify(event, reflexReplacer));
}

function postDispatch(baseUrl, eventName, params = []) {
  return fetch(`${baseUrl}/api/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName, params }),
  });
}

function postEvalSub(baseUrl, id, args = []) {
  return fetch(`${baseUrl}/api/eval-sub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, args }),
  });
}

async function getStatus(baseUrl) {
  const response = await fetch(`${baseUrl}/api/status`);
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
  assert.match(body.error, /MCP dispatch is disabled/);
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

  const response = await fetch(`${baseUrl}/api/dispatch`, {
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

  const traceResponse = await fetch(`${baseUrl}/api/traces/101`);
  const traceBody = await traceResponse.json();

  assert.equal(traceResponse.status, 200);
  assert.equal(traceBody.trace.id, 101);
  assert.deepEqual(traceBody.trace.tags.patches[0].value, {
    type: 'map',
    entries: [['value', 3]],
  });
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
  assert.match(body.error, /MCP subscription evaluation is disabled/);

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
  const response = await fetch(`${baseUrl}/api/eval-sub`, {
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

  const response = await fetch(`${baseUrl}/api/traces/12abc`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /Trace id must be a number/);
});
