import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DevToolsAPIClient,
  DevToolsServerUnavailableError,
  REFLEX_DEVTOOLS_PROTOCOL_VERSION,
} from '../dist/httpClient.js';
import { appStatusTool } from '../dist/tools/appStatus.js';
import { dispatchEventTool } from '../dist/tools/dispatchEvent.js';
import { dispatchAndWaitTool } from '../dist/tools/dispatchAndWait.js';
import { evalSubTool } from '../dist/tools/evalSub.js';
import { getActiveSubsTool } from '../dist/tools/getActiveSubs.js';
import { getAppStateTool } from '../dist/tools/getAppState.js';
import { getHandlersTool } from '../dist/tools/getHandlers.js';
import { getTraceTool } from '../dist/tools/getTrace.js';
import { getTracesTool } from '../dist/tools/getTraces.js';

const PROTOCOL_HEADER = 'reflex-devtools-protocol-version';
const CLIENT_HEADER = 'x-reflex-client';
const SESSION_TOKEN = 'unit-test-mcp-token';

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, body, protocolVersion = REFLEX_DEVTOOLS_PROTOCOL_VERSION) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Reflex-DevTools-Protocol-Version': String(protocolVersion),
  });
  res.end(JSON.stringify(body));
}

test('app_status reports a healthy headless session without hints', async () => {
  const apiClient = {
    async getStatus() {
      return {
        success: true,
        mcpEnabled: true,
        appConnected: true,
        connectedApps: 1,
        connectedUIs: 0,
        sessionEpoch: 3,
        runtime: 'headless',
        effectMode: 'safe',
        effects: { 'local-storage-set': 'memory' },
        tracing: true,
        handlers: { event: 14, fx: 3, cofx: 1, sub: 9 },
        stateAvailable: true,
        traceCount: 42,
        capabilities: ['inspect', 'dispatch'],
        readOnly: false,
        protocol: {
          version: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
          runtimeVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
          inspectorApiVersion: 2,
        },
        security: {
          authenticated: true,
          loopbackOnly: true,
          redactionEnabled: true,
          auditEnabled: true,
        },
      };
    },
  };

  const body = parseToolResult(await appStatusTool(apiClient).handler({}));

  assert.equal(body.appConnected, true);
  assert.equal(body.sessionEpoch, 3);
  assert.equal(body.runtime, 'headless');
  assert.equal(body.effectMode, 'safe');
  assert.deepEqual(body.effects, { 'local-storage-set': 'memory' });
  assert.equal(body.tracing, true);
  assert.deepEqual(body.handlers, { event: 14, fx: 3, cofx: 1, sub: 9 });
  assert.deepEqual(body.capabilities, ['inspect', 'dispatch']);
  assert.equal(body.readOnly, false);
  assert.equal(body.protocol.version, REFLEX_DEVTOOLS_PROTOCOL_VERSION);
  assert.equal(body.security.authenticated, true);
  assert.equal('hints' in body, false);
  assert.equal('connectedApps' in body, false);
});

