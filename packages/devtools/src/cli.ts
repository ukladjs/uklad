#!/usr/bin/env node

import { DevtoolsServer } from './server/index.js';
import type {
  DevtoolsCapability,
  DevtoolsClientRole,
} from './protocol.js';

interface CliConfig {
  port: number;
  host: string;
  enableMCP: boolean;
  maxTraces: number;
  maxRuntimes: number;
  capabilities: DevtoolsCapability[];
  allowRemote: boolean;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxControlPayloadBytes?: number;
  maxRuntimePayloadBytes?: number;
  tokens: Partial<Record<DevtoolsClientRole, string>>;
}

function readPositiveInteger(
  value: string | undefined,
  option: string,
): number {
  const parsed = /^\d+$/.test(value ?? '')
    ? Number(value)
    : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} requires a positive integer.`);
  }
  return parsed;
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  let port = 4000;
  let host = '127.0.0.1';
  let enableMCP = false;
  let maxTraces = 1000;
  let maxRuntimes = 16;
  let allowRemote = false;
  let maxControlPayloadBytes: number | undefined;
  let maxRuntimePayloadBytes: number | undefined;
  const capabilities: DevtoolsCapability[] = ['inspect'];
  const allowedHosts: string[] = [];
  const allowedOrigins: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--port':
      case '-p':
        port = readPositiveInteger(args[index + 1], arg);
        if (port > 65_535) throw new Error(`${arg} must be at most 65535.`);
        index += 1;
        break;
      case '--host':
      case '-h':
        host = readValue(args, index, arg);
        index += 1;
        break;
      case '--mcp':
        enableMCP = true;
        break;
      case '--allow-dispatch':
        if (!capabilities.includes('dispatch')) capabilities.push('dispatch');
        break;
      case '--allow-restore':
        if (!capabilities.includes('restore')) capabilities.push('restore');
        break;
      case '--allow-remote':
        allowRemote = true;
        break;
      case '--allow-host':
        allowedHosts.push(readValue(args, index, arg));
        index += 1;
        break;
      case '--allow-origin':
        allowedOrigins.push(readValue(args, index, arg));
        index += 1;
        break;
      case '--max-traces':
        maxTraces = readPositiveInteger(args[index + 1], arg);
        index += 1;
        break;
      case '--max-runtimes':
        maxRuntimes = readPositiveInteger(args[index + 1], arg);
        index += 1;
        break;
      case '--max-control-kib':
        maxControlPayloadBytes =
          readPositiveInteger(args[index + 1], arg) * 1024;
        index += 1;
        break;
      case '--max-runtime-kib':
        maxRuntimePayloadBytes =
          readPositiveInteger(args[index + 1], arg) * 1024;
        index += 1;
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const tokens: Partial<Record<DevtoolsClientRole, string>> = {};
  if (process.env.UKLAD_DEVTOOLS_RUNTIME_TOKEN) {
    tokens.runtime = process.env.UKLAD_DEVTOOLS_RUNTIME_TOKEN;
  }
  if (process.env.UKLAD_DEVTOOLS_UI_TOKEN) {
    tokens.ui = process.env.UKLAD_DEVTOOLS_UI_TOKEN;
  }
  if (process.env.UKLAD_DEVTOOLS_MCP_TOKEN) {
    tokens.mcp = process.env.UKLAD_DEVTOOLS_MCP_TOKEN;
  }

  return {
    port,
    host,
    enableMCP,
    maxTraces,
    maxRuntimes,
    capabilities,
    allowRemote,
    allowedHosts,
    allowedOrigins,
    maxControlPayloadBytes,
    maxRuntimePayloadBytes,
    tokens,
  };
}

function printHelp(): void {
  console.log(`
Uklad DevTools

Usage: uklad-devtools [options]

Options:
  -p, --port <port>          Port (default: 4000)
  -h, --host <host>          Bind host (default: 127.0.0.1)
  --mcp                      Enable read-only MCP inspection storage/API
  --allow-dispatch           Grant the separate dispatch capability
  --allow-restore            Reserve/grant the separate restore capability
  --max-traces <number>      Maximum stored traces (default: 1000)
  --max-runtimes <number>    Maximum retained runtime entries (default: 16)
  --max-control-kib <number> HTTP/UI control payload limit (default: 64 KiB)
  --max-runtime-kib <number> Runtime telemetry payload limit (default: 1024 KiB)
  --allow-remote             Explicitly allow a non-loopback bind
  --allow-host <host>        Exact allowed Host name; repeatable
  --allow-origin <origin>    Exact allowed browser origin; repeatable
  --help                     Show this help

Security defaults:
  - Loopback-only binding, generated per-process role tokens, exact Host/Origin
    checks, secret-key redaction, bounded payloads, and read-only capabilities.
  - Local SDK/UI/MCP clients bootstrap their role token over loopback.
  - Cross-origin browser apps, including other localhost ports, require an
    exact --allow-origin entry. The hosted dashboard's same origin is allowed.
  - Non-loopback mode requires all three token environment variables plus exact
    Host and Origin allowlists. Put remote access behind TLS or an SSH tunnel.

Token environment variables:
  UKLAD_DEVTOOLS_RUNTIME_TOKEN
  UKLAD_DEVTOOLS_UI_TOKEN
  UKLAD_DEVTOOLS_MCP_TOKEN

Examples:
  uklad-devtools
  uklad-devtools --mcp --allow-origin http://localhost:5173
  uklad-devtools --mcp --allow-dispatch --allow-origin http://localhost:5173
`);
}

async function main(): Promise<void> {
  const config = parseArgs();
  const server = new DevtoolsServer(config);
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      console.error('[Uklad Devtools] Force exiting.');
      process.exit(1);
    }
    isShuttingDown = true;
    console.log(`[Uklad Devtools] Received ${signal}, shutting down.`);
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error('[Uklad Devtools] Shutdown failed:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await server.start();
}

main().catch((error) => {
  console.error(
    '[Uklad Devtools] Failed to start:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
