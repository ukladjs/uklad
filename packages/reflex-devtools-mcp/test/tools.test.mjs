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
          inspectorApiVersion: 1,
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
    async getStats() {
      return {
        stats: {
          totalTraces: 1,
          eventTraces: 1,
          renderTraces: 0,
        },
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
    assert.equal(req.url, '/api/traces/99');
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
      () => apiClient.getTrace(99),
      (error) => {
        assert.match(error.message, /No trace with id 99/);
        assert.equal(error.code, 'TRACE_NOT_FOUND');
        assert.equal(error.details.code, 'TRACE_NOT_FOUND');
        return true;
      },
    );
    assert.deepEqual(
      requests.map(({ method, url }) => `${method} ${url}`),
      ['POST /auth/session', 'GET /api/traces/99'],
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
      /Incompatible Reflex DevTools protocol.*received 2/,
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
      /Incompatible Reflex DevTools protocol.*received 2/,
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