test('every MCP tool accepts runtimeId, routes it, and surfaces runtime identity', async () => {
  const runtimeId = 'runtime-b';
  const identity = {
    runtimeId,
    runtimeName: 'Checkout preview',
    sessionEpoch: 7,
  };
  const apiClient = {
    async getStatus(selected) {
      assert.equal(selected, runtimeId);
      return {
        ...identity,
        selectedRuntimeId: runtimeId,
        runtimes: [{ ...identity, connected: true, runtime: 'browser' }],
        appConnected: true,
        mcpEnabled: true,
        runtime: 'browser',
        tracing: true,
        handlers: { event: 1, fx: 0, cofx: 0, sub: 1 },
        stateAvailable: true,
        traceCount: 1,
        capabilities: ['inspect', 'dispatch'],
        readOnly: false,
        protocol: { version: REFLEX_DEVTOOLS_PROTOCOL_VERSION },
        security: { authenticated: true },
      };
    },
    async getTraces(params) {
      assert.equal(params.runtimeId, runtimeId);
      return { ...identity, traces: [], stats: {} };
    },
    async getTrace(id, selected, sessionEpoch) {
      assert.equal(id, 4);
      assert.equal(selected, runtimeId);
      assert.equal(sessionEpoch, identity.sessionEpoch);
      return { ...identity, trace: { id } };
    },
    async getAppState(path, selected) {
      assert.equal(path, 'cart');
      assert.equal(selected, runtimeId);
      return { ...identity, state: { total: 12 } };
    },
    async getHandlers(type, selected) {
      assert.equal(type, 'event');
      assert.equal(selected, runtimeId);
      return {
        ...identity,
        handlerKeys: { event: ['checkout'] },
      };
    },
    async getSubscriptions(filter, selected) {
      assert.equal(filter, 'cart');
      assert.equal(selected, runtimeId);
      return { ...identity, total: 1, subscriptions: { '["cart"]': 12 } };
    },
    async evalSub(id, args, selected) {
      assert.equal(id, 'cart');
      assert.deepEqual(args, []);
      assert.equal(selected, runtimeId);
      return { ...identity, value: 12 };
    },
    async dispatchEvent(eventName, params, selected) {
      assert.equal(eventName, 'checkout');
      assert.deepEqual(params, []);
      assert.equal(selected, runtimeId);
      return { ...identity, outcome: 'succeeded', patches: [], effects: [] };
    },
  };

  const tools = [
    appStatusTool(apiClient),
    getTracesTool(apiClient),
    getTraceTool(apiClient),
    getAppStateTool(apiClient),
    getHandlersTool(apiClient),
    getActiveSubsTool(apiClient),
    evalSubTool(apiClient),
    dispatchEventTool(apiClient),
  ];
  for (const tool of tools) {
    assert.ok(tool.inputSchema.properties.runtimeId, `${tool.name} must expose runtimeId`);
  }
  assert.ok(tools[2].inputSchema.properties.sessionEpoch);

  const calls = [
    tools[0].handler({ runtimeId }),
    tools[1].handler({ runtimeId }),
    tools[2].handler({ id: 4, runtimeId, sessionEpoch: identity.sessionEpoch }),
    tools[3].handler({ path: 'cart', runtimeId }),
    tools[4].handler({ type: 'event', runtimeId }),
    tools[5].handler({ filter: 'cart', runtimeId }),
    tools[6].handler({ id: 'cart', runtimeId }),
    tools[7].handler({ eventName: 'checkout', runtimeId }),
  ];
  for (const call of calls) {
    const body = parseToolResult(await call);
    assert.equal(body.runtimeId, runtimeId);
    assert.equal(body.runtimeName, identity.runtimeName);
    assert.equal(body.sessionEpoch, identity.sessionEpoch);
  }
});

test('runtime selection errors preserve the available runtime list', async () => {
  const runtimes = [
    {
      runtimeId: 'runtime-a',
      runtimeName: 'Admin',
      connected: true,
      sessionEpoch: 2,
      runtime: 'browser',
    },
    {
      runtimeId: 'runtime-b',
      runtimeName: 'Worker',
      connected: true,
      sessionEpoch: 5,
      runtime: 'headless',
    },
  ];
  const apiClient = {
    async getStatus() {
      const error = new Error('runtimeId is required because multiple runtimes are connected.');
      error.code = 'RUNTIME_SELECTION_REQUIRED';
      error.details = {
        success: false,
        code: error.code,
        error: error.message,
        selectedRuntimeId: null,
        runtimes,
      };
      throw error;
    },
  };

  const result = await appStatusTool(apiClient).handler({});
  const body = parseToolResult(result);

  assert.equal(result.isError, true);
  assert.equal(body.code, 'RUNTIME_SELECTION_REQUIRED');
  assert.equal(body.selectedRuntimeId, null);
  assert.deepEqual(body.runtimes, runtimes);
  assert.match(body.hint, /retry.*runtimeId/i);
});

