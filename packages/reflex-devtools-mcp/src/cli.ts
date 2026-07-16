#!/usr/bin/env node

/**
 * CLI entry point for Reflex DevTools MCP Server
 */

import { createMCPServer } from './index.js';

function parseArgs(): { port: number; host: string } {
  const args = process.argv.slice(2);
  let port = 4000;
  let host = 'localhost';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      const portValue = parseInt(args[i + 1]);
      if (!isNaN(portValue)) {
        port = portValue;
        i++;
      }
    } else if (arg === '--host' || arg === '-h') {
      const hostValue = args[i + 1];
      if (hostValue && !hostValue.startsWith('-')) {
        host = hostValue;
        i++;
      }
    } else if (arg === '--help') {
      console.log(`
Reflex DevTools MCP Server

Connects to a running Reflex DevTools server and exposes tools via 
the Model Context Protocol for AI assistants to inspect traces and 
dispatch events.

Usage: reflex-devtools-mcp [options]

Options:
  -p, --port <port>         DevTools server port (default: 4000)
  -h, --host <host>         DevTools server host (default: localhost)
  --help                    Show this help message

Examples:
  reflex-devtools-mcp                           # Connect to localhost:4000
  reflex-devtools-mcp --port 3000               # Connect to localhost:3000
  reflex-devtools-mcp --host 192.168.1.10       # Connect to remote host

Configuration for Claude Desktop (add to claude_desktop_config.json):
{
  "mcpServers": {
    "reflex-devtools": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=@flexsurfer/reflex-devtools-mcp",
        "reflex-devtools-mcp",
        "--host",
        "127.0.0.1",
        "--port",
        "4000"
      ]
    }
  }
}

For more information, visit: https://github.com/flexsurfer/reflex/tree/main/packages/reflex-devtools-mcp
      `);
      process.exit(0);
    }
  }

  return { port, host };
}

async function main() {
  const { port, host } = parseArgs();
  const serverUrl = `${host}:${port}`;

  console.error('[MCP] Starting Reflex DevTools MCP Server...');
  console.error('[MCP] Connecting to DevTools server at:', serverUrl);

  let server: Awaited<ReturnType<typeof createMCPServer>> | undefined;
  let isShuttingDown = false;

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      console.error('[MCP] Force exiting...');
      process.exit(1);
    }
    
    isShuttingDown = true;
    console.error(`[MCP] Received ${signal}, shutting down gracefully...`);
    
    try {
      if (server) {
        await server.stop();
      }
      process.exit(0);
    } catch (err) {
      console.error('[MCP] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    server = await createMCPServer({
      devtoolsServerUrl: serverUrl
    });

    // Keep the process running
    // MCP servers communicate via stdio, so we just wait for shutdown signals
  } catch (error) {
    console.error('[MCP] Failed to start server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[MCP] Unexpected error:', error);
  process.exit(1);
});
