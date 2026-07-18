/**
 * Authenticated HTTP client for the project-local DevTools REST API.
 */

import { isIP } from 'node:net';

export const REFLEX_DEVTOOLS_PROTOCOL_VERSION = 2;
const PROTOCOL_HEADER = 'Reflex-DevTools-Protocol-Version';
const CLIENT_HEADER = 'X-Reflex-Client';

export interface DevToolsAPIConfig {
  serverUrl: string;
  token?: string;
  clientName?: string;
  requestTimeoutMs?: number;
  allowInsecureRemote?: boolean;
}

export class DevToolsServerUnavailableError extends Error {
  constructor(public readonly serverUrl: string) {
    super('No Reflex DevTools server is connected.');
    this.name = 'DevToolsServerUnavailableError';
  }
}

export class DevToolsProtocolMismatchError extends Error {
  constructor(public readonly received: unknown) {
    super(
      `Incompatible Reflex DevTools protocol. Expected ` +
      `${REFLEX_DEVTOOLS_PROTOCOL_VERSION}, received ${String(received)}.`,
    );
    this.name = 'DevToolsProtocolMismatchError';
  }
}

export function isDevToolsServerUnavailableError(
  error: unknown,
): error is DevToolsServerUnavailableError {
  return error instanceof DevToolsServerUnavailableError;
}

export function devToolsServerUnavailableBody(retryTool: string) {
  const command = 'npm run devtools:mcp';
  return {
    error: 'No Reflex DevTools server is connected.',
    message: [
      'No Reflex DevTools server is connected.',
      'Start the project-local DevTools script from the project root (or use the detected package manager equivalent):',
      `  ${command}`,
      'If the script is missing, add "devtools:mcp": "reflex-devtools --mcp --host 127.0.0.1 --port 4000 --allow-origin http://localhost:5173" to package.json (replace the origin with the browser app\'s exact dev-server origin, or omit it for headless-only use).',
      `Then reload the app and retry ${retryTool}.`,
    ].join('\n'),
    command,
    retry: retryTool,
  };
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

function normalizeBaseUrl(
  serverUrl: string,
  allowInsecureRemote: boolean,
): string {
  const withScheme = /^https?:\/\//i.test(serverUrl)
    ? serverUrl
    : `http://${serverUrl}`;
  const url = new URL(withScheme);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(
      'DevTools serverUrl must be an http(s) URL without credentials, query, or fragment.',
    );
  }
  if (
    url.protocol === 'http:'
    && !isLoopbackHostname(url.hostname)
    && !allowInsecureRemote
  ) {
    throw new Error(
      'Refusing to send a DevTools bearer token over remote plaintext HTTP. ' +
      'Use HTTPS, a loopback SSH tunnel, or explicitly allow an insecure trusted network.',
    );
  }
  return url.toString().replace(/\/+$/, '');
}

export class DevToolsAPIClient {
  private readonly baseUrl: string;
  private readonly serverUrl: string;
  private readonly clientName: string;
  private readonly requestTimeoutMs: number;
  private token: string | null;
  private tokenWasBootstrapped = false;
  private sessionPromise: Promise<string> | null = null;

  constructor(config: DevToolsAPIConfig) {
    this.serverUrl = config.serverUrl;
    this.baseUrl = normalizeBaseUrl(
      config.serverUrl,
      config.allowInsecureRemote ?? false,
    );
    this.clientName = config.clientName ?? 'reflex-devtools-mcp';
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
    this.token = config.token ?? null;
  }

  private async ensureSession(): Promise<string> {
    if (this.token) return this.token;
    if (this.sessionPromise) return this.sessionPromise;

    this.sessionPromise = this.bootstrapSession();
    try {
      const token = await this.sessionPromise;
      this.token = token;
      this.tokenWasBootstrapped = true;
      return token;
    } finally {
      this.sessionPromise = null;
    }
  }