test('get_trace surfaces an explicit session reset conflict', async () => {
  const apiClient = {
    async getTrace(id, runtimeId, sessionEpoch) {
      assert.equal(id, 7);
      assert.equal(runtimeId, 'runtime-a');
      assert.equal(sessionEpoch, 2);
      const error = new Error('Runtime runtime-a is now in session epoch 3.');
      error.code = 'SESSION_EPOCH_MISMATCH';
      error.details = {
        success: false,
        code: error.code,
        error: error.message,
        runtimeId,
        runtimeName: 'Runtime A',
        expectedSessionEpoch: sessionEpoch,
        sessionEpoch: 3,
      };
      throw error;
    },
  };

  const result = await getTraceTool(apiClient).handler({
    id: 7,
    runtimeId: 'runtime-a',
    sessionEpoch: 2,
  });
  const body = parseToolResult(result);

  assert.equal(result.isError, true);
  assert.equal(body.code, 'SESSION_EPOCH_MISMATCH');
  assert.equal(body.expectedSessionEpoch, 2);
  assert.equal(body.sessionEpoch, 3);
  assert.match(body.hint, /discard trace ids/i);
});

test('app_status explains a disconnected, read-only app and a missing --mcp flag', async () => {
  const apiClient = {
    async getStatus() {
      return {
        success: true,
        mcpEnabled: false,
        appConnected: false,
        connectedApps: 0,
        connectedUIs: 0,
        sessionEpoch: 0,
        runtime: null,
        effectMode: null,
        effects: null,
        tracing: null,
        handlers: null,
        stateAvailable: false,
        traceCount: 0,
        capabilities: ['inspect'],
        readOnly: true,
        protocol: {
          version: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
          runtimeVersion: null,
          inspectorApiVersion: null,
        },
        security: {
          authenticated: true,
          loopbackOnly: true,
          redactionEnabled: true,
          auditEnabled: true,
        },
      };
    },
  };

  const body = parseToolResult(await appStatusTool(apiClient).handler({}));

  assert.equal(body.appConnected, false);
  assert.equal(body.mcpEnabled, false);
  assert.equal('effectMode' in body, false);
  assert.equal('effects' in body, false);
  assert.deepEqual(body.capabilities, ['inspect']);
  assert.equal(body.readOnly, true);
  assert.equal(body.hints.length, 3);
  assert.match(body.hints[0], /--mcp/);
  assert.match(body.hints[1], /headless/);
  assert.match(body.hints[2], /read-only/);
});

test('get_handlers tells the agent how to start the DevTools server when unreachable', async () => {
  const apiClient = {
    async getHandlers() {
      throw new DevToolsServerUnavailableError('127.0.0.1:4000');
    },
  };

  const result = await getHandlersTool(apiClient).handler({ type: 'event' });
  const body = parseToolResult(result);

  assert.equal(result.isError, true);
  assert.equal(body.error, 'No Reflex DevTools server is connected.');
  assert.match(body.message, /Start the project-local DevTools script from the project root/);
  assert.match(body.message, /npm run devtools:mcp/);
  assert.match(body.message, /If the script is missing, add "devtools:mcp"/);
  assert.match(body.message, /Then reload the app and retry get_handlers\./);
  assert.equal(body.command, 'npm run devtools:mcp');
  assert.equal(body.retry, 'get_handlers');
});

test('get_app_state returns only the requested state slice', async () => {
  const apiClient = {
    async getAppState(path) {
      assert.equal(path, 'user.profile');
      return {
        state: { id: 'u1', name: 'Ada' },
      };
    },
  };

  const result = await getAppStateTool(apiClient).handler({ path: 'user.profile' });
  const body = parseToolResult(result);

  assert.equal(body.path, 'user.profile');
  assert.deepEqual(body.state, { id: 'u1', name: 'Ada' });
  assert.equal('unrelated' in body, false);
});

test('get_traces returns compact rows without full trace tags', async () => {
  const apiClient = {
    async getTraces(params) {
      assert.deepEqual(params, {
        limit: 10,
        eventFilter: undefined,
        minDuration: undefined,
        opType: undefined,
      });

      return {
        stats: {
          totalTraces: 1,
          eventTraces: 1,
          renderTraces: 0,
        },
        traces: [
          {
            id: 7,
            operation: 'save-user',
            opType: 'event',
            duration: 4.25,
            start: 0,
            childOf: 'undefined',
            tags: {
              event: ['save-user', { id: 1 }],
              patches: [{ op: 'replace', path: ['user'], value: { id: 1 } }],
              effects: [['persist-user']],
              error: { phase: 'handler', message: 'boom' },
              effectErrorCount: 1,
            },
          },
        ],
      };
    },
  };

  const result = await getTracesTool(apiClient).handler({ limit: 10 });
  const body = parseToolResult(result);
  const row = body.traces[0];

  assert.equal(body.summary.returned, 1);
  assert.equal(row.id, 7);
  assert.equal(row.duration, '4.25ms');
  assert.equal(row.error, 'handler: boom');
  assert.equal(row.effectErrors, 1);
  assert.equal('tags' in row, false);
  assert.equal('patches' in row, false);
  assert.equal('effects' in row, false);
  assert.equal('childOf' in row, false);
});

