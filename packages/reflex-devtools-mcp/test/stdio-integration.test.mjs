import { createServer } from 'node:http';
import process from 'node:process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const PROTOCOL_VERSION = 2;
const PROTOCOL_HEADER = 'reflex-devtools-protocol-version';
const CLIENT_HEADER = 'x-reflex-client';
const SESSION_TOKEN = 'fake-mcp-session-token';
const RUNTIME_ID = 'integration-runtime';
const RUNTIME_NAME = 'Integration runtime';

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
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Reflex-DevTools-Protocol-Version': String(PROTOCOL_VERSION),
  });
  res.end(JSON.stringify(body));
}

function assertProtocolHeaders(req) {
  assert.equal(
    req.headers[PROTOCOL_HEADER],
    String(PROTOCOL_VERSION),
    `${req.method} ${req.url} should send the DevTools protocol header`,
  );
  assert.match(
    req.headers[CLIENT_HEADER] || '',
    /^reflex-devtools-mcp\/\d+\.\d+\.\d+$/,
    `${req.method} ${req.url} should identify the MCP client`,
  );
}

function assertAuthenticatedRequest(req) {
  assertProtocolHeaders(req);
  assert.equal(
    req.headers.authorization,
    `Bearer ${SESSION_TOKEN}`,
    `${req.method} ${req.url} should send the bootstrapped bearer token`,
  );
}