  private async bootstrapSession(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/auth/session`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
        headers: {
          'Content-Type': 'application/json',
          [PROTOCOL_HEADER]: String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
          [CLIENT_HEADER]: this.clientName,
        },
        body: JSON.stringify({ role: 'mcp' }),
      });
    } catch {
      throw new DevToolsServerUnavailableError(this.serverUrl);
    }

    const body: any = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        body?.error
        || `DevTools session bootstrap failed with HTTP ${response.status}. ` +
          'Remote servers require REFLEX_DEVTOOLS_MCP_TOKEN.',
      );
    }
    if (
      response.headers.get(PROTOCOL_HEADER)
        !== String(REFLEX_DEVTOOLS_PROTOCOL_VERSION)
      || body?.protocolVersion !== REFLEX_DEVTOOLS_PROTOCOL_VERSION
      || typeof body?.token !== 'string'
    ) {
      throw new DevToolsProtocolMismatchError(body?.protocolVersion);
    }
    return body.token;
  }

  private async fetch(
    path: string,
    init: RequestInit = {},
    retryAuth = true,
  ): Promise<Response> {
    const token = await this.ensureSession();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set(
      PROTOCOL_HEADER,
      String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
    );
    headers.set(CLIENT_HEADER, this.clientName);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw new DevToolsServerUnavailableError(this.serverUrl);
    }

    const responseVersion = response.headers.get(PROTOCOL_HEADER);
    if (responseVersion !== String(REFLEX_DEVTOOLS_PROTOCOL_VERSION)) {
      throw new DevToolsProtocolMismatchError(responseVersion ?? 'missing');
    }

    if (
      response.status === 401
      && retryAuth
      && this.tokenWasBootstrapped
    ) {
      this.token = null;
      this.tokenWasBootstrapped = false;
      return this.fetch(path, init, false);
    }
    return response;
  }

  private async responseBody(response: Response): Promise<any> {
    const body: any = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        body?.error || `HTTP ${response.status}: ${response.statusText}`,
      );
      (error as any).code = body?.code;
      (error as any).details = body;
      throw error;
    }
    return body;
  }

  async getTraces(params: {
    limit?: number;
    eventFilter?: string;
    minDuration?: number;
    opType?: string;
    runtimeId?: string;
  } = {}): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params.limit !== undefined) {
      queryParams.append('limit', params.limit.toString());
    }
    if (params.eventFilter) {
      queryParams.append('eventFilter', params.eventFilter);
    }
    if (params.minDuration !== undefined) {
      queryParams.append('minDuration', params.minDuration.toString());
    }
    if (params.opType) queryParams.append('opType', params.opType);
    if (params.runtimeId !== undefined) {
      queryParams.append('runtimeId', params.runtimeId);
    }
    const suffix = queryParams.size > 0 ? `?${queryParams}` : '';
    return this.responseBody(await this.fetch(`/api/traces${suffix}`));
  }

  async getTrace(
    id: number,
    runtimeId?: string,
    sessionEpoch?: number,
  ): Promise<any> {
    const queryParams = new URLSearchParams();
    if (runtimeId !== undefined) queryParams.append('runtimeId', runtimeId);
    if (sessionEpoch !== undefined) {
      queryParams.append('sessionEpoch', sessionEpoch.toString());
    }
    const suffix = queryParams.size > 0 ? `?${queryParams}` : '';
    return this.responseBody(await this.fetch(`/api/traces/${id}${suffix}`));
  }

  async getAppState(path?: string, runtimeId?: string): Promise<any> {
    const queryParams = new URLSearchParams();
    if (path) queryParams.append('path', path);
    if (runtimeId !== undefined) queryParams.append('runtimeId', runtimeId);
    const suffix = queryParams.size > 0 ? `?${queryParams}` : '';
    return this.responseBody(await this.fetch(`/api/state${suffix}`));
  }

  async getSubscriptions(filter?: string, runtimeId?: string): Promise<any> {
    const queryParams = new URLSearchParams();
    if (filter) queryParams.append('filter', filter);
    if (runtimeId !== undefined) queryParams.append('runtimeId', runtimeId);
    const suffix = queryParams.size > 0 ? `?${queryParams}` : '';
    return this.responseBody(await this.fetch(`/api/subscriptions${suffix}`));
  }

  async getHandlers(type?: string, runtimeId?: string): Promise<any> {
    const queryParams = new URLSearchParams();
    if (type) queryParams.append('type', type);
    if (runtimeId !== undefined) queryParams.append('runtimeId', runtimeId);
    const suffix = queryParams.size > 0 ? `?${queryParams}` : '';
    return this.responseBody(await this.fetch(`/api/handlers${suffix}`));
  }

  async getStats(runtimeId?: string): Promise<any> {
    const suffix = runtimeId === undefined
      ? ''
      : `?runtimeId=${encodeURIComponent(runtimeId)}`;
    return this.responseBody(await this.fetch(`/api/stats${suffix}`));
  }

  async getAuditRecords(limit = 100): Promise<any> {
    return this.responseBody(
      await this.fetch(`/api/audit?limit=${encodeURIComponent(limit)}`),
    );
  }

  async dispatchEvent(
    eventName: string,
    params: any[] = [],
    runtimeId?: string,
  ): Promise<any> {
    return this.responseBody(await this.fetch('/api/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName,
        params,
        ...(runtimeId === undefined ? {} : { runtimeId }),
      }),
    }));
  }

  async evalSub(id: string, args: any[] = [], runtimeId?: string): Promise<any> {
    return this.responseBody(await this.fetch('/api/eval-sub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        args,
        ...(runtimeId === undefined ? {} : { runtimeId }),
      }),
    }));
  }

  async getStatus(runtimeId?: string): Promise<any> {
    const suffix = runtimeId === undefined
      ? ''
      : `?runtimeId=${encodeURIComponent(runtimeId)}`;
    const body = await this.responseBody(await this.fetch(`/api/status${suffix}`));
    if (body?.protocol?.version !== REFLEX_DEVTOOLS_PROTOCOL_VERSION) {
      throw new DevToolsProtocolMismatchError(body?.protocol?.version);
    }
    return body;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      const body: any = await response.json().catch(() => null);
      return response.ok
        && body?.protocolVersion === REFLEX_DEVTOOLS_PROTOCOL_VERSION;
    } catch {
      return false;
    }
  }
}