test('get_active_subs passes the server-side filter and returns compact values', async () => {
  const apiClient = {
    async getSubscriptions(filter) {
      assert.equal(filter, 'user');
      return {
        total: 5,
        subscriptions: {
          '["current-user"]': { id: 'u1', name: 'Ada' },
          '["user-role"]': 'admin',
        },
      };
    },
  };

  const result = await getActiveSubsTool(apiClient).handler({ filter: 'user' });
  const body = parseToolResult(result);

  assert.deepEqual(body.summary, { total: 5, filtered: 2 });
  assert.deepEqual(body.subscriptions, [
    { key: '["current-user"]', value: { id: 'u1', name: 'Ada' } },
    { key: '["user-role"]', value: 'admin' },
  ]);
});

test('get_trace removes reversePatches from MCP output', async () => {
  const apiClient = {
    async getTrace(id) {
      assert.equal(id, 42);

      return {
        trace: {
          id: 42,
          tags: {
            patches: [{ op: 'replace', path: ['counter'], value: 1 }],
            reversePatches: [{ op: 'replace', path: ['counter'], value: 0 }],
          },
        },
      };
    },
  };

  const result = await getTraceTool(apiClient).handler({ id: 42 });
  const body = parseToolResult(result);

  assert.deepEqual(body.trace.tags.patches, [
    { op: 'replace', path: ['counter'], value: 1 },
  ]);
  assert.equal('reversePatches' in body.trace.tags, false);
});

test('dispatch_event formats failed outcomes with actionable hints', async () => {
  const apiClient = {
    async dispatchEvent(eventName, params) {
      assert.equal(eventName, 'missing-handler');
      assert.deepEqual(params, [{ id: 1 }]);

      return {
        outcome: 'failed',
        traceId: 9,
        error: {
          phase: 'missing-handler',
          message: 'No handler registered',
        },
      };
    },
  };

  const result = await dispatchEventTool(apiClient).handler({
    eventName: 'missing-handler',
    params: [{ id: 1 }],
  });
  const body = parseToolResult(result);

  assert.equal(body.outcome, 'failed');
  assert.equal(body.traceId, 9);
  assert.equal(body.error.phase, 'missing-handler');
  assert.match(body.hint, /get_handlers/);
  assert.equal('params' in body, false);
});

test('dispatch_and_wait returns the complete operation receipt as structured content', async () => {
  const apiClient = {
    async dispatchAndWait(eventName, params, runtimeId) {
      assert.equal(eventName, 'increment-counter');
      assert.deepEqual(params, [2]);
      assert.equal(runtimeId, 'headless-runtime');
      return {
        requestId: 'request-1',
        runtimeId,
        runtimeName: 'Headless runtime',
        sessionEpoch: 4,
        receipt: {
          operation: {
            operationId: 'headless-runtime:instance:1:op:1',
            outcome: 'succeeded',
            subscriptions: {
              status: 'settled',
              publishedRevision: 2,
              recalculated: [{ query: ['counter'], value: 2 }],
            },
          },
          delivery: { status: 'settled', timeoutMs: null },
          replayed: false,
        },
      };
    },
  };

  const result = await dispatchAndWaitTool(apiClient).handler({
    eventName: 'increment-counter',
    params: [2],
    runtimeId: 'headless-runtime',
  });
  const body = parseToolResult(result);

  assert.equal(body.requestId, 'request-1');
  assert.deepEqual(body.receipt.operation.subscriptions.recalculated, [
    { query: ['counter'], value: 2 },
  ]);
  assert.deepEqual(result.structuredContent, body);
});