async function startFakeDevtoolsServer({
  capabilities = ['inspect', 'dispatch'],
} = {}) {
  const dispatchRequests = [];
  const evalSubRequests = [];
  const requests = [];

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      requests.push({
        method: req.method,
        pathname: url.pathname,
        runtimeId: url.searchParams.get('runtimeId'),
        authorization: req.headers.authorization,
        protocolVersion: req.headers[PROTOCOL_HEADER],
        client: req.headers[CLIENT_HEADER],
      });

      if (req.method === 'GET' && url.pathname === '/health') {
        assert.equal(req.headers.authorization, undefined);
        sendJson(res, 200, {
          status: 'ok',
          protocolVersion: PROTOCOL_VERSION,
          authenticationRequired: true,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/auth/session') {
        assertProtocolHeaders(req);
        assert.equal(req.headers.authorization, undefined);
        assert.deepEqual(await readJson(req), { role: 'mcp' });
        sendJson(res, 200, {
          success: true,
          role: 'mcp',
          token: SESSION_TOKEN,
          capabilities,
          protocolVersion: PROTOCOL_VERSION,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        assertAuthenticatedRequest(req);
        sendJson(res, 200, {
          success: true,
          mcpEnabled: true,
          appConnected: true,
          connectedApps: 1,
          connectedUIs: 0,
          runtimeId: RUNTIME_ID,
          runtimeName: RUNTIME_NAME,
          selectedRuntimeId: RUNTIME_ID,
          runtimes: [{
            runtimeId: RUNTIME_ID,
            runtimeName: RUNTIME_NAME,
            connected: true,
            sessionEpoch: 1,
            runtime: 'headless',
          }],
          sessionEpoch: 1,
          runtime: 'headless',
          effectMode: 'safe',
          effects: { 'fake-effect': 'real' },
          tracing: true,
          handlers: { event: 1, fx: 1, cofx: 0, sub: 1 },
          stateAvailable: true,
          traceCount: 0,
          capabilities,
          readOnly:
            !capabilities.includes('dispatch')
            && !capabilities.includes('restore'),
          protocol: {
            version: PROTOCOL_VERSION,
            runtimeVersion: PROTOCOL_VERSION,
            inspectorApiVersion: 2,
          },
          security: {
            authenticated: true,
            loopbackOnly: true,
            redactionEnabled: true,
            auditEnabled: true,
          },
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/handlers') {
        assertAuthenticatedRequest(req);
        sendJson(res, 200, {
          success: true,
          runtimeId: RUNTIME_ID,
          runtimeName: RUNTIME_NAME,
          sessionEpoch: 1,
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
        assertAuthenticatedRequest(req);
        if (!capabilities.includes('dispatch')) {
          // Mirror the real server: the capability is enforced in the auth
          // layer before the dispatch body is ever processed.
          sendJson(res, 403, {
            success: false,
            code: 'CAPABILITY_DENIED',
            error: 'The dispatch capability is not granted.',
            requiredCapability: 'dispatch',
          });
          return;
        }
        const body = await readJson(req);
        dispatchRequests.push(body);

        if (body.eventName === 'missing-handler') {
          sendJson(res, 200, {
            success: true,
            runtimeId: RUNTIME_ID,
            runtimeName: RUNTIME_NAME,
            sessionEpoch: 1,
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
          runtimeId: RUNTIME_ID,
          runtimeName: RUNTIME_NAME,
          sessionEpoch: 1,
          outcome: 'succeeded',
          traceId: 101,
          event: [body.eventName, ...(body.params || [])],
          duration: 0,
          patches: [],
          effects: [['fake-effect', 123]],
        });
      } else if (req.method === 'POST' && url.pathname === '/api/eval-sub') {
        assertAuthenticatedRequest(req);
        const body = await readJson(req);
        evalSubRequests.push(body);
        sendJson(res, 200, {
          success: true,
          runtimeId: RUNTIME_ID,
          runtimeName: RUNTIME_NAME,
          sessionEpoch: 1,
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
    requests,
    port: address.port,
    close: () => new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}

async function connectMCP(fakeDevtools) {
  const client = new Client(
    { name: 'reflex-devtools-mcp-integration-test', version: '0.0.0' },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, '--host', '127.0.0.1', '--port', String(fakeDevtools.port)],
    stderr: 'ignore',
  });
  await client.connect(transport);
  return client;
}

test('stdio MCP server lists dispatch_event for a read-only session and denies the call', async () => {
  const fakeDevtools = await startFakeDevtoolsServer({
    capabilities: ['inspect'],
  });
  const client = await connectMCP(fakeDevtools);

  try {
    const tools = await client.listTools();
    // dispatch_event is always advertised — the tool list is a static snapshot;
    // the DevTools server, not the bridge, enforces the dispatch grant.
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
    const dispatchTool = tools.tools.find(({ name }) => name === 'dispatch_event');
    assert.deepEqual(dispatchTool.annotations, {
      title: 'Dispatch Reflex event',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    for (const tool of tools.tools.filter(({ name }) => name !== 'dispatch_event')) {
      assert.deepEqual(tool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    for (const tool of tools.tools) {
      assert.ok(tool.inputSchema.properties.runtimeId);
    }
    assert.ok(
      tools.tools.find(({ name }) => name === 'get_trace')
        ?.inputSchema.properties.sessionEpoch,
    );

    const status = parseToolResult(await client.callTool({
      name: 'app_status',
      arguments: {},
    }));
    assert.deepEqual(status.capabilities, ['inspect']);
    assert.equal(status.runtimeId, RUNTIME_ID);
    assert.equal(status.selectedRuntimeId, RUNTIME_ID);
    assert.equal(status.runtimes[0].runtimeName, RUNTIME_NAME);
    assert.equal(status.readOnly, true);
    assert.equal(status.security.authenticated, true);
    assert.ok(status.hints.some((hint) => /read-only/.test(hint)));

    // Calling dispatch against a read-only server is denied with an actionable
    // error, not silently absent, and it must not mutate state.
    const denied = parseToolResult(await client.callTool({
      name: 'dispatch_event',
      arguments: { eventName: 'fake-event', params: [] },
    }));
    assert.equal(denied.code, 'CAPABILITY_DENIED');
    assert.match(denied.message, /--allow-dispatch/);
    assert.equal(
      fakeDevtools.dispatchRequests.length,
      0,
      'a denied dispatch must never mutate app state',
    );

    assert.equal(
      fakeDevtools.requests.filter(({ pathname }) => pathname === '/auth/session').length,
      1,
      'the client should reuse one bootstrapped session token',
    );
  } finally {
    await client.close().catch(() => {});
    await fakeDevtools.close();
  }
});

test('stdio MCP server dispatches and reports outcomes when the server grants dispatch', async () => {
  const fakeDevtools = await startFakeDevtoolsServer();
  const client = await connectMCP(fakeDevtools);

  try {
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
    const dispatchTool = tools.tools.find(({ name }) => name === 'dispatch_event');
    assert.deepEqual(dispatchTool.annotations, {
      title: 'Dispatch Reflex event',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    assert.equal(dispatchTool.inputSchema.additionalProperties, false);
    for (const tool of tools.tools.filter(({ name }) => name !== 'dispatch_event')) {
      assert.deepEqual(tool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    for (const tool of tools.tools) {
      assert.ok(tool.inputSchema.properties.runtimeId);
    }
    assert.ok(
      tools.tools.find(({ name }) => name === 'get_trace')
        ?.inputSchema.properties.sessionEpoch,
    );

    // The initialize-time instructions are the agent's primary usage docs:
    // they must be advertised and must mention every tool the server exposes.
    const instructions = client.getInstructions();
    assert.ok(instructions && instructions.length > 0, 'server should advertise instructions');
    for (const tool of tools.tools) {
      assert.ok(instructions.includes(tool.name), `instructions should mention ${tool.name}`);
    }
    assert.match(instructions, /--allow-dispatch/);

    const status = parseToolResult(await client.callTool({
      name: 'app_status',
      arguments: { runtimeId: RUNTIME_ID },
    }));
    assert.equal(status.appConnected, true);
    assert.equal(status.runtime, 'headless');
    assert.equal(status.sessionEpoch, 1);
    assert.deepEqual(status.capabilities, ['inspect', 'dispatch']);
    assert.equal(status.readOnly, false);
    assert.deepEqual(status.protocol, {
      version: PROTOCOL_VERSION,
      runtimeVersion: PROTOCOL_VERSION,
      inspectorApiVersion: 2,
    });
    assert.equal(status.security.authenticated, true);

    const handlers = parseToolResult(await client.callTool({
      name: 'get_handlers',
      arguments: { type: 'event', runtimeId: RUNTIME_ID },
    }));
    assert.deepEqual(handlers.handlers.event.handlers, ['fake-event']);
    assert.equal(handlers.runtimeId, RUNTIME_ID);
    assert.equal(handlers.runtimeName, RUNTIME_NAME);
    assert.equal(handlers.sessionEpoch, 1);

    const succeeded = parseToolResult(await client.callTool({
      name: 'dispatch_event',
      arguments: {
        eventName: 'fake-event',
        params: [2, { name: 'Smoke Test' }],
        runtimeId: RUNTIME_ID,
      },
    }));
    assert.equal(succeeded.outcome, 'succeeded');
    assert.equal(succeeded.traceId, 101);
    assert.deepEqual(succeeded.effectsEmitted, [['fake-effect', 123]]);
    assert.equal(succeeded.runtimeId, RUNTIME_ID);
    assert.equal('params' in succeeded, false);

    const subValue = parseToolResult(await client.callTool({
      name: 'eval_sub',
      arguments: { id: 'counter', args: [3], runtimeId: RUNTIME_ID },
    }));
    assert.equal(subValue.id, 'counter');
    assert.deepEqual(subValue.value, { counter: 2, multiplier: 3 });
    assert.equal(subValue.runtimeName, RUNTIME_NAME);
    assert.equal('args' in subValue, false);

    const failed = parseToolResult(await client.callTool({
      name: 'dispatch_event',
      arguments: {
        eventName: 'missing-handler',
        params: [],
        runtimeId: RUNTIME_ID,
      },
    }));
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.error.phase, 'missing-handler');
    assert.match(failed.hint, /get_handlers/);

    assert.deepEqual(fakeDevtools.dispatchRequests, [
      {
        eventName: 'fake-event',
        params: [2, { name: 'Smoke Test' }],
        runtimeId: RUNTIME_ID,
      },
      { eventName: 'missing-handler', params: [], runtimeId: RUNTIME_ID },
    ]);
    assert.deepEqual(fakeDevtools.evalSubRequests, [
      { id: 'counter', args: [3], runtimeId: RUNTIME_ID },
    ]);
    assert.deepEqual(
      fakeDevtools.requests
        .filter(({ pathname }) => pathname === '/api/status' || pathname === '/api/handlers')
        .map(({ runtimeId }) => runtimeId),
      [RUNTIME_ID, RUNTIME_ID],
    );
    assert.equal(
      fakeDevtools.requests.filter(({ pathname }) => pathname === '/auth/session').length,
      1,
      'the client should reuse one bootstrapped session token',
    );
  } finally {
    await client.close().catch(() => {});
    await fakeDevtools.close();
  }
});
