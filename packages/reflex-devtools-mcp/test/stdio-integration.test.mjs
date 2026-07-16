import { createServer } from 'node:http';
import process from 'node:process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function parseToolResult(result) {
  assert.equal(result.content?.[0]?.type, 'text');
  return JSON.parse(result.content[0].text);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
  }

  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startFakeDevtoolsServer() {
  const dispatchRequests = [];
  const evalSubRequests = [];

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok', connectedClients: 1 });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, {
          success: true,
          mcpEnabled: true,
          appConnected: true,
          connectedApps: 1,
          connectedUIs: 0,
          sessionEpoch: 1,
          runtime: 'headless',
          effectMode: 'safe',
          effects: { 'fake-effect': 'real' },
          tracing: true,
          handlers: { event: 1, fx: 1, cofx: 0, sub: 1 },
          stateAvailable: true,
          traceCount: 0,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/handlers') {
        sendJson(res, 200, {
          success: true,
          handlerKeys: {
            event: ['fake-event'],
            fx: ['fake-effect'],
            cofx: [],
            sub: ['counter'],
          },
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/dispatch') {
        const body = await readJson(req);
        dispatchRequests.push(body);

        if (body.eventName === 'missing-handler') {
          sendJson(res, 200, {
            success: true,
            outcome: 'failed',
            traceId: 102,
            error: {
              phase: 'missing-handler',
              message: 'no event handler registered for: missing-handler',
              eventV: ['missing-handler'],
            },
          });
          return;
        }

        sendJson(res, 200, {
          success: true,
          outcome: 'succeeded',
          traceId: 101,
          event: [body.eventName, ...(body.params || [])],
          duration: 0,
          patches: [],
          effects: [['fake-effect', 123]],
        });
      } else if (req.method === 'POST' && url.pathname === '/api/eval-sub') {
        const body = await readJson(req);
        evalSubRequests.push(body);
        sendJson(res, 200, {
          success: true,
          value: { counter: 2, multiplier: body.args?.[0] },
        });
      } else {
        sendJson(res, 404, { success: false, error: `Unhandled ${req.method} ${url.pathname}` });
      }
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  assert(address && typeof address === 'object');

  return {
    dispatchRequests,
    evalSubRequests,
    port: address.port,
    close: () => new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}

test('stdio MCP server lists tools and dispatches events through the DevTools HTTP API', async () => {
  const fakeDevtools = await startFakeDevtoolsServer();
  const client = new Client(
    { name: 'reflex-devtools-mcp-integration-test', version: '0.0.0' },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, '--host', '127.0.0.1', '--port', String(fakeDevtools.port)],
    stderr: 'ignore',
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        'app_status',
        'dispatch_event',
        'eval_sub',
        'get_active_subs',
        'get_app_state',
        'get_handlers',
        'get_trace',
        'get_traces',
      ],
    );

    // The initialize-time instructions are the agent's primary usage docs:
    // they must be advertised and must mention every tool the server exposes.
    const instructions = client.getInstructions();
    assert.ok(instructions && instructions.length > 0, 'server should advertise instructions');
    for (const tool of tools.tools) {
      assert.ok(instructions.includes(tool.name), `instructions should mention ${tool.name}`);
    }
    assert.match(instructions, /--mcp/);

    const status = parseToolResult(await client.callTool({
      name: 'app_status',
      arguments: {},
    }));
    assert.equal(status.appConnected, true);
    assert.equal(status.runtime, 'headless');
    assert.equal(status.sessionEpoch, 1);

    const handlers = parseToolResult(await client.callTool({
      name: 'get_handlers',
      arguments: { type: 'event' },
    }));
    assert.deepEqual(handlers.handlers.event.handlers, ['fake-event']);

    const succeeded = parseToolResult(await client.callTool({
      name: 'dispatch_event',
      arguments: { eventName: 'fake-event', params: [2, { name: 'Smoke Test' }] },
    }));
    assert.equal(succeeded.outcome, 'succeeded');
    assert.equal(succeeded.traceId, 101);
    assert.deepEqual(succeeded.effectsEmitted, [['fake-effect', 123]]);

    const subValue = parseToolResult(await client.callTool({
      name: 'eval_sub',
      arguments: { id: 'counter', args: [3] },
    }));
    assert.equal(subValue.id, 'counter');
    assert.deepEqual(subValue.value, { counter: 2, multiplier: 3 });

    const failed = parseToolResult(await client.callTool({
      name: 'dispatch_event',
      arguments: { eventName: 'missing-handler', params: [] },
    }));
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.error.phase, 'missing-handler');
    assert.match(failed.hint, /get_handlers/);

    assert.deepEqual(fakeDevtools.dispatchRequests, [
      { eventName: 'fake-event', params: [2, { name: 'Smoke Test' }] },
      { eventName: 'missing-handler', params: [] },
    ]);
    assert.deepEqual(fakeDevtools.evalSubRequests, [
      { id: 'counter', args: [3] },
    ]);
  } finally {
    await client.close().catch(() => {});
    await fakeDevtools.close();
  }
});
