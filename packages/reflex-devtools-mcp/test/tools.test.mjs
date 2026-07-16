import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DevToolsAPIClient, DevToolsServerUnavailableError } from '../dist/httpClient.js';
import { appStatusTool } from '../dist/tools/appStatus.js';
import { dispatchEventTool } from '../dist/tools/dispatchEvent.js';
import { evalSubTool } from '../dist/tools/evalSub.js';
import { getAppStateTool } from '../dist/tools/getAppState.js';
import { getHandlersTool } from '../dist/tools/getHandlers.js';
import { getTraceTool } from '../dist/tools/getTrace.js';
import { getTracesTool } from '../dist/tools/getTraces.js';

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
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
  assert.equal('hints' in body, false);
  assert.equal('connectedApps' in body, false);
});

test('app_status explains a disconnected app and a missing --mcp flag', async () => {
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
      };
    },
  };

  const body = parseToolResult(await appStatusTool(apiClient).handler({}));

  assert.equal(body.appConnected, false);
  assert.equal(body.mcpEnabled, false);
  assert.equal('effectMode' in body, false);
  assert.equal('effects' in body, false);
  assert.equal(body.hints.length, 2);
  assert.match(body.hints[0], /--mcp/);
  assert.match(body.hints[1], /headless/);
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
    async getAppState() {
      return {
        state: {
          user: { profile: { id: 'u1', name: 'Ada' } },
          unrelated: { large: ['do-not-return'] },
        },
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
              effectErrors: [{ effect: 'persist-user', message: 'failed' }],
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
  assert.deepEqual(body.args, [7]);
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

test('DevToolsAPIClient surfaces trace lookup errors from the server body', async () => {
  const httpServer = createServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'No trace with id 99',
    }));
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = httpServer.address();
    assert(address && typeof address === 'object');

    const apiClient = new DevToolsAPIClient({
      serverUrl: `127.0.0.1:${address.port}`,
    });

    await assert.rejects(
      () => apiClient.getTrace(99),
      /No trace with id 99/,
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