test('eval_sub returns the value for an unmounted parameterized subscription', async () => {
  const apiClient = {
    async evalSub(id, args) {
      assert.equal(id, 'user-by-id');
      assert.deepEqual(args, [7]);
      return { success: true, value: { id: 7, name: 'Ada' } };
    },
  };

  const result = await evalSubTool(apiClient).handler({ id: 'user-by-id', args: [7] });
  const body = parseToolResult(result);

  assert.equal(result.isError, undefined);
  assert.equal(body.id, 'user-by-id');
  assert.equal('args' in body, false);
  assert.deepEqual(body.value, { id: 7, name: 'Ada' });
});

test('eval_sub gives missing subscription ids an actionable hint', async () => {
  const apiClient = {
    async evalSub() {
      const error = new Error("No subscription handler registered for 'missing-sub'");
      error.details = { phase: 'missing-handler', message: error.message };
      throw error;
    },
  };

  const result = await evalSubTool(apiClient).handler({ id: 'missing-sub' });
  const body = parseToolResult(result);

  assert.equal(result.isError, true);
  assert.equal(body.details.phase, 'missing-handler');
  assert.match(body.hint, /get_handlers/);
});

test('DevToolsAPIClient refuses remote plaintext bearer-token transport', () => {
  assert.throws(
    () => new DevToolsAPIClient({
      serverUrl: 'http://devtools.example:4000',
      token: 'x'.repeat(43),
    }),
    /remote plaintext HTTP/,
  );
  assert.doesNotThrow(
    () => new DevToolsAPIClient({
      serverUrl: 'http://devtools.example:4000',
      token: 'x'.repeat(43),
      allowInsecureRemote: true,
    }),
  );
});

test('DevToolsAPIClient sends runtimeId in read queries and mutation bodies', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({
      path: `${url.pathname}${url.search}`,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    const response = url.pathname === '/api/status'
      ? {
          success: true,
          protocol: { version: REFLEX_DEVTOOLS_PROTOCOL_VERSION },
        }
      : { success: true };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Reflex-DevTools-Protocol-Version': String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
      },
    });
  };

  try {
    const apiClient = new DevToolsAPIClient({
      serverUrl: 'http://127.0.0.1:4000',
      token: 'configured-token',
    });
    await apiClient.getStatus('runtime-b');
    await apiClient.getTraces({ limit: 5, runtimeId: 'runtime-b' });
    await apiClient.getTrace(8, 'runtime-b', 7);
    await apiClient.getAppState('user.profile', 'runtime-b');
    await apiClient.getSubscriptions('user', 'runtime-b');
    await apiClient.getHandlers('event', 'runtime-b');
    await apiClient.getStats('runtime-b');
    await apiClient.dispatchEvent('save', [1], 'runtime-b');
    await apiClient.evalSub('current-user', [1], 'runtime-b');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests, [
    { path: '/api/status?runtimeId=runtime-b', method: 'GET', body: null },
    { path: '/api/traces?limit=5&runtimeId=runtime-b', method: 'GET', body: null },
    { path: '/api/traces/8?runtimeId=runtime-b&sessionEpoch=7', method: 'GET', body: null },
    { path: '/api/state?path=user.profile&runtimeId=runtime-b', method: 'GET', body: null },
    { path: '/api/subscriptions?filter=user&runtimeId=runtime-b', method: 'GET', body: null },
    { path: '/api/handlers?type=event&runtimeId=runtime-b', method: 'GET', body: null },
    { path: '/api/stats?runtimeId=runtime-b', method: 'GET', body: null },
    {
      path: '/api/dispatch',
      method: 'POST',
      body: { eventName: 'save', params: [1], runtimeId: 'runtime-b' },
    },
    {
      path: '/api/eval-sub',
      method: 'POST',
      body: { id: 'current-user', args: [1], runtimeId: 'runtime-b' },
    },
  ]);
});

