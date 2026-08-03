import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import {
  UKLAD_DEVTOOLS_WS_PROTOCOL,
  type DevtoolsClientRole,
} from '../protocol.js';

export type SessionTokens = Readonly<Record<DevtoolsClientRole, string>>;

export function createSessionTokens(
  configured: Partial<Record<DevtoolsClientRole, string>> = {},
): SessionTokens {
  return Object.freeze({
    runtime: validateConfiguredToken(configured.runtime, 'runtime'),
    ui: validateConfiguredToken(configured.ui, 'ui'),
    mcp: validateConfiguredToken(configured.mcp, 'mcp'),
  });
}

function validateConfiguredToken(
  token: string | undefined,
  role: DevtoolsClientRole,
): string {
  if (token === undefined) return randomBytes(32).toString('base64url');
  if (Buffer.byteLength(token, 'utf8') < 32) {
    throw new Error(
      `[Uklad Devtools] The configured ${role} token must be at least 32 bytes.`,
    );
  }
  return token;
}

export function tokensEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function readBearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export function hasSupportedWebSocketProtocol(
  request: IncomingMessage,
): boolean {
  return readWebSocketProtocols(request).includes(UKLAD_DEVTOOLS_WS_PROTOCOL);
}

function readWebSocketProtocols(request: IncomingMessage): string[] {
  const header = request.headers['sec-websocket-protocol'];
  const value = Array.isArray(header) ? header.join(',') : header;
  return value
    ? value.split(',').map((protocol) => protocol.trim()).filter(Boolean)
    : [];
}

export function parseHostHeader(hostHeader: string | undefined): string | null {
  if (!hostHeader || hostHeader !== hostHeader.trim()) return null;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (
      parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    return stripIpv6Brackets(hostname);
  } catch {
    return null;
  }
}

export function normalizeHost(host: string): string {
  return stripIpv6Brackets(host.trim().toLowerCase());
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (normalized === 'localhost') {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const firstOctet = Number.parseInt(normalized.split('.')[0] ?? '', 10);
    return firstOctet === 127;
  }
  if (ipVersion === 6) {
    return normalized === '::1'
      || normalized.toLowerCase().startsWith('::ffff:127.');
  }
  return false;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().split('%')[0] ?? address;
  return isLoopbackHost(normalized);
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
  sameOriginHost?: string,
): boolean {
  if (origin === undefined) return true;
  if (origin === 'null') return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.origin !== origin) return false;
  if (allowedOrigins.has(parsed.origin)) return true;
  return sameOriginHost !== undefined
    && parsed.host.toLowerCase() === sameOriginHost.toLowerCase();
}

export function normalizeAllowedOrigins(
  origins: readonly string[] | undefined,
): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const origin of origins ?? []) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        `[Uklad Devtools] allowedOrigins entries must be exact origins without paths: ${origin}`,
      );
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.origin !== origin
      || origin === 'null'
    ) {
      throw new Error(
        `[Uklad Devtools] allowedOrigins entries must be exact HTTP(S) origins without paths: ${origin}`,
      );
    }
    normalized.add(parsed.origin);
  }
  return normalized;
}
