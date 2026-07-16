/**
 * Reflex DevTools MCP Server
 * 
 * Model Context Protocol server that connects to Reflex DevTools
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
import { getAppStateTool } from './tools/getAppState.js';
import { dispatchEventTool } from './tools/dispatchEvent.js';
import { getHandlersTool } from './tools/getHandlers.js';
import { getActiveSubsTool } from './tools/getActiveSubs.js';
import { evalSubTool } from './tools/evalSub.js';

export interface MCPServerConfig {
  devtoolsServerUrl: string;
}

// Sent to every client at initialize time — for most agents this is the only
// usage documentation they ever see, so it must stay in sync with the actual
// tool set (the stdio integration test checks every tool is mentioned).
const SERVER_INSTRUCTIONS = `Reflex DevTools: inspect and drive a live Reflex app (re-frame-style — events mutate a central app-db through pure handlers, subscriptions derive values from it).

Retrieval order (cheapest first):
1. app_status — is an app connected, does it run in a browser, React Native, or headless, is tracing on, handler counts, sessionEpoch. Call it first after a cold start and after any reload; a changed sessionEpoch means the app restarted (trace ids reset, seeded state gone).
2. get_handlers — registered event/sub/effect ids; learn what exists before reading state.
3. get_app_state with "path" — read only the state slice you need; avoid full dumps on real apps.
4. eval_sub — evaluate any registered subscription against live state, whether or not a component has mounted it. Use get_active_subs only when you need the current mounted-subscription set.
5. dispatch_event — act. The response already carries the outcome (succeeded | failed | effects-failed | unknown) plus the state patches and emitted effects; verify from it instead of re-reading state.
6. get_traces — compact rows of recent activity, including what you did not initiate (user clicks, timers, subscriptions). Drill into one trace with get_trace; never page through full trace details.

Caveats:
- The app does not have to be a browser tab: a headless entry (src/headless.ts run under tsx/vite-node, no React mount) connects the same way and supports every tool here; app_status's "runtime" and effect adapter modes tell you which world you are driving.
- dispatch_event mutates app state; it requires the devtools server started with --mcp and a connected app.
- Trace ids reset and stored traces clear when the app reloads or reconnects, so a missing trace id usually means "session reset", not a bug — app_status's sessionEpoch confirms it.
- A failed dispatch or subscription evaluation with phase "missing-handler" means that exact id is not registered — check it against get_handlers.`;

export class ReflexDevToolsMCPServer {
  private server: Server;
  private apiClient: DevToolsAPIClient;
  private tools: Map<string, any>;

  constructor(config: MCPServerConfig) {
    this.server = new Server(
      {
        name: 'reflex-devtools',
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
      serverUrl: config.devtoolsServerUrl
    });

    // Initialize tools
    this.tools = new Map();
    this.registerTools();

    // Setup request handlers
    this.setupHandlers();
  }

  private registerTools(): void {
    const tools = [
      appStatusTool(this.apiClient),
      getTracesTool(this.apiClient),
      getTraceTool(this.apiClient),
      getAppStateTool(this.apiClient),
      dispatchEventTool(this.apiClient),
      getHandlersTool(this.apiClient),
      getActiveSubsTool(this.apiClient),
      evalSubTool(this.apiClient)
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
          inputSchema: tool.inputSchema
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
        return await tool.handler(request.params.arguments || {});
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
    // Check if DevTools server is available
    try {
      const isHealthy = await this.apiClient.checkHealth();
      if (isHealthy) {
        console.error('[MCP] Connected to DevTools server');
      } else {
        console.error('[MCP] Warning: DevTools server health check failed');
      }
    } catch (error) {
      console.error('[MCP] Warning: Could not connect to DevTools server:', 
        error instanceof Error ? error.message : 'Unknown error');
      console.error('[MCP] Make sure DevTools server is running on the configured host/port');
    }

    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('[MCP] Reflex DevTools MCP server started');
    console.error('[MCP] Available tools:', Array.from(this.tools.keys()).join(', '));
  }

  async stop(): Promise<void> {
    await this.server.close();
    console.error('[MCP] Server stopped');
  }
}

export async function createMCPServer(config: MCPServerConfig): Promise<ReflexDevToolsMCPServer> {
  const server = new ReflexDevToolsMCPServer(config);
  await server.start();
  return server;
}
