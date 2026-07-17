import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageRetentionError, TraceStorage } from './storage.js';
import {
  mapSetReflexReplacer,
  reflexReplacer,
  reflexReviver,
} from '../serialization.js';
import {
  createKeyRedactor,
  redactDevtoolsEvent,
  type DevtoolsRedaction,
} from '../redaction.js';
import {
  REFLEX_DEVTOOLS_CLIENT_HEADER,
  REFLEX_DEVTOOLS_DEFAULT_RUNTIME_PAYLOAD_BYTES,
  REFLEX_DEVTOOLS_MAX_RUNTIME_PAYLOAD_BYTES,
  REFLEX_DEVTOOLS_PROTOCOL_HEADER,
  REFLEX_DEVTOOLS_PROTOCOL_VERSION,
  REFLEX_DEVTOOLS_RUNTIME_ERROR_TYPE,
  REFLEX_DEVTOOLS_RUNTIME_SESSION_HEADER,
  REFLEX_DEVTOOLS_TELEMETRY_DROPPED_CODE,
  REFLEX_DEVTOOLS_WS_PROTOCOL,
  type DevtoolsCapability,
  type DevtoolsClientRole,
  type RuntimeTelemetryDroppedPayload,
  type RuntimeTelemetryDropReason,
} from '../protocol.js';
import {
  createSessionTokens,
  hasSupportedWebSocketProtocol,
  isAllowedOrigin,
  isLoopbackAddress,
  isLoopbackHost,
  normalizeAllowedOrigins,
  normalizeHost,
  parseHostHeader,
  readBearerToken,
  tokensEqual,
  type SessionTokens,
} from './security.js';

export {
  createKeyRedactor,
  DEFAULT_SENSITIVE_KEYS,
} from '../redaction.js';
export type {
  DevtoolsRedaction,
  KeyRedactorOptions,
  RedactionContext,
  StateRedactor,
  TraceRedactor,
} from '../redaction.js';
export {
  REFLEX_DEVTOOLS_PROTOCOL_VERSION,
} from '../protocol.js';
export type {
  DevtoolsCapability,
  DevtoolsClientRole,
  DevtoolsProtocolInfo,
} from '../protocol.js';

export interface AuditRecord {
  readonly id: string;
  readonly requestId: string;
  readonly timestamp: number;
  readonly principal: 'mcp' | 'ui';
  readonly client: string;
  readonly transport: 'http' | 'websocket';
  readonly action: 'dispatch' | 'restore';
  readonly capability: 'dispatch' | 'restore';
  readonly target?: string;
  readonly status:
    | 'accepted'
    | 'denied'
    | 'succeeded'
    | 'failed'
    | 'effects-failed'
    | 'unknown';
  readonly reason?: string;
  readonly traceId?: number;
  readonly durationMs?: number;
  readonly sessionEpoch: number;
  readonly protocolVersion: number;
}

export interface ServerConfig {
  port: number;
  host?: string;
  maxTraces?: number;
  enableMCP?: boolean;
  /** Read-only by default. Mutation capabilities require an explicit grant. */
  capabilities?: readonly DevtoolsCapability[];
  /** Per-role process-scoped credentials. Missing local credentials are generated. */
  tokens?: Partial<Record<DevtoolsClientRole, string>>;
  /** Required before binding to anything other than loopback. */
  allowRemote?: boolean;
  /** Exact Host header names, without ports. */
  allowedHosts?: readonly string[];
  /** Exact browser origins, including scheme and port. */
  allowedOrigins?: readonly string[];
  maxControlPayloadBytes?: number;
  maxRuntimePayloadBytes?: number;
  maxPendingActions?: number;
  maxAuditRecords?: number;
  maxPendingWebSockets?: number;
  maxUiClients?: number;
  redaction?: DevtoolsRedaction | false;
  onAuditRecord?: (record: AuditRecord) => void | Promise<void>;
}

interface AuthContext {
  readonly role: DevtoolsClientRole;
  readonly capabilities: ReadonlySet<DevtoolsCapability>;
  readonly client: string;
}

interface PendingDispatch {
  readonly res: Response;
  readonly timeout: NodeJS.Timeout;
  readonly runtimeSessionId: string;
  readonly requestId: string;
  readonly startedAt: number;
  readonly target: string;
  readonly client: string;
}

interface PendingSubEval {
  readonly res: Response;
  readonly timeout: NodeJS.Timeout;
  readonly runtimeSessionId: string;
}

interface RuntimeSocketMetadata {
  readonly sessionId: string;
  readonly protocolVersion: number;
  readonly inspectorApiVersion: number;
}

interface UiSocketMetadata {
  readonly auth: AuthContext;
  readonly origin?: string;
}

interface RuntimeTelemetryDrop {
  readonly reason: RuntimeTelemetryDropReason;
  readonly eventType: string;
}

type RuntimeEventProcessingResult =
  | { readonly status: 'accepted'; readonly notice?: RuntimeTelemetryDrop }
  | { readonly status: 'dropped'; readonly notice: RuntimeTelemetryDrop }
  | { readonly status: 'invalid' }
  | { readonly status: 'internal-error' };

const DISPATCH_OUTCOME_TIMEOUT_MS = 5000;
const SUB_EVAL_TIMEOUT_MS = 5000;
const WEBSOCKET_AUTH_TIMEOUT_MS = 3000;
const DEFAULT_CONTROL_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_MAX_PENDING_ACTIONS = 32;
const DEFAULT_MAX_AUDIT_RECORDS = 500;
const DEFAULT_MAX_PENDING_WEBSOCKETS = 16;
const MAX_EVENT_ID_LENGTH = 256;
const MAX_EVENT_PARAMS = 100;
const MAX_TRACE_QUERY_LIMIT = 1000;
const MAX_RUNTIME_MESSAGES_PER_MINUTE = 6000;
const MAX_UI_MESSAGES_PER_MINUTE = 120;
const MAX_RUNTIME_TRACES_PER_MESSAGE = 2000;
const MAX_TRACE_PATCHES_PER_MESSAGE = 20_000;
const MAX_ACTIVE_SUB_CHANGES_PER_MESSAGE = 5000;
const MAX_HANDLER_KEYS_PER_TYPE = 10_000;
const MAX_RUNTIME_EFFECT_ADAPTERS = 1000;
const MAX_DIAGNOSTIC_KEY_LENGTH = 4096;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Map)
    && !(value instanceof Set);
}

function boundedInteger(
  name: string,
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isInteger(resolved)
    || resolved < 1
    || resolved > maximum
  ) {
    throw new Error(
      `[Reflex Devtools] ${name} must be an integer from 1 to ${maximum}.`,
    );
  }
  return resolved;
}

function uniqueCapabilities(
  capabilities: readonly DevtoolsCapability[] | undefined,
): ReadonlySet<DevtoolsCapability> {
  const supported = new Set<DevtoolsCapability>(['inspect', 'dispatch', 'restore']);
  const result = new Set<DevtoolsCapability>();
  for (const capability of capabilities ?? ['inspect']) {
    if (!supported.has(capability)) {
      throw new Error(`[Reflex Devtools] Unknown capability: ${capability}`);
    }
    result.add(capability);
  }
  return result;
}

function jsonBodyParser(limit: number) {
  return express.json({
    inflate: false,
    limit,
    strict: true,
    reviver: reflexReviver,
  });
}

