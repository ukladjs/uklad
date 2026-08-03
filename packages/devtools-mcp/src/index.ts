/**
 * Uklad DevTools MCP Server
 * 
 * Model Context Protocol server that connects to Uklad DevTools
 * and provides AI assistants with tools to inspect state, evaluate
 * subscriptions, inspect traces, and dispatch events.
 */

import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Resolved at runtime from the package manifest so the advertised MCP
// server version can't drift from the published one.
const { version: PACKAGE_VERSION } = createRequire(import.meta.url)('../package.json');

import { DevToolsAPIClient } from './httpClient.js';
import { appStatusTool } from './tools/appStatus.js';
import { getTracesTool } from './tools/getTraces.js';
import { getTraceTool } from './tools/getTrace.js';
import { getStateTool } from './tools/getState.js';
import { dispatchEventTool } from './tools/dispatchEvent.js';
import { dispatchAndWaitTool } from './tools/dispatchAndWait.js';
import { getHandlersTool } from './tools/getHandlers.js';
import { getActiveSubsTool } from './tools/getActiveSubs.js';
import { evalSubTool } from './tools/evalSub.js';

export interface MCPServerConfig {
  devtoolsServerUrl: string;
  token?: string;
  clientName?: string;
  allowInsecureRemote?: boolean;
}

// Sent to every client at initialize time — for most agents this is the only
// usage documentation they ever see, so it must stay in sync with the actual
// tool set (the stdio integration test checks every tool is mentioned).
const SERVER_INSTRUCTIONS = `Uklad DevTools: inspect and drive a live Uklad app (re-frame-style — events mutate a central state through pure handlers, subscriptions derive values from it).

Retrieval order (cheapest first):
1. app_status — discover runtimes and select one. It lists stable runtimeId values and reports whether the selected app is connected, browser/React Native/headless, tracing state, handler counts, and sessionEpoch. Call it first after a cold start and after any reload; a changed sessionEpoch means the DevTools connection session changed and server-stored trace ids were invalidated. A transient reconnect can leave the runtime state intact.
2. get_handlers — registered event/sub/effect ids; learn what exists before reading state.
3. get_state with "path" — read only the state slice you need; avoid full dumps on real apps.
4. eval_sub — evaluate any registered subscription against live state, whether or not a component has mounted it. Use get_active_subs only when you need the current mounted-subscription set.
5. dispatch_and_wait — preferred act-and-verify path for operation-enabled runtimes. It returns the DevTools-owned operation snapshot after the joined event cascade settles: identity/status, event lineage, committed/published revisions, pending work, and errors. Use dispatch_event only with older runtimes that lack the operation capability.
6. get_traces — compact rows of recent activity, including what you did not initiate (user clicks, timers, subscriptions). Drill into one trace with get_trace, passing the get_traces response's runtimeId and sessionEpoch so a restart fails explicitly; never page through full trace details.

Caveats:
- Every tool accepts an optional runtimeId. Omitting it is convenient when exactly one runtime is connected. When multiple runtimes are connected, call app_status, choose a runtime from runtimes[], and pass that runtimeId to every later call; never guess which runtime should receive a mutation.
- The app does not have to be a browser tab: a headless entry (src/headless.ts run under tsx/vite-node, no React mount) connects the same way and supports every tool here; app_status's "runtime" and effect adapter modes tell you which world you are driving.
- The DevTools server is read-only by default. dispatch_event is always listed, but it fails with CAPABILITY_DENIED unless the server was started with --allow-dispatch. Treat that error as "ask the human to restart the DevTools server with --allow-dispatch, only if mutation is actually intended" — it is a deliberate authorization boundary, never something to work around.
- Server-stored traces clear when the app reloads or the SDK reconnects. Pass the sessionEpoch returned by get_traces to get_trace; SESSION_EPOCH_MISMATCH means the DevTools session changed, so discard the old ids and query get_traces again.
- A failed dispatch or subscription evaluation with phase "missing-handler" means that exact id is not registered — check it against get_handlers.
- "[REDACTED]" and "[REDACTED:CREDENTIAL]" values in state, traces, or subscription results are the default credential masking working as intended, not an application bug. Never disable or suggest disabling redaction; if a non-sensitive key is masked, the application owner can supply a custom key list in the redaction config.`;

export class UkladDevToolsMCPServer {
  private server: Server;
  private apiClient: DevToolsAPIClient;
  private tools: Map<string, any>;

  constructor(config: MCPServerConfig) {
    this.server = new Server(
      {
        name: 'uklad-devtools',
        version: PACKAGE_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
        instructions: SERVER_INSTRUCTIONS,
      }
    );

    // Initialize HTTP API client
    this.apiClient = new DevToolsAPIClient({
      serverUrl: config.devtoolsServerUrl,
      token: config.token,
      clientName: config.clientName ?? `uklad-devtools-mcp/${PACKAGE_VERSION}`,
      allowInsecureRemote: config.allowInsecureRemote,
    });

    // Initialize tools
    this.tools = new Map();
    this.registerTools();

    // Setup request handlers
    this.setupHandlers();
  }

