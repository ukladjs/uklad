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

  readyState = FakeWebSocket.CONNECTING;
  sent = [];
  closeCount = 0;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    if (!FakeWebSocket.autoOpen) return;
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.({});
    });
  }

  send(data) {
    if (FakeWebSocket.throwOnSend) {
      throw new Error('WebSocket send failed');
    }
    this.sent.push(JSON.parse(data));
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closeCount++;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  emit(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function createFakeInspector() {
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
        appDb: { count: 1 },
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

test('uses only the injected inspector and returns idempotent cleanup', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async () => ({ ok: true });

  const fake = createFakeInspector();
  let cleanup;

  try {
    assert.throws(() => enableDevtools({ serverUrl: 'localhost:4000' }), /createReflexInspector/);

    cleanup = enableDevtools(fake.inspector, { serverUrl: 'devtools.test' });
    assert.equal(typeof cleanup, 'function');

    await waitForTurn();
    await waitForTurn();

    assert.equal(FakeWebSocket.instances.length, 1);
    const socket = FakeWebSocket.instances[0];
    assert.equal(socket.url, 'ws://devtools.test/sdk');
    assert.equal(socket.readyState, FakeWebSocket.OPEN);
    assert.equal(fake.unsubscribeCount, 0);
    assert.equal(fake.snapshotCount, 0);
    assert.deepEqual(socket.sent, []);

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
        dispatchId: 7,
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
        tags: {},
      },
    ]);
    assert.ok(socket.sent.some((event) => event.type === 'reflex-traces'));
    assert.deepEqual(
      socket.sent.find((event) => event.type === 'reflex-dispatch-result')?.payload,
      {
        dispatchId: 7,
        trace: {
          id: 99,
          operation: 'increment',
          opType: 'event',
          tags: {},
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
    assert.equal(typeof evaluationResults[2].error.stack, 'string');

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

test('a replacement client disposes the previous one without stale cleanup crossing over', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOpen = true;
  FakeWebSocket.throwOnSend = false;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async () => ({ ok: true });

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
  globalThis.fetch = async () => ({ ok: true });

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
      return { ok: true };
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