export class DevtoolsServer {
  private readonly app: express.Application;
  private readonly server: HttpServer;
  private readonly sdkWss: WebSocketServer;
  private readonly uiWss: WebSocketServer;
  private readonly config: ServerConfig & {
    host: string;
    maxTraces: number;
    enableMCP: boolean;
    maxControlPayloadBytes: number;
    maxRuntimePayloadBytes: number;
    maxPendingActions: number;
    maxAuditRecords: number;
    maxPendingWebSockets: number;
    maxUiClients: number;
  };
  private readonly capabilities: ReadonlySet<DevtoolsCapability>;
  private readonly tokens: SessionTokens;
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly redaction: DevtoolsRedaction | undefined;
  private readonly uiClients = new Map<WebSocket, UiSocketMetadata>();
  private readonly pendingWebSockets = new Set<WebSocket>();
  private readonly auditRecords: AuditRecord[] = [];
  private readonly uiPath: string;
  private readonly storage: TraceStorage | null;
  private readonly pendingDispatches = new Map<string, PendingDispatch>();
  private readonly pendingSubEvals = new Map<string, PendingSubEval>();
  private readonly socketLiveness = new WeakMap<WebSocket, boolean>();
  private sdkClient: WebSocket | null = null;
  private runtimeSocketMetadata: RuntimeSocketMetadata | null = null;
  private sessionEpoch = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config: ServerConfig) {
    const host = config.host ?? '127.0.0.1';
    const loopbackOnly = isLoopbackHost(host);

    if (!loopbackOnly) {
      if (!config.allowRemote) {
        throw new Error(
          `[Reflex Devtools] Refusing non-loopback host "${host}". ` +
          'Use allowRemote only with explicit credentials, Host/Origin allowlists, and a trusted TLS boundary.',
        );
      }
      if (!config.allowedHosts?.length) {
        throw new Error(
          '[Reflex Devtools] Non-loopback binding requires at least one exact allowedHosts entry.',
        );
      }
      if (!config.allowedOrigins?.length) {
        throw new Error(
          '[Reflex Devtools] Non-loopback binding requires at least one exact allowedOrigins entry.',
        );
      }
      for (const role of ['runtime', 'ui', 'mcp'] as const) {
        if (!config.tokens?.[role]) {
          throw new Error(
            `[Reflex Devtools] Non-loopback binding requires an explicit ${role} token.`,
          );
        }
      }
    }

    this.config = {
      ...config,
      host,
      maxTraces: boundedInteger(
        'maxTraces',
        config.maxTraces,
        1000,
        100_000,
      ),
      enableMCP: config.enableMCP ?? false,
      maxControlPayloadBytes: boundedInteger(
        'maxControlPayloadBytes',
        config.maxControlPayloadBytes,
        DEFAULT_CONTROL_PAYLOAD_BYTES,
        1024 * 1024,
      ),
      maxRuntimePayloadBytes: boundedInteger(
        'maxRuntimePayloadBytes',
        config.maxRuntimePayloadBytes,
        REFLEX_DEVTOOLS_DEFAULT_RUNTIME_PAYLOAD_BYTES,
        REFLEX_DEVTOOLS_MAX_RUNTIME_PAYLOAD_BYTES,
      ),
      maxPendingActions: boundedInteger(
        'maxPendingActions',
        config.maxPendingActions,
        DEFAULT_MAX_PENDING_ACTIONS,
        1024,
      ),
      maxAuditRecords: boundedInteger(
        'maxAuditRecords',
        config.maxAuditRecords,
        DEFAULT_MAX_AUDIT_RECORDS,
        10_000,
      ),
      maxPendingWebSockets: boundedInteger(
        'maxPendingWebSockets',
        config.maxPendingWebSockets,
        DEFAULT_MAX_PENDING_WEBSOCKETS,
        1024,
      ),
      maxUiClients: boundedInteger(
        'maxUiClients',
        config.maxUiClients,
        8,
        64,
      ),
    };
    this.capabilities = uniqueCapabilities(config.capabilities);
    this.tokens = createSessionTokens(config.tokens);
    this.allowedOrigins = normalizeAllowedOrigins(config.allowedOrigins);

    const allowedHosts = new Set<string>();
    for (const configuredHost of config.allowedHosts ?? []) {
      const parsed = parseHostHeader(configuredHost);
      if (!parsed || parsed !== normalizeHost(configuredHost)) {
        throw new Error(
          '[Reflex Devtools] allowedHosts entries must be exact host names without ports, credentials, or paths.',
        );
      }
      allowedHosts.add(parsed);
    }
    if (loopbackOnly) {
      allowedHosts.add('127.0.0.1');
      allowedHosts.add('localhost');
      allowedHosts.add('::1');
      allowedHosts.add(normalizeHost(host));
    }
    this.allowedHosts = allowedHosts;

    if (config.redaction === false) {
      this.redaction = undefined;
    } else {
      const redactSensitiveKeys = createKeyRedactor();
      this.redaction = {
        state: config.redaction?.state ?? redactSensitiveKeys,
        trace: config.redaction?.trace ?? redactSensitiveKeys,
      };
    }

    this.storage = this.config.enableMCP
      ? new TraceStorage(this.config.maxTraces)
      : null;
    if (this.storage) {
      console.log('[Reflex Devtools] MCP inspection enabled - trace storage active');
    }

    const filename = fileURLToPath(import.meta.url);
    this.uiPath = path.join(path.dirname(filename), '../ui');

    this.app = express();
    this.app.disable('x-powered-by');
    this.server = createServer(
      { maxHeaderSize: 16 * 1024 },
      this.app,
    );
    this.server.requestTimeout = 15_000;
    this.server.headersTimeout = 10_000;
    this.server.keepAliveTimeout = 5_000;
    this.server.maxHeadersCount = 100;

    this.sdkWss = new WebSocketServer({
      noServer: true,
      maxPayload: this.config.maxRuntimePayloadBytes,
      perMessageDeflate: false,
      handleProtocols: (protocols) =>
        protocols.has(REFLEX_DEVTOOLS_WS_PROTOCOL)
          ? REFLEX_DEVTOOLS_WS_PROTOCOL
          : false,
    });
    this.uiWss = new WebSocketServer({
      noServer: true,
      maxPayload: this.config.maxControlPayloadBytes,
      perMessageDeflate: false,
      handleProtocols: (protocols) =>
        protocols.has(REFLEX_DEVTOOLS_WS_PROTOCOL)
          ? REFLEX_DEVTOOLS_WS_PROTOCOL
          : false,
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSockets();
  }

  private setupMiddleware(): void {
    this.app.use((req, res, next) => {
      res.setHeader(
        'Reflex-DevTools-Protocol-Version',
        String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=()',
      );
      if (
        req.path.startsWith('/api/')
        || req.path.startsWith('/auth/')
        || req.path === '/event'
      ) {
        res.setHeader('Cache-Control', 'no-store');
      }
      next();
    });

    this.app.use((req, res, next) => {
      if (this.headerCount(req.rawHeaders, 'host') !== 1) {
        res.status(400).json({
          success: false,
          code: 'INVALID_HOST',
          error: 'Exactly one Host header is required.',
        });
        return;
      }
      if (this.headerCount(req.rawHeaders, 'origin') > 1) {
        res.status(400).json({
          success: false,
          code: 'INVALID_ORIGIN',
          error: 'At most one Origin header is allowed.',
        });
        return;
      }
      const host = parseHostHeader(req.headers.host);
      if (!host) {
        res.status(400).json({
          success: false,
          code: 'INVALID_HOST',
          error: 'A valid Host header is required.',
        });
        return;
      }
      if (!this.allowedHosts.has(host)) {
        res.status(403).json({
          success: false,
          code: 'HOST_NOT_ALLOWED',
          error: 'Host is not allowed.',
        });
        return;
      }

      const origin = req.headers.origin;
      if (!isAllowedOrigin(
        origin,
        this.allowedOrigins,
        isLoopbackHost(this.config.host) ? req.headers.host : undefined,
      )) {
        res.status(403).json({
          success: false,
          code: 'ORIGIN_NOT_ALLOWED',
          error: 'Origin is not allowed.',
        });
        return;
      }

      const requestHost = req.headers.host!;
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; " +
        "object-src 'none'; form-action 'none'; worker-src 'none'; " +
        "script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        `img-src 'self' data:; connect-src 'self' ` +
        `ws://${requestHost} wss://${requestHost}`,
      );

      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader(
          'Access-Control-Expose-Headers',
          'Reflex-DevTools-Protocol-Version',
        );
        res.setHeader(
          'Access-Control-Allow-Headers',
          [
            'Authorization',
            'Content-Type',
            'Reflex-DevTools-Protocol-Version',
            'X-Reflex-Client',
            'X-Reflex-Runtime-Session',
          ].join(', '),
        );
        res.setHeader('Access-Control-Max-Age', '600');
      }

      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  private setupRoutes(): void {
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
        authenticationRequired: true,
        timestamp: Date.now(),
      });
    });

    this.app.post(
      '/auth/session',
      this.requireProtocolVersion,
      this.requireJsonContentType,
      jsonBodyParser(8 * 1024),
      (req: Request, res: Response) => {
        if (
          !isLoopbackHost(this.config.host)
          || !isLoopbackAddress(req.socket.remoteAddress)
        ) {
          res.status(403).json({
            success: false,
            code: 'LOCAL_BOOTSTRAP_ONLY',
            error: 'Automatic session bootstrap is available only to loopback clients.',
          });
          return;
        }

        const role = req.body?.role as DevtoolsClientRole | undefined;
        if (role !== 'runtime' && role !== 'ui' && role !== 'mcp') {
          res.status(400).json({
            success: false,
            code: 'INVALID_ROLE',
            error: 'role must be runtime, ui, or mcp.',
          });
          return;
        }
        const origin = req.headers.origin;
        if (origin && role === 'mcp') {
          res.status(403).json({
            success: false,
            code: 'BROWSER_ROLE_DENIED',
            error: 'Browser origins cannot bootstrap the MCP principal.',
          });
          return;
        }
        if (origin && role === 'ui') {
          const sameOrigin = new URL(origin).host.toLowerCase()
            === req.headers.host?.toLowerCase();
          if (!sameOrigin && !this.allowedOrigins.has(origin)) {
            res.status(403).json({
              success: false,
              code: 'UI_ORIGIN_NOT_ALLOWED',
              error: 'The dashboard token is restricted to its own origin.',
            });
            return;
          }
        }

        res.json({
          success: true,
          role,
          token: this.tokens[role],
          capabilities: role === 'runtime'
            ? []
            : [...this.capabilities],
          protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
        });
      },
    );

    this.app.get(
      '/api/status',
      this.authenticateHttp('mcp'),
      (_req: Request, res: Response) => {
        const connected = this.sdkClient?.readyState === WebSocket.OPEN;
        const runtimeInfo = this.storage?.getRuntimeInfo() ?? null;
        const handlerKeys = this.storage?.getHandlerKeys() ?? null;
        const auth = res.locals.auth as AuthContext;

        res.json({
          success: true,
          mcpEnabled: this.config.enableMCP,
          appConnected: connected,
          connectedApps: connected ? 1 : 0,
          connectedUIs: this.uiClients.size,
          sessionEpoch: this.sessionEpoch,
          runtime: runtimeInfo?.runtime ?? null,
          effectMode: runtimeInfo?.effectMode ?? null,
          effects: runtimeInfo?.effects ?? null,
          tracing: runtimeInfo?.tracing ?? null,
          handlers: handlerKeys
            ? {
                event: handlerKeys.event.length,
                fx: handlerKeys.fx.length,
                cofx: handlerKeys.cofx.length,
                sub: handlerKeys.sub.length,
              }
            : null,
          stateAvailable:
            this.storage ? this.storage.getAppState() !== null : false,
          traceCount: this.storage?.getStats().totalTraces ?? 0,
          capabilities: [...auth.capabilities],
          readOnly:
            !auth.capabilities.has('dispatch')
            && !auth.capabilities.has('restore'),
          protocol: {
            version: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
            runtimeVersion:
              this.runtimeSocketMetadata?.protocolVersion ?? null,
            inspectorApiVersion:
              this.runtimeSocketMetadata?.inspectorApiVersion ?? null,
          },
          security: {
            authenticated: true,
            loopbackOnly: isLoopbackHost(this.config.host),
            browserOrigins: 'same-origin-or-explicit',
            redactionEnabled: this.redaction !== undefined,
            auditEnabled: true,
          },
        });
      },
    );

    this.app.get(
      '/api/traces',
      this.authenticateHttp('mcp', 'inspect'),
      (req, res) => {
        if (!this.requireStorage(res)) return;
        try {
          const rawLimit = req.query.limit;
          const limit = rawLimit === undefined
            ? 50
            : /^\d+$/.test(String(rawLimit))
              ? Number(rawLimit)
              : Number.NaN;
          if (
            !Number.isInteger(limit)
            || limit < 1
            || limit > MAX_TRACE_QUERY_LIMIT
          ) {
            res.status(400).json({
              success: false,
              error: `limit must be an integer from 1 to ${MAX_TRACE_QUERY_LIMIT}`,
            });
            return;
          }
          const minDuration = req.query.minDuration === undefined
            ? undefined
            : Number(req.query.minDuration);
          if (
            minDuration !== undefined
            && (!Number.isFinite(minDuration) || minDuration < 0)
          ) {
            res.status(400).json({
              success: false,
              error: 'minDuration must be a non-negative number',
            });
            return;
          }

          const traces = this.storage!.getTraces({
            limit,
            eventFilter:
              typeof req.query.eventFilter === 'string'
                ? req.query.eventFilter.slice(0, MAX_EVENT_ID_LENGTH)
                : undefined,
            minDuration,
            opType:
              typeof req.query.opType === 'string'
                ? req.query.opType.slice(0, 64)
                : undefined,
          }).map((trace) => ({
            id: trace.id,
            start: trace.start,
            duration: trace.duration,
            operation: trace.operation,
            opType: trace.opType,
            childOf: trace.childOf,
            tags: trace.tags
              ? {
                  event: Array.isArray(trace.tags.event)
                    ? trace.tags.event.slice(0, 1)
                    : trace.tags.event,
                  queryV: Array.isArray(trace.tags.queryV)
                    ? trace.tags.queryV.slice(0, 1)
                    : trace.tags.queryV,
                  error: trace.tags.error
                    ? {
                        phase: trace.tags.error.phase,
                        message: trace.tags.error.message,
                      }
                    : undefined,
                  effectErrorCount: Array.isArray(trace.tags.effectErrors)
                    ? trace.tags.effectErrors.length
                    : 0,
                }
              : undefined,
          }));
          this.sendSerialized(res, { success: true, traces });
        } catch (error) {
          this.sendInternalError(res, error);
        }
      },
    );

    this.app.get(
      '/api/traces/:id',
      this.authenticateHttp('mcp', 'inspect'),
      (req, res) => {
        if (!this.requireStorage(res)) return;
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
          res.status(400).json({
            success: false,
            error: 'Trace id must be a number',
          });
          return;
        }
        const trace = this.storage!.getTrace(id);
        if (!trace) {
          res.status(404).json({
            success: false,
            error: `No trace with id ${id}`,
          });
          return;
        }
        const tags = trace.tags
          ? { ...trace.tags }
          : undefined;
        if (tags) delete tags.reversePatches;
        this.sendSerialized(res, {
          success: true,
          trace: { ...trace, tags },
        });
      },
    );

    this.app.get(
      '/api/state',
      this.authenticateHttp('mcp', 'inspect'),
      (req, res) => {
        if (!this.requireStorage(res)) return;
        const pathValue =
          typeof req.query.path === 'string' ? req.query.path : undefined;
        let state = this.storage!.getAppState();
        if (pathValue) {
          if (pathValue.length > 512) {
            res.status(400).json({
              success: false,
              error: 'State path must be at most 512 characters.',
            });
            return;
          }
          const selected = this.selectStatePath(state, pathValue);
          if (!selected.found) {
            res.status(404).json({
              success: false,
              error: `Path "${pathValue}" was not found in state.`,
            });
            return;
          }
          state = selected.value;
        }
        this.sendSerialized(res, {
          success: true,
          path: pathValue ?? null,
          state,
        });
      },
    );

    this.app.get(
      '/api/subscriptions',
      this.authenticateHttp('mcp', 'inspect'),
      (req, res) => {
        if (!this.requireStorage(res)) return;
        const filter = typeof req.query.filter === 'string'
          ? req.query.filter.slice(0, MAX_EVENT_ID_LENGTH).toLowerCase()
          : null;
        const subscriptions = filter
          ? Object.fromEntries(
              Object.entries(this.storage!.getActiveSubs())
                .filter(([key]) => key.toLowerCase().includes(filter)),
            )
          : this.storage!.getActiveSubs();
        this.sendSerialized(res, {
          success: true,
          subscriptions,
          total: Object.keys(this.storage!.getActiveSubs()).length,
        });
      },
    );

    this.app.get(
      '/api/handlers',
      this.authenticateHttp('mcp', 'inspect'),
      (req, res) => {
        if (!this.requireStorage(res)) return;
        const type = req.query.type;
        if (
          type !== undefined
          && type !== 'event'
          && type !== 'fx'
          && type !== 'cofx'
          && type !== 'sub'
        ) {
          res.status(400).json({
            success: false,
            error: 'type must be event, fx, cofx, or sub',
          });
          return;
        }
        const handlerKeys = this.storage!.getHandlerKeys();
        res.json({
          success: true,
          handlerKeys:
            type && handlerKeys
              ? { [type]: handlerKeys[type] }
              : handlerKeys,
        });
      },
    );

    this.app.get(
      '/api/stats',
      this.authenticateHttp('mcp', 'inspect'),
      (_req, res) => {
        if (!this.requireStorage(res)) return;
        res.json({
          success: true,
          stats: this.storage!.getStats(),
        });
      },
    );

    this.app.get(
      '/api/audit',
      this.authenticateHttp('mcp', 'inspect'),
      (req, res) => {
        const rawLimit = req.query.limit;
        const requested = rawLimit === undefined
          ? 100
          : /^\d+$/.test(String(rawLimit))
            ? Number(rawLimit)
            : Number.NaN;
        if (!Number.isInteger(requested) || requested < 1 || requested > 500) {
          res.status(400).json({
            success: false,
            error: 'limit must be an integer from 1 to 500',
          });
          return;
        }
        res.json({
          success: true,
          records: this.auditRecords.slice(-requested),
        });
      },
    );

    this.app.post(
      '/api/dispatch',
      this.authenticateHttp('mcp', 'dispatch', 'dispatch'),
      this.requireJsonContentType,
      jsonBodyParser(this.config.maxControlPayloadBytes),
      (req, res) => this.handleHttpDispatch(req, res),
    );

    this.app.post(
      '/api/eval-sub',
      this.authenticateHttp('mcp', 'inspect'),
      this.requireJsonContentType,
      jsonBodyParser(this.config.maxControlPayloadBytes),
      (req, res) => this.handleHttpEvalSub(req, res),
    );

    this.app.post(
      '/event',
      this.authenticateHttp('runtime'),
      this.requireRuntimeSession,
      this.requireJsonContentType,
      jsonBodyParser(this.config.maxRuntimePayloadBytes),
      (req, res) => {
        const result = this.processInboundRuntimeEvent(
          req.body,
          String(req.headers[REFLEX_DEVTOOLS_RUNTIME_SESSION_HEADER]),
        );
        if (result.status === 'invalid') {
          res.status(422).json({
            success: false,
            code: 'INVALID_RUNTIME_EVENT',
            error: 'Invalid or unsafe runtime event.',
          });
          return;
        }
        if (result.status === 'internal-error') {
          this.sendInternalError(
            res,
            new Error('Runtime telemetry processing failed.'),
          );
          return;
        }
        if (result.status === 'dropped') {
          res.status(422).json({
            success: false,
            ...this.runtimeTelemetryDropPayload(result.notice),
            error: 'Runtime telemetry was not retained.',
          });
          return;
        }
        if (result.notice) {
          res.json({
            success: true,
            notice: this.runtimeTelemetryDropPayload(result.notice),
          });
          return;
        }
        res.json({ success: true });
      },
    );

    this.app.use(express.static(this.uiPath, {
      etag: true,
      fallthrough: true,
      index: false,
      maxAge: 0,
    }));
    this.app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(this.uiPath, 'index.html'));
    });

    this.app.use((
      error: any,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      if (error?.type === 'entity.too.large') {
        res.status(413).json({
          success: false,
          code: 'PAYLOAD_TOO_LARGE',
          error: 'Request payload exceeds the configured limit.',
        });
        return;
      }
      if (
        error instanceof SyntaxError
        || error?.type === 'entity.parse.failed'
      ) {
        res.status(400).json({
          success: false,
          code: 'INVALID_JSON',
          error: 'Request body must be valid JSON.',
        });
        return;
      }
      if (error?.type === 'encoding.unsupported') {
        res.status(415).json({
          success: false,
          code: 'UNSUPPORTED_ENCODING',
          error: 'Compressed request bodies are not supported.',
        });
        return;
      }
      this.sendInternalError(res, error);
    });
  }

  private readonly requireProtocolVersion = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const supplied = req.headers[REFLEX_DEVTOOLS_PROTOCOL_HEADER];
    if (
      this.headerCount(req.rawHeaders, REFLEX_DEVTOOLS_PROTOCOL_HEADER) !== 1
      || supplied !== String(REFLEX_DEVTOOLS_PROTOCOL_VERSION)
    ) {
      res.status(426).json({
        success: false,
        code: 'PROTOCOL_MISMATCH',
        error: 'Unsupported Reflex DevTools protocol version.',
        supportedVersions: [REFLEX_DEVTOOLS_PROTOCOL_VERSION],
      });
      return;
    }
    next();
  };

  private readonly requireJsonContentType = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (!req.is('application/json')) {
      res.status(415).json({
        success: false,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        error: 'Content-Type must be application/json.',
      });
      return;
    }
    next();
  };

  private authenticateHttp(
    role: DevtoolsClientRole,
    capability?: DevtoolsCapability,
    auditedAction?: AuditRecord['action'],
  ) {
    return (
      req: Request,
      res: Response,
      next: NextFunction,
    ): void => {
      const suppliedVersion = req.headers[REFLEX_DEVTOOLS_PROTOCOL_HEADER];
      if (
        this.headerCount(req.rawHeaders, REFLEX_DEVTOOLS_PROTOCOL_HEADER) !== 1
        || suppliedVersion !== String(REFLEX_DEVTOOLS_PROTOCOL_VERSION)
      ) {
        res.status(426).json({
          success: false,
          code: 'PROTOCOL_MISMATCH',
          error: 'Unsupported Reflex DevTools protocol version.',
          supportedVersions: [REFLEX_DEVTOOLS_PROTOCOL_VERSION],
        });
        return;
      }

      const token = readBearerToken(req);
      if (
        this.headerCount(req.rawHeaders, 'authorization') !== 1
        || !token
        || !tokensEqual(token, this.tokens[role])
      ) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="reflex-devtools"');
        res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'A valid session token is required.',
        });
        return;
      }

      const auth: AuthContext = {
        role,
        capabilities: role === 'runtime'
          ? new Set()
          : this.capabilities,
        client: this.sanitizeClientHeader(
          req.headers[REFLEX_DEVTOOLS_CLIENT_HEADER],
          role,
        ),
      };
      res.locals.auth = auth;

      if (capability && !auth.capabilities.has(capability)) {
        const requestId = randomUUID();
        if (auditedAction && role !== 'runtime') {
          this.appendAudit({
            requestId,
            principal: role,
            client: auth.client,
            transport: 'http',
            action: auditedAction,
            capability: capability as 'dispatch' | 'restore',
            status: 'denied',
            reason: 'capability-not-granted',
          });
        }
        res.status(403).json({
          success: false,
          requestId,
          code: 'CAPABILITY_DENIED',
          error: `The ${capability} capability is not granted.`,
          requiredCapability: capability,
        });
        return;
      }
      next();
    };
  }

  private readonly requireRuntimeSession = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const sessionId = req.headers[REFLEX_DEVTOOLS_RUNTIME_SESSION_HEADER];
    if (
      typeof sessionId !== 'string'
      || !this.runtimeSocketMetadata
      || sessionId !== this.runtimeSocketMetadata.sessionId
    ) {
      res.status(409).json({
        success: false,
        code: 'STALE_RUNTIME_SESSION',
        error: 'The runtime session is missing or no longer active.',
      });
      return;
    }
    next();
  };

  private setupWebSockets(): void {
    this.server.on('upgrade', (req, socket, head) => {
      const reject = (status: number, message: string): void => {
        socket.write(
          `HTTP/1.1 ${status} ${message}\r\n` +
          'Connection: close\r\n' +
          'Content-Length: 0\r\n\r\n',
        );
        socket.destroy();
      };

      if (
        this.headerCount(req.rawHeaders, 'host') !== 1
        || this.headerCount(req.rawHeaders, 'origin') > 1
      ) {
        reject(400, 'Bad Request');
        return;
      }
      const host = parseHostHeader(req.headers.host);
      if (!host) {
        reject(400, 'Bad Request');
        return;
      }
      if (!this.allowedHosts.has(host)) {
        reject(403, 'Forbidden');
        return;
      }
      if (!isAllowedOrigin(
        req.headers.origin,
        this.allowedOrigins,
        isLoopbackHost(this.config.host) ? req.headers.host : undefined,
      )) {
        reject(403, 'Forbidden');
        return;
      }
      if (!hasSupportedWebSocketProtocol(req)) {
        reject(426, 'Upgrade Required');
        return;
      }
      if (this.pendingWebSockets.size >= this.config.maxPendingWebSockets) {
        reject(503, 'Service Unavailable');
        return;
      }

      const url = new URL(req.url ?? '/', 'http://reflex.invalid');
      const target = url.pathname === '/sdk'
        ? this.sdkWss
        : url.pathname === '/ui'
          ? this.uiWss
          : null;
      if (!target) {
        reject(404, 'Not Found');
        return;
      }

      target.handleUpgrade(req, socket, head, (ws) => {
        this.socketLiveness.set(ws, true);
        ws.on('pong', () => this.socketLiveness.set(ws, true));
        target.emit('connection', ws, req);
      });
    });

    this.sdkWss.on('connection', (ws, req) => {
      this.authenticateWebSocket(ws, req, 'runtime', (authMessage) => {
        const inspectorApiVersion = authMessage.payload?.inspectorApiVersion;
        if (inspectorApiVersion !== 1) {
          ws.close(1002, 'Unsupported inspector API version');
          return;
        }
        this.activateRuntimeSocket(ws, {
          sessionId: randomUUID(),
          protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
          inspectorApiVersion,
        });
      });
    });

    this.uiWss.on('connection', (ws, req) => {
      this.authenticateWebSocket(ws, req, 'ui', () => {
        const auth: AuthContext = {
          role: 'ui',
          capabilities: this.capabilities,
          client: 'reflex-devtools-ui',
        };
        this.activateUiSocket(ws, req, auth);
      });
    });
  }

  private authenticateWebSocket(
    ws: WebSocket,
    req: IncomingMessage,
    role: 'runtime' | 'ui',
    onAuthenticated: (message: any) => void,
  ): void {
    this.pendingWebSockets.add(ws);
    const timeout = setTimeout(() => {
      this.pendingWebSockets.delete(ws);
      ws.close(1008, 'Authentication timeout');
    }, WEBSOCKET_AUTH_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timeout);
      this.pendingWebSockets.delete(ws);
    };

    ws.once('message', (data, isBinary) => {
      if (isBinary) {
        cleanup();
        ws.close(1003, 'Binary messages are not supported');
        return;
      }

      let message: any;
      try {
        message = JSON.parse(this.rawDataToString(data));
      } catch {
        cleanup();
        ws.close(1007, 'Invalid JSON');
        return;
      }

      const valid =
        message?.type === 'reflex-auth'
        && message.payload?.role === role
        && message.payload?.protocolVersion
          === REFLEX_DEVTOOLS_PROTOCOL_VERSION
        && typeof message.payload?.token === 'string'
        && tokensEqual(message.payload.token, this.tokens[role]);
      if (!valid) {
        cleanup();
        ws.close(1008, 'Authentication failed');
        return;
      }

      cleanup();
      onAuthenticated(message);
    });

    ws.once('close', cleanup);
    ws.once('error', cleanup);

    // An absent Origin is valid only for non-browser peers, and the token is
    // still mandatory. A present Origin was exact-allowlisted before upgrade.
    void req;
  }

  private activateRuntimeSocket(
    ws: WebSocket,
    metadata: RuntimeSocketMetadata,
  ): void {
    const stale = this.sdkClient;

    // Authentication and compatibility have completed. Only now does a new
    // runtime become a session boundary and supersede the previous runtime.
    this.sdkClient = ws;
    this.runtimeSocketMetadata = metadata;
    this.sessionEpoch += 1;
    this.storage?.clear();
    this.failPendingDispatches(
      'App session restarted before the dispatch outcome was observed',
    );
    this.failPendingSubEvals(
      'App session restarted before the subscription evaluation completed',
    );

    if (stale && stale !== ws) {
      stale.close(1000, 'Superseded by a newer authenticated runtime');
    }

    this.sendToSocket(ws, {
      type: 'devtools-server-hello',
      payload: {
        protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
        runtimeSessionId: metadata.sessionId,
        sessionEpoch: this.sessionEpoch,
        capabilities: [...this.capabilities],
        limits: {
          runtimePayloadBytes: this.config.maxRuntimePayloadBytes,
          controlPayloadBytes: this.config.maxControlPayloadBytes,
        },
      },
      timestamp: Date.now(),
    });
    this.sendTracingDemand(ws);

    const withinRateLimit = this.createMessageRateLimiter(
      MAX_RUNTIME_MESSAGES_PER_MINUTE,
    );
    ws.on('message', (data, isBinary) => {
      if (!withinRateLimit()) {
        ws.close(1008, 'Runtime message rate limit exceeded');
        return;
      }
      if (isBinary) {
        ws.close(1003, 'Binary messages are not supported');
        return;
      }
      let event: any;
      try {
        event = JSON.parse(this.rawDataToString(data), reflexReviver);
      } catch {
        ws.close(1007, 'Invalid JSON');
        return;
      }
      const result = this.processInboundRuntimeEvent(event, metadata.sessionId);
      if (result.status === 'invalid') {
        ws.close(1008, 'Invalid runtime event');
        return;
      }
      if (result.status === 'internal-error') {
        ws.close(1011, 'Runtime event processing failed');
        return;
      }
      if (result.notice) {
        this.sendRuntimeTelemetryNotice(ws, result.notice);
      }
    });

    const remove = (): void => {
      if (this.sdkClient !== ws) return;
      this.sdkClient = null;
      this.runtimeSocketMetadata = null;
      this.failPendingDispatches(
        'App disconnected before reporting the dispatch outcome',
      );
      this.failPendingSubEvals(
        'App disconnected before reporting the subscription value',
      );
    };
    ws.on('close', remove);
    ws.on('error', remove);
  }

  private activateUiSocket(
    ws: WebSocket,
    req: IncomingMessage,
    auth: AuthContext,
  ): void {
    if (this.uiClients.size >= this.config.maxUiClients) {
      ws.close(1013, 'Too many dashboard connections');
      return;
    }
    const metadata: UiSocketMetadata = {
      auth,
      origin: req.headers.origin,
    };
    this.uiClients.set(ws, metadata);
    this.notifySDKClientsUIStatus();

    this.sendToSocket(ws, {
      type: 'devtools-connected',
      payload: {
        message: 'Connected to Reflex Devtools',
        protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
        capabilities: [...auth.capabilities],
        readOnly:
          !auth.capabilities.has('dispatch')
          && !auth.capabilities.has('restore'),
      },
      timestamp: Date.now(),
    });

    const withinRateLimit = this.createMessageRateLimiter(
      MAX_UI_MESSAGES_PER_MINUTE,
    );
    ws.on('message', (data, isBinary) => {
      if (!withinRateLimit()) {
        ws.close(1008, 'UI message rate limit exceeded');
        return;
      }
      if (isBinary) {
        ws.close(1003, 'Binary messages are not supported');
        return;
      }

      let message: any;
      try {
        message = JSON.parse(this.rawDataToString(data));
      } catch {
        ws.close(1007, 'Invalid JSON');
        return;
      }

      if (message?.type !== 'dispatch-to-client') {
        ws.close(1008, 'Unsupported UI message');
        return;
      }
      if (!auth.capabilities.has('dispatch')) {
        const requestId = randomUUID();
        this.appendAudit({
          requestId,
          principal: 'ui',
          client: auth.client,
          transport: 'websocket',
          action: 'dispatch',
          capability: 'dispatch',
          target: this.validEventId(message.payload?.eventName)
            ? message.payload.eventName
            : undefined,
          status: 'denied',
          reason: 'capability-not-granted',
        });
        this.sendToSocket(ws, {
          type: 'devtools-error',
          payload: {
            requestId,
            code: 'CAPABILITY_DENIED',
            message: 'The dispatch capability is not granted.',
          },
        });
        return;
      }
      if (!this.validDispatchPayload(message.payload)) {
        const requestId = randomUUID();
        this.appendAudit({
          requestId,
          principal: 'ui',
          client: auth.client,
          transport: 'websocket',
          action: 'dispatch',
          capability: 'dispatch',
          target: this.validEventId(message.payload?.eventName)
            ? message.payload.eventName
            : undefined,
          status: 'denied',
          reason: 'invalid-payload',
        });
        this.sendToSocket(ws, {
          type: 'devtools-error',
          payload: {
            requestId,
            code: 'INVALID_DISPATCH',
            message: 'Invalid dispatch payload.',
          },
        });
        return;
      }

      const requestId = randomUUID();
      const sent = this.broadcastToSDK({
        type: 'dispatch-to-client',
        payload: {
          eventName: message.payload.eventName,
          params: message.payload.params ?? [],
        },
        timestamp: Date.now(),
      });
      this.appendAudit({
        requestId,
        principal: 'ui',
        client: auth.client,
        transport: 'websocket',
        action: 'dispatch',
        capability: 'dispatch',
        target: message.payload.eventName,
        status: sent > 0 ? 'accepted' : 'unknown',
        reason: sent > 0 ? undefined : 'no-runtime-connected',
      });
    });

    const remove = (): void => {
      if (!this.uiClients.delete(ws)) return;
      this.notifySDKClientsUIStatus();
    };
    ws.on('close', remove);
    ws.on('error', remove);
  }

  private handleHttpDispatch(req: Request, res: Response): void {
    const auth = res.locals.auth as AuthContext;
    const requestId = randomUUID();
    const target = this.validEventId(req.body?.eventName)
      ? req.body.eventName
      : undefined;
    if (!this.config.enableMCP) {
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        status: 'denied',
        reason: 'mcp-disabled',
      });
      res.status(503).json({
        success: false,
        requestId,
        error: 'MCP dispatch requires the DevTools server to be started with --mcp.',
      });
      return;
    }
    if (!this.validDispatchPayload(req.body)) {
      const error =
        !this.validEventId(req.body?.eventName)
          ? `eventName is required and must be at most ${MAX_EVENT_ID_LENGTH} characters`
          : !Array.isArray(req.body?.params)
            ? 'params must be an array'
            : `params must contain at most ${MAX_EVENT_PARAMS} items`;
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        status: 'denied',
        reason: 'invalid-payload',
      });
      res.status(400).json({ success: false, requestId, error });
      return;
    }
    if (
      this.pendingDispatches.size + this.pendingSubEvals.size
      >= this.config.maxPendingActions
    ) {
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        status: 'denied',
        reason: 'pending-action-limit',
      });
      res.status(429).json({
        success: false,
        requestId,
        code: 'TOO_MANY_PENDING_ACTIONS',
        error: 'Too many DevTools actions are already pending.',
      });
      return;
    }
    if (
      !this.sdkClient
      || this.sdkClient.readyState !== WebSocket.OPEN
      || !this.runtimeSocketMetadata
    ) {
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        status: 'unknown',
        reason: 'no-runtime-connected',
      });
      res.status(503).json({
        success: false,
        requestId,
        error: 'No app connected to the devtools server; the event was not dispatched',
      });
      return;
    }

    const dispatchId = randomUUID();
    const runtimeSessionId = this.runtimeSocketMetadata.sessionId;
    const startedAt = Date.now();
    const sent = this.broadcastToSDK({
      type: 'dispatch-to-client',
      payload: {
        dispatchId,
        eventName: req.body.eventName,
        params: req.body.params ?? [],
      },
      timestamp: startedAt,
    });
    if (sent === 0) {
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        status: 'unknown',
        reason: 'runtime-disconnected',
      });
      res.status(503).json({
        success: false,
        requestId,
        error: 'No app connected to the devtools server; the event was not dispatched',
      });
      return;
    }

    this.appendAudit({
      requestId,
      principal: 'mcp',
      client: auth.client,
      transport: 'http',
      action: 'dispatch',
      capability: 'dispatch',
      target: req.body.eventName,
      status: 'accepted',
    });

    const timeout = setTimeout(() => {
      this.pendingDispatches.delete(dispatchId);
      const message =
        `Event dispatched, but the app reported no trace for it within ` +
        `${DISPATCH_OUTCOME_TIMEOUT_MS}ms`;
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target: req.body.eventName,
        status: 'unknown',
        reason: 'outcome-timeout',
        durationMs: Date.now() - startedAt,
      });
      res.json({
        success: true,
        outcome: 'unknown',
        requestId,
        message,
      });
    }, DISPATCH_OUTCOME_TIMEOUT_MS);

    this.pendingDispatches.set(dispatchId, {
      res,
      timeout,
      runtimeSessionId,
      requestId,
      startedAt,
      target: req.body.eventName,
      client: auth.client,
    });
  }

  private handleHttpEvalSub(req: Request, res: Response): void {
    if (!this.config.enableMCP) {
      res.status(503).json({
        success: false,
        error: 'MCP subscription evaluation requires --mcp.',
      });
      return;
    }
    const { id, args } = req.body ?? {};
    if (!this.validEventId(id)) {
      res.status(400).json({
        success: false,
        error: `id is required and must be at most ${MAX_EVENT_ID_LENGTH} characters`,
      });
      return;
    }
    if (args != null && !Array.isArray(args)) {
      res.status(400).json({ success: false, error: 'args must be an array' });
      return;
    }
    if ((args?.length ?? 0) > MAX_EVENT_PARAMS) {
      res.status(400).json({
        success: false,
        error: `args must contain at most ${MAX_EVENT_PARAMS} items`,
      });
      return;
    }
    if (
      this.pendingDispatches.size + this.pendingSubEvals.size
      >= this.config.maxPendingActions
    ) {
      res.status(429).json({
        success: false,
        code: 'TOO_MANY_PENDING_ACTIONS',
        error: 'Too many DevTools actions are already pending.',
      });
      return;
    }
    if (!this.runtimeSocketMetadata) {
      res.status(503).json({
        success: false,
        error: 'No app connected to the devtools server; the subscription was not evaluated',
      });
      return;
    }

    const evalId = randomUUID();
    const runtimeSessionId = this.runtimeSocketMetadata.sessionId;
    const sent = this.broadcastToSDK({
      type: 'eval-sub-to-client',
      payload: { evalId, id, args: args ?? [] },
      timestamp: Date.now(),
    });
    if (sent === 0) {
      res.status(503).json({
        success: false,
        error: 'No app connected to the devtools server; the subscription was not evaluated',
      });
      return;
    }

    const timeout = setTimeout(() => {
      this.pendingSubEvals.delete(evalId);
      res.status(504).json({
        success: false,
        error: `Subscription evaluation timed out after ${SUB_EVAL_TIMEOUT_MS}ms`,
      });
    }, SUB_EVAL_TIMEOUT_MS);
    this.pendingSubEvals.set(evalId, {
      res,
      timeout,
      runtimeSessionId,
    });
  }

  private processInboundRuntimeEvent(
    candidate: any,
    runtimeSessionId: string,
  ): RuntimeEventProcessingResult {
    if (
      !candidate
      || typeof candidate !== 'object'
      || typeof candidate.type !== 'string'
      || candidate.type.length === 0
      || candidate.type.length > 128
      || /[\u0000-\u001F\u007F]/.test(candidate.type)
    ) {
      return { status: 'invalid' };
    }
    if (this.runtimeSocketMetadata?.sessionId !== runtimeSessionId) {
      return { status: 'invalid' };
    }
    if (!this.validRuntimeEvent(candidate)) return { status: 'invalid' };

    let event: any;
    try {
      event = redactDevtoolsEvent(candidate, this.redaction, 'server');
    } catch {
      console.error(
        `[Reflex Devtools] Redaction failed for event type ${candidate.type}; payload dropped.`,
      );
      return {
        status: 'dropped',
        notice: {
          reason: 'redaction-failed',
          eventType: candidate.type,
        },
      };
    }

    try {
      if (event.type === 'reflex-dispatch-result') {
        this.resolveDispatch(event.payload, runtimeSessionId);
        return { status: 'accepted' };
      }
      if (event.type === 'reflex-eval-sub-result') {
        this.resolveSubEval(event.payload, runtimeSessionId);
        return { status: 'accepted' };
      }

      const retentionRejected = this.processStorageEvent(event);
      this.broadcastEventToUI(event);
      return retentionRejected
        ? {
            status: 'accepted',
            notice: {
              reason: 'retention-limit',
              eventType: event.type,
            },
          }
        : { status: 'accepted' };
    } catch (error) {
      if (error instanceof StorageRetentionError) {
        console.warn(
          `[Reflex Devtools] Retention limit rejected event type ${candidate.type}; payload dropped.`,
        );
        return {
          status: 'dropped',
          notice: {
            reason: 'retention-limit',
            eventType: candidate.type,
          },
        };
      }
      console.error(
        `[Reflex Devtools] Internal processing failure for runtime event type ${candidate.type}.`,
      );
      return { status: 'internal-error' };
    }
  }

  private processStorageEvent(event: any): boolean {
    if (!this.storage) return false;
    switch (event.type) {
      case 'reflex-traces':
        if (Array.isArray(event.payload)) {
          return this.storage.addTraces(event.payload);
        }
        break;
      case 'reflex-app-db':
        if (event.payload !== undefined) {
          this.storage.updateAppState(event.payload);
        }
        break;
      case 'reflex-active-subs':
        if (event.payload && typeof event.payload === 'object') {
          this.storage.updateActiveSubs(event.payload);
        }
        break;
      case 'reflex-handler-keys':
        if (event.payload) this.storage.updateHandlerKeys(event.payload);
        break;
      case 'reflex-runtime-info':
        if (event.payload) this.storage.updateRuntimeInfo(event.payload);
        break;
    }
    return false;
  }

  private resolveDispatch(payload: any, runtimeSessionId: string): void {
    const dispatchId = payload?.dispatchId;
    if (typeof dispatchId !== 'string') return;
    const pending = this.pendingDispatches.get(dispatchId);
    if (!pending || pending.runtimeSessionId !== runtimeSessionId) return;

    clearTimeout(pending.timeout);
    this.pendingDispatches.delete(dispatchId);

    let body: Record<string, any>;
    let status: AuditRecord['status'];
    let reason: string | undefined;
    if (payload.trace) {
      const tags = payload.trace.tags || {};
      const outcome = tags.error
        ? 'failed'
        : tags.effectErrors?.length
          ? 'effects-failed'
          : 'succeeded';
      status = outcome;
      body = {
        success: true,
        outcome,
        requestId: pending.requestId,
        traceId: payload.trace.id,
        event: tags.event,
        duration: payload.trace.duration,
        error: tags.error,
        effectErrors: tags.effectErrors,
        patches: tags.patches,
        effects: tags.effects,
      };
    } else {
      status = 'unknown';
      reason = payload.reason || 'no-trace';
      body = {
        success: true,
        outcome: 'unknown',
        requestId: pending.requestId,
        message: payload.reason || 'The app reported no trace for this dispatch',
      };
    }

    this.appendAudit({
      requestId: pending.requestId,
      principal: 'mcp',
      client: pending.client,
      transport: 'http',
      action: 'dispatch',
      capability: 'dispatch',
      target: pending.target,
      status,
      reason,
      traceId: payload.trace?.id,
      durationMs: Date.now() - pending.startedAt,
    });
    this.sendSerialized(pending.res, body);
  }

  private resolveSubEval(payload: any, runtimeSessionId: string): void {
    const evalId = payload?.evalId;
    if (typeof evalId !== 'string') return;
    const pending = this.pendingSubEvals.get(evalId);
    if (!pending || pending.runtimeSessionId !== runtimeSessionId) return;

    clearTimeout(pending.timeout);
    this.pendingSubEvals.delete(evalId);
    if (payload.error) {
      pending.res
        .status(payload.error.phase === 'missing-handler' ? 404 : 422)
        .json({ success: false, error: payload.error });
      return;
    }
    this.sendSerialized(pending.res, {
      success: true,
      value: payload.value,
    });
  }

  private failPendingDispatches(reason: string): void {
    for (const [dispatchId, pending] of this.pendingDispatches) {
      clearTimeout(pending.timeout);
      this.pendingDispatches.delete(dispatchId);
      this.appendAudit({
        requestId: pending.requestId,
        principal: 'mcp',
        client: pending.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target: pending.target,
        status: 'unknown',
        reason,
        durationMs: Date.now() - pending.startedAt,
      });
      pending.res.json({
        success: true,
        outcome: 'unknown',
        requestId: pending.requestId,
        message: reason,
      });
    }
  }

  private failPendingSubEvals(reason: string): void {
    for (const [evalId, pending] of this.pendingSubEvals) {
      clearTimeout(pending.timeout);
      this.pendingSubEvals.delete(evalId);
      pending.res.status(503).json({ success: false, error: reason });
    }
  }

  private getTracingDemandCount(): number {
    const mcpNeedsTracing =
      this.config.enableMCP
      && (this.capabilities.has('inspect') || this.capabilities.has('dispatch'));
    const uiNeedsTracing = [...this.uiClients.values()].some(({ auth }) =>
      auth.capabilities.has('inspect') || auth.capabilities.has('dispatch'));
    return mcpNeedsTracing || uiNeedsTracing ? 1 : 0;
  }

  private sendTracingDemand(ws: WebSocket): void {
    this.sendToSocket(ws, {
      type: 'ui-connection-status',
      payload: { connectedUIs: this.getTracingDemandCount() },
      timestamp: Date.now(),
    });
  }

  private notifySDKClientsUIStatus(): void {
    if (this.sdkClient?.readyState === WebSocket.OPEN) {
      this.sendTracingDemand(this.sdkClient);
    }
  }

  private broadcastEventToUI(event: any): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(event, reflexReplacer);
    } catch {
      return;
    }
    for (const [client, metadata] of this.uiClients) {
      if (!metadata.auth.capabilities.has('inspect')) continue;
      this.sendRawToSocket(client, serialized);
    }
  }

  private broadcastToSDK(message: any): number {
    const client = this.sdkClient;
    if (!client || client.readyState !== WebSocket.OPEN) return 0;
    return this.sendToSocket(client, message) ? 1 : 0;
  }

  private sendToSocket(client: WebSocket, message: any): boolean {
    let serialized: string;
    try {
      serialized = JSON.stringify(message);
    } catch {
      return false;
    }
    return this.sendRawToSocket(client, serialized);
  }

  private sendRawToSocket(client: WebSocket, serialized: string): boolean {
    if (client.readyState !== WebSocket.OPEN) return false;
    if (
      client.bufferedAmount
      > this.config.maxRuntimePayloadBytes * 2
    ) {
      client.close(1008, 'Backpressure limit exceeded');
      return false;
    }
    try {
      client.send(serialized);
      return true;
    } catch {
      return false;
    }
  }

  private runtimeTelemetryDropPayload(
    drop: RuntimeTelemetryDrop,
  ): RuntimeTelemetryDroppedPayload {
    return {
      code: REFLEX_DEVTOOLS_TELEMETRY_DROPPED_CODE,
      reason: drop.reason,
      eventType: drop.eventType,
    };
  }

  private sendRuntimeTelemetryNotice(
    client: WebSocket,
    drop: RuntimeTelemetryDrop,
  ): void {
    this.sendToSocket(client, {
      type: REFLEX_DEVTOOLS_RUNTIME_ERROR_TYPE,
      payload: this.runtimeTelemetryDropPayload(drop),
      timestamp: Date.now(),
    });
  }

  private appendAudit(
    record: Omit<
      AuditRecord,
      'id' | 'timestamp' | 'sessionEpoch' | 'protocolVersion'
    >,
  ): void {
    const fullRecord: AuditRecord = Object.freeze({
      ...record,
      id: randomUUID(),
      timestamp: Date.now(),
      sessionEpoch: this.sessionEpoch,
      protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
    });
    this.auditRecords.push(fullRecord);
    if (this.auditRecords.length > this.config.maxAuditRecords) {
      this.auditRecords.splice(
        0,
        this.auditRecords.length - this.config.maxAuditRecords,
      );
    }
    if (this.config.onAuditRecord) {
      try {
        void Promise.resolve(this.config.onAuditRecord(fullRecord)).catch(
          () => console.error('[Reflex Devtools] Audit sink failed.'),
        );
      } catch {
        console.error('[Reflex Devtools] Audit sink failed.');
      }
    }
  }

  private sanitizeClientHeader(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const sanitized = value
      .replace(/[^\x20-\x7E]/g, '')
      .trim()
      .slice(0, 128);
    return sanitized || fallback;
  }

  private validEventId(value: unknown): value is string {
    return typeof value === 'string'
      && value.trim().length > 0
      && value.length <= MAX_EVENT_ID_LENGTH
      && !/[\u0000-\u001F\u007F]/.test(value);
  }

  private validDispatchPayload(payload: any): boolean {
    return this.validEventId(payload?.eventName)
      && (payload.params === undefined || Array.isArray(payload.params))
      && (payload.params?.length ?? 0) <= MAX_EVENT_PARAMS;
  }

  private validRuntimeEvent(event: any): boolean {
    switch (event.type) {
      case 'reflex-traces':
        return this.validTraceBatch(event.payload);
      case 'reflex-app-db':
        return event.payload !== undefined;
      case 'reflex-active-subs':
        return this.validActiveSubscriptions(event.payload);
      case 'reflex-handler-keys':
        return this.validHandlerKeys(event.payload);
      case 'reflex-runtime-info':
        return this.validRuntimeInfo(event.payload);
      case 'reflex-dispatch-result':
        return this.validDispatchResult(event.payload);
      case 'reflex-eval-sub-result':
        return this.validSubEvaluationResult(event.payload);
      default:
        return false;
    }
  }

  private validTraceBatch(payload: unknown): boolean {
    if (
      !Array.isArray(payload)
      || payload.length > MAX_RUNTIME_TRACES_PER_MESSAGE
    ) {
      return false;
    }

    let patchCount = 0;
    for (const trace of payload) {
      if (!this.validTrace(trace)) return false;
      for (const key of ['patches', 'reversePatches'] as const) {
        const patches = trace.tags?.[key];
        if (patches !== undefined && !Array.isArray(patches)) return false;
        patchCount += patches?.length ?? 0;
        if (patchCount > MAX_TRACE_PATCHES_PER_MESSAGE) return false;
      }
    }
    return true;
  }

  private validTrace(trace: unknown): trace is Record<string, any> {
    if (!isRecord(trace)) return false;
    if (
      !Number.isSafeInteger(trace.id)
      || trace.id < 0
      || !Number.isFinite(trace.start)
    ) {
      return false;
    }
    for (const key of ['end', 'duration'] as const) {
      if (trace[key] !== undefined && !Number.isFinite(trace[key])) {
        return false;
      }
    }
    for (const [key, limit] of [
      ['operation', MAX_EVENT_ID_LENGTH],
      ['opType', 64],
    ] as const) {
      if (
        trace[key] !== undefined
        && (typeof trace[key] !== 'string' || trace[key].length > limit)
      ) {
        return false;
      }
    }
    if (trace.tags !== undefined && !isRecord(trace.tags)) return false;
    return true;
  }

  private validActiveSubscriptions(payload: unknown): boolean {
    if (!isRecord(payload)) return false;
    const entries = Object.entries(payload);
    return entries.length <= MAX_ACTIVE_SUB_CHANGES_PER_MESSAGE
      && entries.every(([key]) =>
        key.length > 0
        && key.length <= MAX_DIAGNOSTIC_KEY_LENGTH
        && !/[\u0000-\u001F\u007F]/.test(key));
  }

  private validHandlerKeys(payload: unknown): boolean {
    if (!isRecord(payload)) return false;
    return (['event', 'fx', 'cofx', 'sub'] as const).every((key) => {
      const values = payload[key];
      return Array.isArray(values)
        && values.length <= MAX_HANDLER_KEYS_PER_TYPE
        && values.every((value) => this.validEventId(value));
    });
  }

  private validRuntimeInfo(payload: unknown): boolean {
    if (!isRecord(payload)) return false;
    if (
      payload.runtime !== undefined
      && payload.runtime !== 'browser'
      && payload.runtime !== 'headless'
      && payload.runtime !== 'react-native'
    ) {
      return false;
    }
    if (
      payload.effectMode !== undefined
      && (
        typeof payload.effectMode !== 'string'
        || payload.effectMode.length > 256
      )
    ) {
      return false;
    }
    if (
      payload.tracing !== undefined
      && typeof payload.tracing !== 'boolean'
    ) {
      return false;
    }
    if (
      payload.protocolVersion !== undefined
      && payload.protocolVersion !== REFLEX_DEVTOOLS_PROTOCOL_VERSION
    ) {
      return false;
    }
    if (
      payload.inspectorApiVersion !== undefined
      && payload.inspectorApiVersion !== 1
    ) {
      return false;
    }
    if (payload.effects !== undefined) {
      if (!isRecord(payload.effects)) return false;
      const effects = Object.entries(payload.effects);
      if (effects.length > MAX_RUNTIME_EFFECT_ADAPTERS) return false;
      if (!effects.every(([key, value]) =>
        this.validEventId(key)
        && typeof value === 'string'
        && value.length <= 256)) {
        return false;
      }
    }
    return true;
  }

  private validDispatchResult(payload: unknown): boolean {
    if (
      !isRecord(payload)
      || typeof payload.dispatchId !== 'string'
      || payload.dispatchId.length > 128
    ) {
      return false;
    }
    if (
      payload.trace !== undefined
      && !this.validTraceBatch([payload.trace])
    ) {
      return false;
    }
    return payload.reason === undefined
      || (typeof payload.reason === 'string' && payload.reason.length <= 1024);
  }

  private validSubEvaluationResult(payload: unknown): boolean {
    if (
      !isRecord(payload)
      || typeof payload.evalId !== 'string'
      || payload.evalId.length > 128
    ) {
      return false;
    }
    if (payload.error === undefined) return 'value' in payload;
    if (!isRecord(payload.error)) return false;
    return typeof payload.error.phase === 'string'
      && payload.error.phase.length <= 128
      && typeof payload.error.message === 'string'
      && payload.error.message.length <= 4096
      && (
        payload.error.stack === undefined
        || (
          typeof payload.error.stack === 'string'
          && payload.error.stack.length <= 16 * 1024
        )
      );
  }

  private selectStatePath(
    state: unknown,
    pathValue: string,
  ): { found: boolean; value?: unknown } {
    const parts = pathValue
      .split(/\.|\[|\]/)
      .filter((part) => part.length > 0);
    if (parts.length === 0 || parts.length > 64) return { found: false };

    let current: any = state;
    for (const part of parts) {
      if (
        part === '__proto__'
        || part === 'prototype'
        || part === 'constructor'
      ) {
        return { found: false };
      }
      if (current instanceof Map) {
        if (!current.has(part)) return { found: false };
        current = current.get(part);
        continue;
      }
      if (
        current === null
        || (typeof current !== 'object' && !Array.isArray(current))
        || !Object.prototype.hasOwnProperty.call(current, part)
      ) {
        return { found: false };
      }
      current = current[part];
    }
    return { found: true, value: current };
  }

  private requireStorage(res: Response): boolean {
    if (this.storage) return true;
    res.status(503).json({
      success: false,
      error: 'MCP inspection is disabled. Start the server with --mcp.',
    });
    return false;
  }

  private sendSerialized(res: Response, value: unknown): void {
    res
      .type('application/json')
      .send(JSON.stringify(value, mapSetReflexReplacer));
  }

  private sendInternalError(res: Response, error: unknown): void {
    const requestId = randomUUID();
    let errorName = 'UnknownError';
    if (error instanceof Error) {
      try {
        const candidateName = error.name;
        if (/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(candidateName)) {
          errorName = candidateName;
        }
      } catch {
        // Exception objects are untrusted input here; never let a hostile
        // accessor replace the generic error response with another failure.
      }
    }
    console.error(
      `[Reflex Devtools] Internal server error (request ${requestId}; ${errorName}).`,
    );
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'An internal server error occurred.',
      requestId,
    });
  }

  private rawDataToString(data: RawData): string {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    return data.toString('utf8');
  }

  private headerCount(rawHeaders: readonly string[], name: string): number {
    const lowerName = name.toLowerCase();
    let count = 0;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === lowerName) count += 1;
    }
    return count;
  }

  private createMessageRateLimiter(maxPerMinute: number): () => boolean {
    let windowStartedAt = Date.now();
    let messages = 0;
    return () => {
      const now = Date.now();
      if (now - windowStartedAt >= 60_000) {
        windowStartedAt = now;
        messages = 0;
      }
      messages += 1;
      return messages <= maxPerMinute;
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.port, this.config.host, () => {
        this.server.removeListener('error', reject);
        const address = this.server.address();
        const port =
          address && typeof address === 'object'
            ? address.port
            : this.config.port;
        console.log(
          `[Reflex Devtools] Dashboard: http://${this.config.host}:${port}`,
        );
        console.log(
          `[Reflex Devtools] Capabilities: ${[...this.capabilities].join(', ') || 'none'}`,
        );
        this.startHeartbeat();
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.failPendingDispatches('DevTools server stopped');
    this.failPendingSubEvals('DevTools server stopped');

    for (const client of this.pendingWebSockets) client.terminate();
    this.pendingWebSockets.clear();
    for (const client of this.uiClients.keys()) client.terminate();
    this.uiClients.clear();
    this.sdkClient?.terminate();
    this.sdkClient = null;
    this.runtimeSocketMetadata = null;

    return new Promise((resolve) => {
      let websocketServersClosed = 0;
      const closeHttp = (): void => {
        websocketServersClosed += 1;
        if (websocketServersClosed !== 2) return;
        this.server.close(() => {
          console.log('[Reflex Devtools] Server stopped');
          resolve();
        });
      };
      this.sdkWss.close(closeHttp);
      this.uiWss.close(closeHttp);
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const sockets = new Set<WebSocket>([
        ...this.pendingWebSockets,
        ...this.uiClients.keys(),
      ]);
      if (this.sdkClient) sockets.add(this.sdkClient);

      for (const socket of sockets) {
        if (this.socketLiveness.get(socket) === false) {
          socket.terminate();
          continue;
        }
        this.socketLiveness.set(socket, false);
        try {
          socket.ping();
        } catch {
          socket.terminate();
        }
      }
    }, 30_000);
    this.heartbeatTimer.unref?.();
  }
}