  private registerTools(): void {
    // dispatch_event is always advertised. The DevTools server is the single
    // enforcement point: when it runs without --allow-dispatch, a dispatch call
    // is rejected with CAPABILITY_DENIED and audited. Hiding the tool at
    // list time is unreliable — MCP clients snapshot the tool list once at
    // init, when the project-local DevTools server is usually not even running
    // yet, so a later --allow-dispatch grant would never surface.
    const tools = [
      appStatusTool(this.apiClient),
      getTracesTool(this.apiClient),
      getTraceTool(this.apiClient),
      getStateTool(this.apiClient),
      getHandlersTool(this.apiClient),
      getActiveSubsTool(this.apiClient),
      evalSubTool(this.apiClient),
      dispatchEventTool(this.apiClient),
      dispatchAndWaitTool(this.apiClient),
    ];

    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.tools.values()).map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            ...tool.inputSchema,
            additionalProperties: false,
          },
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          annotations: toolAnnotations(tool.name),
        }))
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const tool = this.tools.get(toolName);

      if (!tool) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      try {
        const toolArguments = request.params.arguments || {};
        const validationError = validateToolArguments(
          tool.inputSchema,
          toolArguments,
        );
        if (validationError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Invalid tool arguments',
                  code: 'INVALID_ARGUMENT',
                  tool: toolName,
                  message: validationError,
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        return await tool.handler(toolArguments);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Tool execution failed',
                tool: toolName,
                message: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    });
  }

  async start(): Promise<void> {
    // A health check is best-effort diagnostics only; the tool set no longer
    // depends on server capabilities, so an unreachable or read-only server
    // never changes what is advertised.
    try {
      const isHealthy = await this.apiClient.checkHealth();
      console.error(
        isHealthy
          ? '[MCP] Connected to DevTools server'
          : '[MCP] Warning: DevTools server health check failed',
      );
    } catch (error) {
      console.error('[MCP] Warning: Could not connect to DevTools server:',
        error instanceof Error ? error.message : 'Unknown error');
      console.error('[MCP] Make sure DevTools server is running on the configured host/port');
    }

    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('[MCP] Uklad DevTools MCP server started');
    console.error('[MCP] Available tools:', Array.from(this.tools.keys()).join(', '));
  }

  async stop(): Promise<void> {
    await this.server.close();
    console.error('[MCP] Server stopped');
  }
}

function toolAnnotations(name: string) {
  if (name === 'dispatch_event' || name === 'dispatch_and_wait') {
    return {
      title: 'Dispatch Uklad event',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    };
  }
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function validateToolArguments(
  schema: any,
  value: unknown,
): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'Arguments must be an object.';
  }
  const record = value as Record<string, unknown>;
  const properties = schema?.properties ?? {};
  const required = new Set<string>(schema?.required ?? []);

  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return `Missing required property "${key}".`;
    }
  }
  if (schema?.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        return `Unknown property "${key}".`;
      }
    }
  }

  for (const [key, propertySchema] of Object.entries<any>(properties)) {
    const candidate = record[key];
    if (candidate === undefined) continue;
    const error = validateSchemaValue(propertySchema, candidate, key);
    if (error) return error;
  }
  return null;
}

function validateSchemaValue(
  schema: any,
  value: unknown,
  path: string,
): string | null {
  const acceptedTypes = Array.isArray(schema?.type)
    ? schema.type
    : [schema?.type];
  const actualType = value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : Number.isInteger(value)
        ? 'integer'
        : typeof value === 'number'
          ? 'number'
          : typeof value;
  const typeMatches = acceptedTypes.includes(actualType)
    || (actualType === 'integer' && acceptedTypes.includes('number'))
    || (actualType === 'object' && acceptedTypes.includes('object'));
  if (!typeMatches) {
    return `"${path}" has the wrong type.`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `"${path}" must be one of: ${schema.enum.join(', ')}.`;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `"${path}" is too short.`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `"${path}" is too long.`;
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `"${path}" is below the minimum.`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `"${path}" exceeds the maximum.`;
    }
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `"${path}" contains too many items.`;
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateSchemaValue(
          schema.items,
          value[index],
          `${path}[${index}]`,
        );
        if (error) return error;
      }
    }
  }
  return null;
}

export async function createMCPServer(config: MCPServerConfig): Promise<UkladDevToolsMCPServer> {
  const server = new UkladDevToolsMCPServer(config);
  await server.start();
  return server;
}