test('DevToolsAPIClient surfaces trace lookup errors from the server body', async () => {
  const requests = [];
  const httpServer = createServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      protocolVersion: req.headers[PROTOCOL_HEADER],
      client: req.headers[CLIENT_HEADER],
    });

    if (req.method === 'POST' && req.url === '/auth/session') {
      assert.equal(
        req.headers[PROTOCOL_HEADER],
        String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
      );
      assert.equal(req.headers[CLIENT_HEADER], 'mcp-unit-test');
      assert.equal(req.headers.authorization, undefined);
      assert.deepEqual(await readJson(req), { role: 'mcp' });
      sendJson(res, 200, {
        success: true,
        role: 'mcp',
        token: SESSION_TOKEN,
        capabilities: ['inspect'],
        protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
      });
      return;
    }

    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/traces/99?runtimeId=runtime-b');
    assert.equal(req.headers.authorization, `Bearer ${SESSION_TOKEN}`);
    assert.equal(
      req.headers[PROTOCOL_HEADER],
      String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
    );
    assert.equal(req.headers[CLIENT_HEADER], 'mcp-unit-test');
    sendJson(res, 404, {
      success: false,
      code: 'TRACE_NOT_FOUND',
      error: 'No trace with id 99',
    });
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = httpServer.address();
    assert(address && typeof address === 'object');

    const apiClient = new DevToolsAPIClient({
      serverUrl: `127.0.0.1:${address.port}`,
      clientName: 'mcp-unit-test',
    });

    await assert.rejects(
      () => apiClient.getTrace(99, 'runtime-b'),
      (error) => {
        assert.match(error.message, /No trace with id 99/);
        assert.equal(error.code, 'TRACE_NOT_FOUND');
        assert.equal(error.details.code, 'TRACE_NOT_FOUND');
        return true;
      },
    );
    assert.deepEqual(
      requests.map(({ method, url }) => `${method} ${url}`),
      ['POST /auth/session', 'GET /api/traces/99?runtimeId=runtime-b'],
    );
  } finally {
    await new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test('DevToolsAPIClient uses an explicit token and validates status protocol metadata', async () => {
  const requests = [];
  const httpServer = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/status');
    assert.equal(req.headers.authorization, 'Bearer configured-token');
    assert.equal(
      req.headers[PROTOCOL_HEADER],
      String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
    );
    assert.equal(req.headers[CLIENT_HEADER], 'remote-mcp');
    sendJson(res, 200, {
      success: true,
      capabilities: ['inspect'],
      protocol: {
        version: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
        runtimeVersion: null,
        inspectorApiVersion: null,
      },
    });
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = httpServer.address();
    assert(address && typeof address === 'object');
    const apiClient = new DevToolsAPIClient({
      serverUrl: `http://127.0.0.1:${address.port}/`,
      token: 'configured-token',
      clientName: 'remote-mcp',
    });

    const status = await apiClient.getStatus();
    assert.deepEqual(status.capabilities, ['inspect']);
    assert.deepEqual(requests, ['GET /api/status']);
  } finally {
    await new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test('DevToolsAPIClient rejects incompatible protocol response headers', async () => {
  const httpServer = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer configured-token');
    sendJson(res, 200, { success: true }, REFLEX_DEVTOOLS_PROTOCOL_VERSION + 1);
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = httpServer.address();
    assert(address && typeof address === 'object');
    const apiClient = new DevToolsAPIClient({
      serverUrl: `127.0.0.1:${address.port}`,
      token: 'configured-token',
    });

    await assert.rejects(
      () => apiClient.getTrace(1),
      new RegExp(
        `Incompatible Reflex DevTools protocol.*received ${REFLEX_DEVTOOLS_PROTOCOL_VERSION + 1}`,
      ),
    );
  } finally {
    await new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test('DevToolsAPIClient rejects incompatible protocol metadata in /api/status', async () => {
  const httpServer = createServer((req, res) => {
    assert.equal(req.url, '/api/status');
    sendJson(res, 200, {
      success: true,
      capabilities: ['inspect'],
      protocol: {
        version: REFLEX_DEVTOOLS_PROTOCOL_VERSION + 1,
        runtimeVersion: null,
        inspectorApiVersion: null,
      },
    });
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = httpServer.address();
    assert(address && typeof address === 'object');
    const apiClient = new DevToolsAPIClient({
      serverUrl: `127.0.0.1:${address.port}`,
      token: 'configured-token',
    });

    await assert.rejects(
      () => apiClient.getStatus(),
      new RegExp(
        `Incompatible Reflex DevTools protocol.*received ${REFLEX_DEVTOOLS_PROTOCOL_VERSION + 1}`,
      ),
    );
  } finally {
    await new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
