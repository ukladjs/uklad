import assert from 'node:assert/strict';
import test from 'node:test';

import { enableDevtools } from '../dist/client/index.js';

const waitForTurn = () => new Promise((resolve) => setImmediate(resolve));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  static autoOpen = true;
  static throwOnSend = false;
  static runtimePayloadBytes = 1024 * 1024;

  readyState = FakeWebSocket.CONNECTING;
  sent = [];
  closeCount = 0;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
    if (!FakeWebSocket.autoOpen) return;
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.({});
    });
  }

  send(data) {
    const message = JSON.parse(data);
    if (message.type === 'reflex-auth') {
      this.sent.push(message);
      queueMicrotask(() => {
        if (this.readyState !== FakeWebSocket.OPEN) return;
        this.emit({
          type: 'devtools-server-hello',
          payload: {
            protocolVersion: 1,
            runtimeSessionId: 'runtime-session-test',
            limits: {
              runtimePayloadBytes: FakeWebSocket.runtimePayloadBytes,
            },
          },
        });
      });
      return;
    }
    if (FakeWebSocket.throwOnSend) {
      throw new Error('WebSocket send failed');
    }
    this.sent.push(message);
  }

  close(code = 1000, reason = '') {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closeCount++;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  emit(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function response(
  body,
  { ok = true, status = 200, protocolVersion = '1' } = {},
) {
  return {
    ok,
    status,
    headers: new Headers(
      protocolVersion === null
        ? {}
        : { 'Reflex-DevTools-Protocol-Version': protocolVersion },
    ),
    async json() {
      return body;
    },
  };
}

async function successfulFetch(url) {
  if (String(url).endsWith('/health')) {
    return response({ protocolVersion: 1 });
  }
  if (String(url).endsWith('/auth/session')) {
    return response({
      protocolVersion: 1,
      token: 'runtime-test-token',
    });
  }
  return response({ success: true });
}

function createFakeInspector(appDb = { count: 1 }) {
  let traceCallback = null;
  let unsubscribeCount = 0;
  let snapshotCount = 0;
  const dispatches = [];
  const evaluations = [];

  const inspector = {
    apiVersion: 1,
    getSnapshot() {
      snapshotCount++;
      return {
        appDb,
        handlerKeys: {
          event: ['increment'],
          fx: [],
          cofx: [],
          sub: ['answer', 'boom'],
        },
        subscriptions: [
          {
            key: '["answer"]',
            query: ['answer'],
            kind: 'computed',
            active: true,
            version: 1,
            status: 'value',
            value: 42,
          },
        ],
      };
    },
    subscribeTraces(callback) {
      traceCallback = callback;
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        unsubscribeCount++;
        if (traceCallback === callback) {
          traceCallback = null;
        }
      };
    },
    dispatch(event) {
      dispatches.push(event);
    },
    evaluateSubscription(query) {
      evaluations.push(query);
      if (query[0] === 'boom') {
        throw new Error('subscription exploded');
      }
      return 42;
    },
  };

  return {
    inspector,
    dispatches,
    evaluations,
    get snapshotCount() {
      return snapshotCount;
    },
    get unsubscribeCount() {
      return unsubscribeCount;
    },
    async emitTraces(traces) {
      assert.ok(traceCallback, 'trace callback should be subscribed');
      await traceCallback(traces);
    },
  };
}

async function runtimeInfoPayloadFor(config) {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;

  const fake = createFakeInspector();
  let cleanup;
  try {
    cleanup = enableDevtools(fake.inspector, { serverUrl: '127.0.0.1:4000', ...config });
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];
    socket.emit({ type: 'ui-connection-status', payload: { connectedUIs: 1 } });
    return socket.sent.find((event) => event.type === 'reflex-runtime-info')?.payload;
  } finally {
    cleanup?.();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
}

test('runtime-info omits unset optional fields instead of serializing undefined', async () => {
  // Regression: enableDevtools() with no effects/effectMode used to send those
  // keys as undefined, which reflexReplacer serializes to the string
  // 'undefined'. The server's runtime-info schema then rejected the event
  // (effects must be a record), closing the socket into a reconnect loop that
  // stalled data updates and dropped traces.
  const payload = await runtimeInfoPayloadFor({});
  assert.ok(payload, 'runtime-info should be sent');
  assert.ok(
    ['browser', 'headless', 'react-native'].includes(payload.runtime),
    `runtime should be a valid enum value, got ${payload.runtime}`,
  );
  assert.equal(payload.tracing, true);
  assert.equal('effectMode' in payload, false);
  assert.equal('effects' in payload, false);
  for (const value of Object.values(payload)) {
    assert.notEqual(value, 'undefined');
  }
});

test('runtime-info includes effects and effectMode when configured', async () => {
  const payload = await runtimeInfoPayloadFor({
    effectMode: 'safe',
    effects: { 'local-storage-set': 'memory' },
  });
  assert.equal(payload.effectMode, 'safe');
  assert.deepEqual(payload.effects, { 'local-storage-set': 'memory' });
});

test('uses only the injected inspector and returns idempotent cleanup', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;

  const fake = createFakeInspector();
  let cleanup;

  try {
    assert.throws(() => enableDevtools({ serverUrl: 'localhost:4000' }), /createReflexInspector/);
    assert.throws(
      () => enableDevtools(fake.inspector, {
        serverUrl: 'http://devtools.test:4000',
      }),
      /remote plaintext HTTP/,
    );

    cleanup = enableDevtools(fake.inspector, {
      serverUrl: 'devtools.test',
      allowInsecureRemote: true,
    });
    assert.equal(typeof cleanup, 'function');

    await waitForTurn();
    await waitForTurn();

    assert.equal(FakeWebSocket.instances.length, 1);
    const socket = FakeWebSocket.instances[0];
    assert.equal(socket.url, 'ws://devtools.test/sdk');
    assert.deepEqual(socket.protocols, ['reflex-devtools.v1']);
    assert.equal(socket.readyState, FakeWebSocket.OPEN);
    assert.equal(fake.unsubscribeCount, 0);
    assert.equal(fake.snapshotCount, 0);
    assert.equal(socket.sent.length, 1);
    assert.equal(socket.sent[0].type, 'reflex-auth');
    assert.equal(socket.sent[0].payload.role, 'runtime');
    assert.equal(socket.sent[0].payload.protocolVersion, 1);
    assert.equal(socket.sent[0].payload.inspectorApiVersion, 1);
    assert.equal(typeof socket.sent[0].payload.token, 'string');

    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });
    assert.equal(fake.snapshotCount, 1);
    assert.deepEqual(
      socket.sent.slice(-4).map((event) => event.type),
      ['reflex-app-db', 'reflex-active-subs', 'reflex-handler-keys', 'reflex-runtime-info'],
    );

    socket.emit({
      type: 'dispatch-to-client',
      payload: {
        dispatchId: 'dispatch-7',
        eventName: 'increment',
        params: [2],
      },
    });
    assert.deepEqual(fake.dispatches, [['increment', 2]]);

    await fake.emitTraces([
      {
        id: 99,
        operation: 'increment',
        opType: 'event',
        tags: { event: fake.dispatches[0] },
      },
    ]);
    assert.ok(socket.sent.some((event) => event.type === 'reflex-traces'));
    assert.deepEqual(
      socket.sent.find((event) => event.type === 'reflex-dispatch-result')?.payload,
      {
        dispatchId: 'dispatch-7',
        trace: {
          id: 99,
          operation: 'increment',
          opType: 'event',
          tags: { event: ['increment', 2] },
        },
      },
    );

    socket.emit({
      type: 'eval-sub-to-client',
      payload: { evalId: 10, id: 'answer', args: [] },
    });
    socket.emit({
      type: 'eval-sub-to-client',
      payload: { evalId: 11, id: 'missing', args: [] },
    });
    socket.emit({
      type: 'eval-sub-to-client',
      payload: { evalId: 12, id: 'boom', args: [] },
    });
    await waitForTurn();

    assert.deepEqual(fake.evaluations, [['answer'], ['boom']]);
    const evaluationResults = socket.sent
      .filter((event) => event.type === 'reflex-eval-sub-result')
      .map((event) => event.payload);
    assert.deepEqual(evaluationResults.slice(0, 2), [
      { evalId: 10, value: 42 },
      {
        evalId: 11,
        error: {
          phase: 'missing-handler',
          message: "No subscription handler registered for 'missing'",
        },
      },
    ]);
    assert.equal(evaluationResults[2].evalId, 12);
    assert.equal(evaluationResults[2].error.phase, 'evaluation');
    assert.equal(evaluationResults[2].error.message, 'subscription exploded');
    assert.equal('stack' in evaluationResults[2].error, false);

    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 0 },
    });
    assert.equal(fake.unsubscribeCount, 1);
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });

    cleanup();
    cleanup();
    assert.equal(fake.unsubscribeCount, 2);
    assert.equal(socket.closeCount, 1);
    assert.equal(socket.readyState, FakeWebSocket.CLOSED);
  } finally {
    cleanup?.();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('cleanup prevents a late health check from opening a WebSocket', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;

  let resolveHealth;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      resolveHealth = resolve;
    });

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    cleanup();
    resolveHealth({ ok: true });
    await waitForTurn();
    await waitForTurn();

    assert.equal(fake.unsubscribeCount, 0);
    assert.equal(FakeWebSocket.instances.length, 0);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('fails closed when session bootstrap omits the protocol response header', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/health')) {
      return response({ protocolVersion: 1 });
    }
    return response(
      { protocolVersion: 1, token: 'runtime-test-token' },
      { protocolVersion: null },
    );
  };

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    assert.equal(FakeWebSocket.instances.length, 0);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('a replacement client disposes the previous one without stale cleanup crossing over', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;

  const first = createFakeInspector();
  const second = createFakeInspector();
  const cleanupFirst = enableDevtools(first.inspector);
  let cleanupSecond;

  try {
    await waitForTurn();
    await waitForTurn();
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });

    cleanupSecond = enableDevtools(second.inspector);
    assert.equal(first.unsubscribeCount, 1);
    assert.equal(firstSocket.readyState, FakeWebSocket.CLOSED);

    await waitForTurn();
    await waitForTurn();
    const secondSocket = FakeWebSocket.instances[1];
    assert.equal(secondSocket.readyState, FakeWebSocket.OPEN);
    secondSocket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });

    cleanupFirst();
    assert.equal(second.unsubscribeCount, 0);
    assert.equal(secondSocket.readyState, FakeWebSocket.OPEN);

    cleanupSecond();
    assert.equal(second.unsubscribeCount, 1);
    assert.equal(secondSocket.readyState, FakeWebSocket.CLOSED);
  } finally {
    cleanupFirst();
    cleanupSecond?.();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('cleanup closes a WebSocket that has not opened yet', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = false;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];
    assert.equal(socket.readyState, FakeWebSocket.CONNECTING);

    cleanup();
    assert.equal(fake.unsubscribeCount, 0);
    assert.equal(socket.readyState, FakeWebSocket.CLOSED);
  } finally {
    cleanup();
    FakeWebSocket.autoOpen = true;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('reconnects with a fresh loopback session after the server socket closes', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  let bootstrapCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/session')) bootstrapCalls++;
    return successfulFetch(url, init);
  };

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });
    assert.equal(fake.snapshotCount, 1);

    firstSocket.close();
    assert.equal(fake.unsubscribeCount, 1);

    await new Promise((resolve) => setTimeout(resolve, 550));
    await waitForTurn();
    await waitForTurn();

    assert.equal(FakeWebSocket.instances.length, 2);
    assert.equal(FakeWebSocket.instances[1].readyState, FakeWebSocket.OPEN);
    assert.equal(bootstrapCalls, 2);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('correlates concurrent same-name dispatch outcomes by opaque runtime id', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });
    socket.emit({
      type: 'dispatch-to-client',
      payload: {
        dispatchId: 'agent-first',
        eventName: 'same-event',
        params: [1],
      },
    });
    socket.emit({
      type: 'dispatch-to-client',
      payload: {
        dispatchId: 'agent-second',
        eventName: 'same-event',
        params: [2],
      },
    });

    await fake.emitTraces([
      {
        id: 2,
        operation: 'same-event',
        opType: 'event',
        tags: { event: fake.dispatches[1] },
      },
      {
        id: 1,
        operation: 'same-event',
        opType: 'event',
        tags: { event: fake.dispatches[0] },
      },
    ]);

    const results = socket.sent
      .filter((event) => event.type === 'reflex-dispatch-result')
      .map((event) => ({
        dispatchId: event.payload.dispatchId,
        traceId: event.payload.trace.id,
      }));
    assert.deepEqual(results, [
      { dispatchId: 'agent-second', traceId: 2 },
      { dispatchId: 'agent-first', traceId: 1 },
    ]);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('cleanup aborts in-flight HTTP fallback events', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = true;
  globalThis.WebSocket = FakeWebSocket;

  const eventSignals = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) {
      return response({ protocolVersion: 1 });
    }
    if (String(url).endsWith('/auth/session')) {
      return response({
        protocolVersion: 1,
        token: 'runtime-test-token',
      });
    }

    eventSignals.push(options.signal);
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true },
      );
    });
  };

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });
    await waitForTurn();

    assert.equal(eventSignals.length, 4);
    assert.ok(eventSignals.every((signal) => !signal.aborted));

    cleanup();
    assert.ok(eventSignals.every((signal) => signal.aborted));
  } finally {
    cleanup();
    FakeWebSocket.throwOnSend = false;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('redacts common secret keys before state and traces leave the runtime', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;

  const fake = createFakeInspector({
    user: {
      password: 'plain-text-password',
      apiKey: 'plain-text-api-key',
      displayName: 'Ada',
    },
  });
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });

    const stateEvent = socket.sent.find(
      (event) => event.type === 'reflex-app-db',
    );
    assert.equal(stateEvent.payload.user.password, '[REDACTED]');
    assert.equal(stateEvent.payload.user.apiKey, '[REDACTED]');
    assert.equal(stateEvent.payload.user.displayName, 'Ada');

    await fake.emitTraces([{
      id: 1,
      operation: 'login',
      opType: 'event',
      tags: {
        event: ['login', { access_token: 'trace-secret' }],
        patches: [{
          op: 'replace',
          path: ['user', 'password'],
          value: 'patch-secret',
        }],
      },
    }]);
    const traceEvent = socket.sent.find(
      (event) => event.type === 'reflex-traces',
    );
    assert.equal(
      traceEvent.payload[0].tags.event[1].access_token,
      '[REDACTED]',
    );
    assert.equal(
      traceEvent.payload[0].tags.patches[0].value,
      '[REDACTED]',
    );
    assert.doesNotMatch(
      JSON.stringify(socket.sent),
      /plain-text|trace-secret|patch-secret/,
    );
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('applies subscription-result redaction to evaluation errors before transport', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector, {
    redaction: {
      state(value, context) {
        if (
          context.dataKind === 'subscription-result'
          && value
          && typeof value === 'object'
          && 'message' in value
        ) {
          return { ...value, message: '[REDACTED:EVALUATION_ERROR]' };
        }
        return value;
      },
    },
  });

  try {
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];
    socket.emit({
      type: 'eval-sub-to-client',
      payload: { evalId: 'eval-secret', id: 'boom', args: [] },
    });
    await waitForTurn();

    const result = socket.sent.find(
      (event) =>
        event.type === 'reflex-eval-sub-result'
        && event.payload.evalId === 'eval-secret',
    );
    assert.equal(
      result.payload.error.message,
      '[REDACTED:EVALUATION_ERROR]',
    );
    assert.equal('stack' in result.payload.error, false);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('drops oversized telemetry before either transport and warns only once', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalWarn = console.warn;
  const originalRuntimePayloadBytes = FakeWebSocket.runtimePayloadBytes;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  FakeWebSocket.runtimePayloadBytes = 512;
  globalThis.WebSocket = FakeWebSocket;

  const eventRequests = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/event')) eventRequests.push(options);
    return successfulFetch(url, options);
  };
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));

  const marker = 'must-not-appear-in-diagnostics';
  const fake = createFakeInspector({
    marker,
    data: 'ä'.repeat(1024),
  });
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];

    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 0 },
    });
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });
    await waitForTurn();

    assert.equal(
      socket.sent.some((event) => event.type === 'reflex-app-db'),
      false,
    );
    assert.equal(eventRequests.length, 0);
    assert.equal(JSON.stringify(socket.sent).includes(marker), false);

    const payloadWarnings = warnings.filter((warning) =>
      warning.includes('Dropped "reflex-app-db" telemetry before transport'));
    assert.equal(payloadWarnings.length, 1);
    assert.match(payloadWarnings[0], /negotiated 512-byte runtime limit/);
    assert.match(payloadWarnings[0], /maxRuntimePayloadBytes/);
    assert.equal(payloadWarnings[0].includes(marker), false);
  } finally {
    cleanup();
    FakeWebSocket.runtimePayloadBytes = originalRuntimePayloadBytes;
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('deduplicates bounded server telemetry-drop notices', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalWarn = console.warn;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];
    const notice = {
      type: 'devtools-error',
      payload: {
        code: 'RUNTIME_TELEMETRY_DROPPED',
        reason: 'retention-limit',
        eventType: 'reflex-app-db',
      },
      timestamp: Date.now(),
    };
    socket.emit(notice);
    socket.emit(notice);

    const noticeWarnings = warnings.filter((warning) =>
      warning.includes('Server dropped "reflex-app-db" telemetry'));
    assert.equal(noticeWarnings.length, 1);
    assert.match(noticeWarnings[0], /retention-limit/);
    assert.match(noticeWarnings[0], /reconnecting the runtime clears session retention/);
  } finally {
    cleanup();
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('handles typed retention rejection from the HTTP fallback without reconnecting', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalWarn = console.warn;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = true;
  globalThis.WebSocket = FakeWebSocket;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  let stateRequests = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).endsWith('/event')) {
      return successfulFetch(url, options);
    }
    const event = JSON.parse(options.body);
    if (event.type !== 'reflex-app-db') return response({ success: true });
    stateRequests++;
    return response(
      {
        success: false,
        code: 'RUNTIME_TELEMETRY_DROPPED',
        reason: 'retention-limit',
        eventType: 'reflex-app-db',
        error: 'Runtime telemetry was not retained.',
      },
      { ok: false, status: 422 },
    );
  };

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    const socket = FakeWebSocket.instances[0];
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 0 },
    });
    socket.emit({
      type: 'ui-connection-status',
      payload: { connectedUIs: 1 },
    });
    await waitForTurn();
    await waitForTurn();

    assert.equal(stateRequests, 2);
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(socket.readyState, FakeWebSocket.OPEN);
    const dropWarnings = warnings.filter((warning) =>
      warning.includes('Server dropped "reflex-app-db" telemetry'));
    assert.equal(dropWarnings.length, 1);
    assert.equal(
      warnings.some((warning) => warning.includes('rejected with HTTP 422')),
      false,
    );
  } finally {
    cleanup();
    FakeWebSocket.throwOnSend = false;
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('reports abnormal closes and preserves exponential reconnect backoff until stable', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalWarn = console.warn;
  const originalRandom = Math.random;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = successfulFetch;
  Math.random = () => 0;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));

  const fake = createFakeInspector();
  const cleanup = enableDevtools(fake.inspector);

  try {
    await waitForTurn();
    await waitForTurn();
    FakeWebSocket.instances[0].close(1009, 'Message exceeds frame limit');

    await new Promise((resolve) => setTimeout(resolve, 300));
    await waitForTurn();
    assert.equal(FakeWebSocket.instances.length, 2);

    FakeWebSocket.instances[1].close(1009, 'Message exceeds frame limit');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      FakeWebSocket.instances.length,
      2,
      'a successful hello must not reset reconnect backoff immediately',
    );

    await new Promise((resolve) => setTimeout(resolve, 250));
    await waitForTurn();
    assert.equal(FakeWebSocket.instances.length, 3);

    const closeWarnings = warnings.filter((warning) =>
      warning.includes('WebSocket closed abnormally'));
    assert.equal(closeWarnings.length, 1);
    assert.match(closeWarnings[0], /code 1009/);
    assert.match(closeWarnings[0], /Message exceeds frame limit/);
    assert.match(closeWarnings[0], /bounded backoff/);
  } finally {
    cleanup();
    console.warn = originalWarn;
    Math.random = originalRandom;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});
