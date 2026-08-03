#!/usr/bin/env node

import { isIP } from 'node:net';
import { createMCPServer } from './index.js';

interface CliConfig {
  serverUrl: string;
  token?: string;
  allowInsecureRemote: boolean;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
  if (normalized === 'localhost') return true;
  if (isIP(normalized) === 4) {
    return Number.parseInt(normalized.split('.')[0] ?? '', 10) === 127;
  }
  return normalized === '::1' || normalized.startsWith('::ffff:127.');
}

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  let host = '127.0.0.1';
  let port = 4000;
  let explicitUrl: string | undefined;
  let allowInsecureRemote = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--port' || arg === '-p') {
      const parsed = /^\d+$/.test(next ?? '')
        ? Number(next)
        : Number.NaN;
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${arg} requires a positive integer.`);
      }
      if (parsed > 65_535) {
        throw new Error(`${arg} must be at most 65535.`);
      }
      port = parsed;
      index += 1;
    } else if (arg === '--host' || arg === '-h') {
      if (!next || next.startsWith('-')) {
        throw new Error(`${arg} requires a host.`);
      }
      host = next;
      index += 1;
    } else if (arg === '--url') {
      if (!next || next.startsWith('-')) {
        throw new Error('--url requires an absolute http:// or https:// URL.');
      }
      explicitUrl = next;
      index += 1;
    } else if (arg === '--allow-insecure-remote') {
      allowInsecureRemote = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const url = new URL(explicitUrl ?? `http://${host}:${port}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The DevTools URL must use http:// or https://.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'The DevTools URL must not contain credentials, a query, or a fragment.',
    );
  }
  if (
    url.protocol === 'http:'
    && !isLoopbackHostname(url.hostname)
    && !allowInsecureRemote
  ) {
    throw new Error(
      'Refusing to send a DevTools bearer token over remote plaintext HTTP. ' +
      'Use an HTTPS URL, an SSH tunnel, or --allow-insecure-remote only on a trusted network.',
    );
  }

  return {
    serverUrl: url.toString().replace(/\/+$/, ''),
    token: process.env.UKLAD_DEVTOOLS_MCP_TOKEN,
    allowInsecureRemote,
  };
}

function printHelp(): void {
  console.log(`
Uklad DevTools MCP Server

Connects the stdio MCP transport to an authenticated Uklad DevTools API.

Usage: uklad-devtools-mcp [options]

Options:
  -p, --port <port>             DevTools port (default: 4000)
  -h, --host <host>             DevTools host (default: 127.0.0.1)
  --url <http(s)://...>         Full DevTools base URL
  --allow-insecure-remote       Permit remote plaintext HTTP (unsafe)
  --help                        Show this help

Capabilities:
  The bridge has no dispatch flag. dispatch_event is always listed, but a call
  returns CAPABILITY_DENIED unless the DevTools server was started with
  --allow-dispatch. Inspection requires the server to run with --mcp.

Authentication:
  Local loopback connections obtain a generated MCP-role token automatically.
  Remote connections must set UKLAD_DEVTOOLS_MCP_TOKEN to the same value used
  by the DevTools server. Keep tokens out of MCP JSON and process arguments.
`);
}

async function main(): Promise<void> {
  const config = parseArgs();
  console.error('[MCP] Connecting to DevTools server at:', config.serverUrl);

  let server: Awaited<ReturnType<typeof createMCPServer>> | undefined;
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      process.exit(1);
    }
    isShuttingDown = true;
    console.error(`[MCP] Received ${signal}, shutting down.`);
    if (server) await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  server = await createMCPServer({
    devtoolsServerUrl: config.serverUrl,
    token: config.token,
    allowInsecureRemote: config.allowInsecureRemote,
  });
}

main().catch((error) => {
  console.error(
    '[MCP] Failed to start:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
