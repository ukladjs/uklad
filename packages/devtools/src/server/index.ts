import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageRetentionError, TraceStorage } from './storage.js';
import { mapSetUkladReplacer, ukladReplacer, ukladReviver } from '../serialization.js';
import { createKeyRedactor, redactDevtoolsEvent, type DevtoolsRedaction } from '../redaction.js';
import {
  UKLAD_DEVTOOLS_CLIENT_HEADER,
  UKLAD_DEVTOOLS_DEFAULT_RUNTIME_PAYLOAD_BYTES,
  UKLAD_DEVTOOLS_MAX_RUNTIME_PAYLOAD_BYTES,
  UKLAD_DEVTOOLS_PROTOCOL_HEADER,
  UKLAD_DEVTOOLS_PROTOCOL_VERSION,
  UKLAD_DEVTOOLS_RUNTIME_ERROR_TYPE,
  UKLAD_DEVTOOLS_RUNTIME_ID_HEADER,
  UKLAD_DEVTOOLS_RUNTIME_SESSION_HEADER,
  UKLAD_DEVTOOLS_TELEMETRY_DROPPED_CODE,
  UKLAD_DEVTOOLS_WS_PROTOCOL,
  type DevtoolsCapability,
  type DevtoolsClientRole,
  type DevtoolsRuntimeSummary,
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

export { createKeyRedactor, DEFAULT_SENSITIVE_KEYS } from '../redaction.js';
export type {
  DevtoolsRedaction,
  KeyRedactorOptions,
  RedactionContext,
  StateRedactor,
  TraceRedactor,
} from '../redaction.js';
export {
  UKLAD_DEVTOOLS_PROTOCOL_VERSION,
  UKLAD_DEVTOOLS_RUNTIME_ID_HEADER,
} from '../protocol.js';
export type {
  DevtoolsCapability,
  DevtoolsClientRole,
  DevtoolsProtocolInfo,
  DevtoolsRuntimeIdentity,
  DevtoolsRuntimeKind,
  DevtoolsRuntimeSummary,
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
  readonly status: 'accepted' | 'denied' | 'succeeded' | 'failed' | 'effects-failed' | 'unknown';
  readonly reason?: string;
  readonly traceId?: number;
  readonly durationMs?: number;
  readonly runtimeId?: string;
  readonly runtimeName?: string;
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
  /** Maximum number of connected or retained runtime identities. */
  maxRuntimes?: number;
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
  readonly runtimeId: string;
  readonly requestId: string;
  readonly startedAt: number;
  readonly target: string;
  readonly client: string;
  readonly expectsOperationSnapshot: boolean;
}

interface PendingSubEval {
  readonly res: Response;
  readonly timeout: NodeJS.Timeout;
  readonly runtimeSessionId: string;
  readonly runtimeId: string;
}

interface RuntimeSocketMetadata {
  readonly sessionId: string;
  readonly runtimeId: string;
  readonly runtimeName: string;
  readonly sessionEpoch: number;
  readonly protocolVersion: number;
  readonly inspectorApiVersion: number;
  readonly operationApiVersion?: 1;
  /** Exact in-memory runtime lifetime, independent of operations support. */
  readonly runtimeInstanceId?: string;
  /** Optional DevTools evidence mode; absent means the conservative default. */
  readonly operationStateChanges?: 'patches';
}

interface RuntimeEntry {
  readonly runtimeId: string;
  runtimeName: string;
  socket: WebSocket | null;
  metadata: RuntimeSocketMetadata | null;
  /**
   * Bounded dashboard mirror. Without MCP it keeps no trace history, but still
   * follows trace patches so selecting another runtime can replay current
   * state, subscriptions, handlers, and runtime information.
   */
  readonly snapshot: TraceStorage;
  readonly storage: TraceStorage | null;
  sessionEpoch: number;
  lastConnectedAt: number;
}

interface UiSocketMetadata {
  readonly auth: AuthContext;
  readonly origin?: string;
  selectedRuntimeId: string | null;
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

type RuntimeSelectionResult =
  | { readonly ok: true; readonly runtime: RuntimeEntry }
  | {
      readonly ok: false;
      readonly status: 400 | 404 | 409;
      readonly code: 'INVALID_RUNTIME_ID' | 'RUNTIME_NOT_FOUND' | 'RUNTIME_SELECTION_REQUIRED';
      readonly error: string;
    };

const DISPATCH_OUTCOME_TIMEOUT_MS = 5000;
const SUB_EVAL_TIMEOUT_MS = 5000;
const WEBSOCKET_AUTH_TIMEOUT_MS = 3000;
const DEFAULT_CONTROL_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_MAX_PENDING_ACTIONS = 32;
const DEFAULT_MAX_AUDIT_RECORDS = 500;
const DEFAULT_MAX_PENDING_WEBSOCKETS = 16;
const DEFAULT_MAX_RUNTIMES = 16;
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
const MAX_RUNTIME_NAME_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  );
}

function boundedInteger(
  name: string,
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`[Uklad Devtools] ${name} must be an integer from 1 to ${maximum}.`);
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
      throw new Error(`[Uklad Devtools] Unknown capability: ${capability}`);
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
    reviver: ukladReviver,
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
    maxRuntimes: number;
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
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly pendingDispatches = new Map<string, PendingDispatch>();
  private readonly pendingSubEvals = new Map<string, PendingSubEval>();
  private readonly socketLiveness = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config: ServerConfig) {
    const host = config.host ?? '127.0.0.1';
    const loopbackOnly = isLoopbackHost(host);

    if (!loopbackOnly) {
      if (!config.allowRemote) {
        throw new Error(
          `[Uklad Devtools] Refusing non-loopback host "${host}". ` +
            'Use allowRemote only with explicit credentials, Host/Origin allowlists, and a trusted TLS boundary.',
        );
      }
      if (!config.allowedHosts?.length) {
        throw new Error(
          '[Uklad Devtools] Non-loopback binding requires at least one exact allowedHosts entry.',
        );
      }
      if (!config.allowedOrigins?.length) {
        throw new Error(
          '[Uklad Devtools] Non-loopback binding requires at least one exact allowedOrigins entry.',
        );
      }
      for (const role of ['runtime', 'ui', 'mcp'] as const) {
        if (!config.tokens?.[role]) {
          throw new Error(
            `[Uklad Devtools] Non-loopback binding requires an explicit ${role} token.`,
          );
        }
      }
    }

    this.config = {
      ...config,
      host,
      maxTraces: boundedInteger('maxTraces', config.maxTraces, 1000, 100_000),
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
        UKLAD_DEVTOOLS_DEFAULT_RUNTIME_PAYLOAD_BYTES,
        UKLAD_DEVTOOLS_MAX_RUNTIME_PAYLOAD_BYTES,
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
      maxUiClients: boundedInteger('maxUiClients', config.maxUiClients, 8, 64),
      maxRuntimes: boundedInteger('maxRuntimes', config.maxRuntimes, DEFAULT_MAX_RUNTIMES, 256),
    };
    this.capabilities = uniqueCapabilities(config.capabilities);
    this.tokens = createSessionTokens(config.tokens);
    this.allowedOrigins = normalizeAllowedOrigins(config.allowedOrigins);

    const allowedHosts = new Set<string>();
    for (const configuredHost of config.allowedHosts ?? []) {
      const parsed = parseHostHeader(configuredHost);
      if (!parsed || parsed !== normalizeHost(configuredHost)) {
        throw new Error(
          '[Uklad Devtools] allowedHosts entries must be exact host names without ports, credentials, or paths.',
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

    if (this.config.enableMCP) {
      console.log('[Uklad Devtools] MCP inspection enabled - trace storage active');
    }

    const filename = fileURLToPath(import.meta.url);
    this.uiPath = path.join(path.dirname(filename), '../ui');

    this.app = express();
    this.app.disable('x-powered-by');
    this.server = createServer({ maxHeaderSize: 16 * 1024 }, this.app);
    this.server.requestTimeout = 15_000;
    this.server.headersTimeout = 10_000;
    this.server.keepAliveTimeout = 5_000;
    this.server.maxHeadersCount = 100;

    this.sdkWss = new WebSocketServer({
      noServer: true,
      maxPayload: this.config.maxRuntimePayloadBytes,
      perMessageDeflate: false,
      handleProtocols: (protocols) =>
        protocols.has(UKLAD_DEVTOOLS_WS_PROTOCOL) ? UKLAD_DEVTOOLS_WS_PROTOCOL : false,
    });
    this.uiWss = new WebSocketServer({
      noServer: true,
      maxPayload: this.config.maxControlPayloadBytes,
      perMessageDeflate: false,
      handleProtocols: (protocols) =>
        protocols.has(UKLAD_DEVTOOLS_WS_PROTOCOL) ? UKLAD_DEVTOOLS_WS_PROTOCOL : false,
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSockets();
  }

  private setupMiddleware(): void {
    this.app.use((req, res, next) => {
      res.setHeader('Uklad-DevTools-Protocol-Version', String(UKLAD_DEVTOOLS_PROTOCOL_VERSION));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
      if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path === '/event') {
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
      if (
        !isAllowedOrigin(
          origin,
          this.allowedOrigins,
          isLoopbackHost(this.config.host) ? req.headers.host : undefined,
        )
      ) {
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
        res.setHeader('Access-Control-Expose-Headers', 'Uklad-DevTools-Protocol-Version');
        res.setHeader(
          'Access-Control-Allow-Headers',
          [
            'Authorization',
            'Content-Type',
            'Uklad-DevTools-Protocol-Version',
            'X-Uklad-Client',
            'X-Uklad-Runtime-Id',
            'X-Uklad-Runtime-Session',
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
        protocolVersion: UKLAD_DEVTOOLS_PROTOCOL_VERSION,
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
        if (!isLoopbackHost(this.config.host) || !isLoopbackAddress(req.socket.remoteAddress)) {
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
          const sameOrigin = new URL(origin).host.toLowerCase() === req.headers.host?.toLowerCase();
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
          capabilities: role === 'runtime' ? [] : [...this.capabilities],
          protocolVersion: UKLAD_DEVTOOLS_PROTOCOL_VERSION,
        });
      },
    );

    this.app.get('/api/status', this.authenticateHttp('mcp'), (req: Request, res: Response) => {
      const runtime = this.selectRuntimeForHttp(req, res, 'query');
      if (!runtime) return;
      const connected = this.isRuntimeConnected(runtime);
      const runtimeInfo = runtime.storage?.getRuntimeInfo() ?? null;
      const handlerKeys = runtime.storage?.getHandlerKeys() ?? null;
      const auth = res.locals.auth as AuthContext;

      res.json({
        success: true,
        mcpEnabled: this.config.enableMCP,
        appConnected: connected,
        connectedApps: this.connectedRuntimes().length,
        connectedUIs: this.uiClients.size,
        runtimeId: runtime.runtimeId,
        runtimeName: runtime.runtimeName,
        selectedRuntimeId: runtime.runtimeId,
        runtimes: this.runtimeSummaries(),
        sessionEpoch: runtime.sessionEpoch,
        runtimeInstanceId: runtime.metadata?.runtimeInstanceId ?? null,
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
        stateAvailable: runtime.storage ? runtime.storage.getState() !== null : false,
        traceCount: runtime.storage?.getStats().totalTraces ?? 0,
        capabilities: [...auth.capabilities],
        readOnly: !auth.capabilities.has('dispatch') && !auth.capabilities.has('restore'),
        protocol: {
          version: UKLAD_DEVTOOLS_PROTOCOL_VERSION,
          runtimeVersion: runtime.metadata?.protocolVersion ?? null,
          inspectorApiVersion: runtime.metadata?.inspectorApiVersion ?? null,
          operationApiVersion: runtime.metadata?.operationApiVersion ?? null,
        },
        operations:
          runtime.metadata?.operationApiVersion === 1
            ? {
                available: true,
                runtimeInstanceId: runtime.metadata.runtimeInstanceId,
                evidence: {
                  stateChanges: runtime.metadata.operationStateChanges ?? 'none',
                },
              }
            : { available: false },
        security: {
          authenticated: true,
          loopbackOnly: isLoopbackHost(this.config.host),
          browserOrigins: 'same-origin-or-explicit',
          redactionEnabled: this.redaction !== undefined,
          auditEnabled: true,
        },
      });
    });

    this.app.get('/api/traces', this.authenticateHttp('mcp', 'inspect'), (req, res) => {
      const runtime = this.selectRuntimeForHttp(req, res, 'query');
      if (!runtime || !this.requireStorage(runtime, res)) return;
      try {
        const rawLimit = req.query.limit;
        const limit =
          rawLimit === undefined
            ? 50
            : /^\d+$/.test(String(rawLimit))
              ? Number(rawLimit)
              : Number.NaN;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRACE_QUERY_LIMIT) {
          res.status(400).json({
            success: false,
            error: `limit must be an integer from 1 to ${MAX_TRACE_QUERY_LIMIT}`,
          });
          return;
        }
        const minDuration =
          req.query.minDuration === undefined ? undefined : Number(req.query.minDuration);
        if (minDuration !== undefined && (!Number.isFinite(minDuration) || minDuration < 0)) {
          res.status(400).json({
            success: false,
            error: 'minDuration must be a non-negative number',
          });
          return;
        }
        const eventInstanceId =
          typeof req.query.eventInstanceId === 'string'
            ? req.query.eventInstanceId
            : undefined;
        if (
          eventInstanceId !== undefined
          && !this.validRuntimeIdentityText(eventInstanceId, MAX_EVENT_ID_LENGTH)
        ) {
          res.status(400).json({
            success: false,
            error: `eventInstanceId must be a non-empty string up to ${MAX_EVENT_ID_LENGTH} characters`,
          });
          return;
        }

        const traces = runtime
          .storage!.getTraces({
            limit,
            eventFilter:
              typeof req.query.eventFilter === 'string'
                ? req.query.eventFilter.slice(0, MAX_EVENT_ID_LENGTH)
                : undefined,
            eventInstanceId,
            minDuration,
            opType:
              typeof req.query.opType === 'string' ? req.query.opType.slice(0, 64) : undefined,
          })
          .map((trace) => ({
            id: trace.id,
            start: trace.start,
            duration: trace.duration,
            operation: trace.operation,
            opType: trace.opType,
            childOf: trace.childOf,
            ...(trace.runtimeInstanceId === undefined
              ? {}
              : { runtimeInstanceId: trace.runtimeInstanceId }),
            ...(trace.eventInstanceId === undefined
              ? {}
              : { eventInstanceId: trace.eventInstanceId }),
            ...(trace.parentEventInstanceId === undefined
              ? {}
              : { parentEventInstanceId: trace.parentEventInstanceId }),
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
        this.sendSerialized(res, {
          success: true,
          ...this.runtimeResponseIdentity(runtime),
          stats: runtime.storage!.getStats(),
          traces,
        });
      } catch (error) {
        this.sendInternalError(res, error);
      }
    });

    this.app.get('/api/traces/:id', this.authenticateHttp('mcp', 'inspect'), (req, res) => {
      const runtime = this.selectRuntimeForHttp(req, res, 'query');
      if (!runtime || !this.requireStorage(runtime, res)) return;
      const rawSessionEpoch = req.query.sessionEpoch;
      const expectedSessionEpoch =
        rawSessionEpoch === undefined
          ? undefined
          : typeof rawSessionEpoch === 'string' && /^\d+$/.test(rawSessionEpoch)
            ? Number(rawSessionEpoch)
            : Number.NaN;
      if (
        expectedSessionEpoch !== undefined &&
        (!Number.isSafeInteger(expectedSessionEpoch) || expectedSessionEpoch < 1)
      ) {
        res.status(400).json({
          success: false,
          code: 'INVALID_SESSION_EPOCH',
          error: 'sessionEpoch must be a positive safe integer.',
        });
        return;
      }
      if (expectedSessionEpoch !== undefined && expectedSessionEpoch !== runtime.sessionEpoch) {
        res.status(409).json({
          success: false,
          code: 'SESSION_EPOCH_MISMATCH',
          error:
            `Runtime "${runtime.runtimeId}" is now in session epoch ` +
            `${runtime.sessionEpoch}; trace ${req.params.id} belonged to ` +
            `epoch ${expectedSessionEpoch}.`,
          expectedSessionEpoch,
          ...this.runtimeResponseIdentity(runtime),
        });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({
          success: false,
          error: 'Trace id must be a number',
        });
        return;
      }
      const trace = runtime.storage!.getTrace(id);
      if (!trace) {
        res.status(404).json({
          success: false,
          error: `No trace with id ${id}`,
        });
        return;
      }
      const tags = trace.tags ? { ...trace.tags } : undefined;
      if (tags) delete tags.reversePatches;
      this.sendSerialized(res, {
        success: true,
        ...this.runtimeResponseIdentity(runtime),
        trace: { ...trace, tags },
      });
    });

    this.app.get('/api/state', this.authenticateHttp('mcp', 'inspect'), (req, res) => {
      const runtime = this.selectRuntimeForHttp(req, res, 'query');
      if (!runtime || !this.requireStorage(runtime, res)) return;
      const pathValue = typeof req.query.path === 'string' ? req.query.path : undefined;
      let state = runtime.storage!.getState();
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
        ...this.runtimeResponseIdentity(runtime),
        path: pathValue ?? null,
        state,
      });
    });

    this.app.get('/api/subscriptions', this.authenticateHttp('mcp', 'inspect'), (req, res) => {
      const runtime = this.selectRuntimeForHttp(req, res, 'query');
      if (!runtime || !this.requireStorage(runtime, res)) return;
      const filter =
        typeof req.query.filter === 'string'
          ? req.query.filter.slice(0, MAX_EVENT_ID_LENGTH).toLowerCase()
          : null;
      const subscriptions = filter
        ? Object.fromEntries(
            Object.entries(runtime.storage!.getActiveSubs()).filter(([key]) =>
              key.toLowerCase().includes(filter),
            ),
          )
        : runtime.storage!.getActiveSubs();
      this.sendSerialized(res, {
        success: true,
        ...this.runtimeResponseIdentity(runtime),
        subscriptions,
        total: Object.keys(runtime.storage!.getActiveSubs()).length,
      });
    });

    this.app.get('/api/handlers', this.authenticateHttp('mcp', 'inspect'), (req, res) => {
      const runtime = this.selectRuntimeForHttp(req, res, 'query');
      if (!runtime || !this.requireStorage(runtime, res)) return;
      const type = req.query.type;
      if (
        type !== undefined &&
        type !== 'event' &&
        type !== 'fx' &&
        type !== 'cofx' &&
        type !== 'sub'
      ) {
        res.status(400).json({
          success: false,
          error: 'type must be event, fx, cofx, or sub',
        });
        return;
      }
      const handlerKeys = runtime.storage!.getHandlerKeys();
      res.json({
        success: true,
        ...this.runtimeResponseIdentity(runtime),
        handlerKeys: type && handlerKeys ? { [type]: handlerKeys[type] } : handlerKeys,
      });
    });

    this.app.get('/api/stats', this.authenticateHttp('mcp', 'inspect'), (req, res) => {
      const runtime = this.selectRuntimeForHttp(req, res, 'query');
      if (!runtime || !this.requireStorage(runtime, res)) return;
      res.json({
        success: true,
        ...this.runtimeResponseIdentity(runtime),
        stats: runtime.storage!.getStats(),
      });
    });

    this.app.get('/api/audit', this.authenticateHttp('mcp', 'inspect'), (req, res) => {
      const rawLimit = req.query.limit;
      const requested =
        rawLimit === undefined
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
    });

    this.app.post(
      '/api/dispatch',
      this.authenticateHttp('mcp', 'dispatch', 'dispatch'),
      this.requireJsonContentType,
      jsonBodyParser(this.config.maxControlPayloadBytes),
      (req, res) => this.handleHttpDispatch(req, res),
    );

    this.app.post(
      '/api/dispatch-and-wait',
      this.authenticateHttp('mcp', 'dispatch', 'dispatch'),
      this.requireJsonContentType,
      jsonBodyParser(this.config.maxControlPayloadBytes),
      (req, res) => this.handleHttpDispatch(req, res, true),
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
        const runtime = res.locals.runtime as RuntimeEntry;
        const result = this.processInboundRuntimeEvent(
          req.body,
          runtime.runtimeId,
          String(req.headers[UKLAD_DEVTOOLS_RUNTIME_SESSION_HEADER]),
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
          this.sendInternalError(res, new Error('Runtime telemetry processing failed.'));
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

    this.app.use(
      express.static(this.uiPath, {
        etag: true,
        fallthrough: true,
        index: false,
        maxAge: 0,
      }),
    );
    this.app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(this.uiPath, 'index.html'));
    });

    this.app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
      if (error?.type === 'entity.too.large') {
        res.status(413).json({
          success: false,
          code: 'PAYLOAD_TOO_LARGE',
          error: 'Request payload exceeds the configured limit.',
        });
        return;
      }
      if (error instanceof SyntaxError || error?.type === 'entity.parse.failed') {
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
    const supplied = req.headers[UKLAD_DEVTOOLS_PROTOCOL_HEADER];
    if (
      this.headerCount(req.rawHeaders, UKLAD_DEVTOOLS_PROTOCOL_HEADER) !== 1 ||
      supplied !== String(UKLAD_DEVTOOLS_PROTOCOL_VERSION)
    ) {
      res.status(426).json({
        success: false,
        code: 'PROTOCOL_MISMATCH',
        error: 'Unsupported Uklad DevTools protocol version.',
        supportedVersions: [UKLAD_DEVTOOLS_PROTOCOL_VERSION],
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
    return (req: Request, res: Response, next: NextFunction): void => {
      const suppliedVersion = req.headers[UKLAD_DEVTOOLS_PROTOCOL_HEADER];
      if (
        this.headerCount(req.rawHeaders, UKLAD_DEVTOOLS_PROTOCOL_HEADER) !== 1 ||
        suppliedVersion !== String(UKLAD_DEVTOOLS_PROTOCOL_VERSION)
      ) {
        res.status(426).json({
          success: false,
          code: 'PROTOCOL_MISMATCH',
          error: 'Unsupported Uklad DevTools protocol version.',
          supportedVersions: [UKLAD_DEVTOOLS_PROTOCOL_VERSION],
        });
        return;
      }

      const token = readBearerToken(req);
      if (
        this.headerCount(req.rawHeaders, 'authorization') !== 1 ||
        !token ||
        !tokensEqual(token, this.tokens[role])
      ) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="uklad-devtools"');
        res.status(401).json({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'A valid session token is required.',
        });
        return;
      }

      const auth: AuthContext = {
        role,
        capabilities: role === 'runtime' ? new Set() : this.capabilities,
        client: this.sanitizeClientHeader(req.headers[UKLAD_DEVTOOLS_CLIENT_HEADER], role),
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
    const runtimeId = req.headers[UKLAD_DEVTOOLS_RUNTIME_ID_HEADER];
    const sessionId = req.headers[UKLAD_DEVTOOLS_RUNTIME_SESSION_HEADER];
    const runtime = typeof runtimeId === 'string' ? this.runtimes.get(runtimeId) : undefined;
    if (
      this.headerCount(req.rawHeaders, UKLAD_DEVTOOLS_RUNTIME_ID_HEADER) !== 1 ||
      this.headerCount(req.rawHeaders, UKLAD_DEVTOOLS_RUNTIME_SESSION_HEADER) !== 1 ||
      typeof runtimeId !== 'string' ||
      typeof sessionId !== 'string' ||
      !runtime ||
      !this.isRuntimeConnected(runtime) ||
      sessionId !== runtime.metadata?.sessionId
    ) {
      res.status(409).json({
        success: false,
        code: 'STALE_RUNTIME_SESSION',
        error: 'The runtime session is missing or no longer active.',
      });
      return;
    }
    res.locals.runtime = runtime;
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
        this.headerCount(req.rawHeaders, 'host') !== 1 ||
        this.headerCount(req.rawHeaders, 'origin') > 1
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
      if (
        !isAllowedOrigin(
          req.headers.origin,
          this.allowedOrigins,
          isLoopbackHost(this.config.host) ? req.headers.host : undefined,
        )
      ) {
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

      const url = new URL(req.url ?? '/', 'http://uklad.invalid');
      const target =
        url.pathname === '/sdk' ? this.sdkWss : url.pathname === '/ui' ? this.uiWss : null;
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
        if (inspectorApiVersion !== 2) {
          ws.close(1002, 'Unsupported inspector API version');
          return;
        }
        const runtimeId = authMessage.payload?.runtimeId;
        const runtimeName = authMessage.payload?.runtimeName;
        const operationApiVersion = authMessage.payload?.operationApiVersion;
        const runtimeInstanceId = authMessage.payload?.runtimeInstanceId;
        const operationStateChanges = authMessage.payload?.operationStateChanges;
        if (
          !this.validRuntimeId(runtimeId) ||
          !this.validRuntimeIdentityText(runtimeName, MAX_RUNTIME_NAME_LENGTH) ||
          (operationApiVersion !== undefined && operationApiVersion !== 1) ||
          (runtimeInstanceId !== undefined
            && !this.validRuntimeIdentityText(runtimeInstanceId, 256)) ||
          (operationApiVersion === 1 && runtimeInstanceId === undefined) ||
          (operationStateChanges !== undefined && operationStateChanges !== 'patches') ||
          (operationApiVersion !== 1 && operationStateChanges !== undefined)
        ) {
          ws.close(1008, 'Invalid runtime identity');
          return;
        }
        this.activateRuntimeSocket(ws, {
          sessionId: randomUUID(),
          runtimeId,
          runtimeName,
          protocolVersion: UKLAD_DEVTOOLS_PROTOCOL_VERSION,
          inspectorApiVersion,
          ...(runtimeInstanceId === undefined ? {} : { runtimeInstanceId }),
          ...(operationApiVersion === 1
            ? {
                operationApiVersion,
                ...(operationStateChanges === 'patches' ? { operationStateChanges } : {}),
              }
            : {}),
        });
      });
    });

    this.uiWss.on('connection', (ws, req) => {
      this.authenticateWebSocket(ws, req, 'ui', () => {
        const auth: AuthContext = {
          role: 'ui',
          capabilities: this.capabilities,
          client: 'uklad-devtools-ui',
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
        message?.type === 'uklad-auth' &&
        message.payload?.role === role &&
        message.payload?.protocolVersion === UKLAD_DEVTOOLS_PROTOCOL_VERSION &&
        typeof message.payload?.token === 'string' &&
        tokensEqual(message.payload.token, this.tokens[role]);
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
    candidateMetadata: Omit<RuntimeSocketMetadata, 'sessionEpoch'>,
  ): void {
    let runtime = this.runtimes.get(candidateMetadata.runtimeId);
    if (!runtime) {
      this.evictRetainedRuntimeIfNeeded();
      if (this.runtimes.size >= this.config.maxRuntimes) {
        ws.close(1013, 'Too many runtime connections');
        return;
      }
      runtime = {
        runtimeId: candidateMetadata.runtimeId,
        runtimeName: candidateMetadata.runtimeName,
        socket: null,
        metadata: null,
        ...this.createRuntimeStorage(),
        sessionEpoch: 0,
        lastConnectedAt: 0,
      };
      this.runtimes.set(runtime.runtimeId, runtime);
    }

    const stale = runtime.socket;
    runtime.sessionEpoch += 1;
    runtime.runtimeName = candidateMetadata.runtimeName;
    runtime.lastConnectedAt = Date.now();
    const metadata: RuntimeSocketMetadata = {
      ...candidateMetadata,
      sessionEpoch: runtime.sessionEpoch,
    };
    runtime.socket = ws;
    runtime.metadata = metadata;
    runtime.snapshot.clear();
    this.failPendingDispatches(
      'DevTools runtime session changed before the dispatch outcome was observed',
      runtime.runtimeId,
    );
    this.failPendingSubEvals(
      'DevTools runtime session changed before the subscription evaluation completed',
      runtime.runtimeId,
    );

    if (stale && stale !== ws) {
      stale.close(1000, 'Superseded by a newer authenticated runtime');
    }

    this.sendToSocket(ws, {
      type: 'devtools-server-hello',
      payload: {
        protocolVersion: UKLAD_DEVTOOLS_PROTOCOL_VERSION,
        runtimeSessionId: metadata.sessionId,
        runtimeId: runtime.runtimeId,
        runtimeName: runtime.runtimeName,
        sessionEpoch: runtime.sessionEpoch,
        capabilities: [...this.capabilities],
        limits: {
          runtimePayloadBytes: this.config.maxRuntimePayloadBytes,
          controlPayloadBytes: this.config.maxControlPayloadBytes,
        },
      },
      timestamp: Date.now(),
    });
    this.sendTracingDemand(ws);
    this.notifyUiRuntimeStatus();
    this.refreshUiSelectionsAfterRuntimeConnect(runtime);

    const withinRateLimit = this.createMessageRateLimiter(MAX_RUNTIME_MESSAGES_PER_MINUTE);
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
        event = JSON.parse(this.rawDataToString(data), ukladReviver);
      } catch {
        ws.close(1007, 'Invalid JSON');
        return;
      }
      const result = this.processInboundRuntimeEvent(event, runtime.runtimeId, metadata.sessionId);
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
      if (runtime.socket !== ws) return;
      runtime.socket = null;
      this.failPendingDispatches(
        'App disconnected before reporting the dispatch outcome',
        runtime.runtimeId,
      );
      this.failPendingSubEvals(
        'App disconnected before reporting the subscription value',
        runtime.runtimeId,
      );
      this.notifyUiRuntimeStatus();
    };
    ws.on('close', remove);
    ws.on('error', remove);
  }

  private activateUiSocket(ws: WebSocket, req: IncomingMessage, auth: AuthContext): void {
    if (this.uiClients.size >= this.config.maxUiClients) {
      ws.close(1013, 'Too many dashboard connections');
      return;
    }
    const metadata: UiSocketMetadata = {
      auth,
      origin: req.headers.origin,
      selectedRuntimeId:
        this.connectedRuntimes().length === 1 ? this.connectedRuntimes()[0]!.runtimeId : null,
    };
    this.uiClients.set(ws, metadata);
    this.notifySDKClientsUIStatus();

    this.sendToSocket(ws, {
      type: 'devtools-connected',
      payload: {
        message: 'Connected to Uklad Devtools',
        protocolVersion: UKLAD_DEVTOOLS_PROTOCOL_VERSION,
        runtimes: this.runtimeSummaries(),
        selectedRuntimeId: metadata.selectedRuntimeId,
        capabilities: [...auth.capabilities],
        readOnly: !auth.capabilities.has('dispatch') && !auth.capabilities.has('restore'),
      },
      timestamp: Date.now(),
    });
    this.sendRuntimeStatusToUi(ws);
    if (metadata.selectedRuntimeId) {
      const selected = this.runtimes.get(metadata.selectedRuntimeId);
      if (selected) this.sendSelectedRuntimeSnapshot(ws, selected);
    }

    const withinRateLimit = this.createMessageRateLimiter(MAX_UI_MESSAGES_PER_MINUTE);
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

      if (message?.type === 'select-runtime') {
        const selection = this.resolveRuntimeSelection(message.payload?.runtimeId);
        if (!selection.ok) {
          this.sendToSocket(ws, {
            type: 'devtools-error',
            payload: {
              code: selection.code,
              message: selection.error,
              selectedRuntimeId: metadata.selectedRuntimeId,
              runtimes: this.runtimeSummaries(),
            },
          });
          return;
        }
        if (metadata.selectedRuntimeId === selection.runtime.runtimeId) {
          this.sendRuntimeStatusToUi(ws);
          this.sendRuntimeSelectionAcknowledgement(ws, selection.runtime);
          return;
        }
        metadata.selectedRuntimeId = selection.runtime.runtimeId;
        this.sendRuntimeStatusToUi(ws);
        this.sendSelectedRuntimeSnapshot(ws, selection.runtime);
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
      if (
        metadata.selectedRuntimeId === null ||
        message.payload.runtimeId !== metadata.selectedRuntimeId
      ) {
        this.appendAudit({
          requestId,
          principal: 'ui',
          client: auth.client,
          transport: 'websocket',
          action: 'dispatch',
          capability: 'dispatch',
          target: message.payload.eventName,
          runtimeId: this.validRuntimeId(message.payload.runtimeId)
            ? message.payload.runtimeId
            : undefined,
          status: 'denied',
          reason: 'stale-runtime-selection',
        });
        this.sendToSocket(ws, {
          type: 'devtools-error',
          payload: {
            requestId,
            code: 'STALE_RUNTIME_SELECTION',
            message:
              'The dispatch runtime does not match the dashboard selection. ' +
              'Wait for runtime selection to be acknowledged and retry.',
            requestedRuntimeId:
              typeof message.payload.runtimeId === 'string' ? message.payload.runtimeId : null,
            selectedRuntimeId: metadata.selectedRuntimeId,
            runtimes: this.runtimeSummaries(),
          },
        });
        return;
      }
      const selection = this.resolveRuntimeSelection(metadata.selectedRuntimeId);
      if (!selection.ok) {
        this.appendAudit({
          requestId,
          principal: 'ui',
          client: auth.client,
          transport: 'websocket',
          action: 'dispatch',
          capability: 'dispatch',
          target: message.payload.eventName,
          status: 'denied',
          reason: selection.code.toLowerCase().replaceAll('_', '-'),
        });
        this.sendToSocket(ws, {
          type: 'devtools-error',
          payload: {
            requestId,
            code: selection.code,
            message: selection.error,
            runtimes: this.runtimeSummaries(),
          },
        });
        return;
      }
      const runtime = selection.runtime;
      const sent = this.sendToRuntime(runtime, {
        type: 'dispatch-to-client',
        runtimeId: runtime.runtimeId,
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
        runtimeId: runtime.runtimeId,
        status: sent > 0 ? 'accepted' : 'unknown',
        reason: sent > 0 ? undefined : 'runtime-disconnected',
      });
      if (sent === 0) {
        this.sendToSocket(ws, {
          type: 'devtools-error',
          payload: {
            requestId,
            code: 'RUNTIME_NOT_CONNECTED',
            message: `Runtime "${runtime.runtimeId}" is not connected.`,
            runtimeId: runtime.runtimeId,
          },
        });
      }
    });

    const remove = (): void => {
      if (!this.uiClients.delete(ws)) return;
      this.notifySDKClientsUIStatus();
    };
    ws.on('close', remove);
    ws.on('error', remove);
  }

  private handleHttpDispatch(req: Request, res: Response, expectsOperationSnapshot = false): void {
    const auth = res.locals.auth as AuthContext;
    const requestId = randomUUID();
    const target = this.validEventId(req.body?.eventName) ? req.body.eventName : undefined;
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
      const error = !this.validEventId(req.body?.eventName)
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
    const selection = this.resolveRuntimeSelection(req.body?.runtimeId);
    if (!selection.ok) {
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        status: 'denied',
        reason: selection.code.toLowerCase().replaceAll('_', '-'),
      });
      this.sendRuntimeSelectionError(res, selection, requestId);
      return;
    }
    const runtime = selection.runtime;
    if (this.pendingDispatches.size + this.pendingSubEvals.size >= this.config.maxPendingActions) {
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        runtimeId: runtime.runtimeId,
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
    if (!this.isRuntimeConnected(runtime) || !runtime.metadata) {
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        runtimeId: runtime.runtimeId,
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
    if (expectsOperationSnapshot && runtime.metadata.operationApiVersion !== 1) {
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target,
        runtimeId: runtime.runtimeId,
        status: 'denied',
        reason: 'operation-capability-unavailable',
      });
      res.status(409).json({
        success: false,
        requestId,
        code: 'OPERATION_CAPABILITY_UNAVAILABLE',
        error:
          'This runtime does not expose the operation snapshot capability. ' +
          'Enable DevTools with enableDevtools(createUkladInspector(runtime), { operations: true }).',
        ...this.runtimeResponseIdentity(runtime),
      });
      return;
    }

    const dispatchId = randomUUID();
    const runtimeSessionId = runtime.metadata.sessionId;
    const startedAt = Date.now();
    const sent = this.sendToRuntime(runtime, {
      type: 'dispatch-to-client',
      runtimeId: runtime.runtimeId,
      payload: {
        dispatchId,
        eventName: req.body.eventName,
        params: req.body.params ?? [],
        ...(expectsOperationSnapshot ? { operation: true } : {}),
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
        runtimeId: runtime.runtimeId,
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
      runtimeId: runtime.runtimeId,
      status: 'accepted',
    });

    const timeout = setTimeout(() => {
      this.pendingDispatches.delete(dispatchId);
      const message = expectsOperationSnapshot
        ? `Event dispatched, but the app did not return an operation snapshot within ${DISPATCH_OUTCOME_TIMEOUT_MS}ms`
        : `Event dispatched, but the app reported no trace for it within ${DISPATCH_OUTCOME_TIMEOUT_MS}ms`;
      this.appendAudit({
        requestId,
        principal: 'mcp',
        client: auth.client,
        transport: 'http',
        action: 'dispatch',
        capability: 'dispatch',
        target: req.body.eventName,
        runtimeId: runtime.runtimeId,
        status: 'unknown',
        reason: 'outcome-timeout',
        durationMs: Date.now() - startedAt,
      });
      res.json({
        success: true,
        outcome: 'unknown',
        requestId,
        ...this.runtimeResponseIdentity(runtime),
        message,
      });
    }, DISPATCH_OUTCOME_TIMEOUT_MS);

    this.pendingDispatches.set(dispatchId, {
      res,
      timeout,
      runtimeSessionId,
      runtimeId: runtime.runtimeId,
      requestId,
      startedAt,
      target: req.body.eventName,
      client: auth.client,
      expectsOperationSnapshot,
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
    const runtime = this.selectRuntimeForHttp(req, res, 'body');
    if (!runtime) return;
    if (this.pendingDispatches.size + this.pendingSubEvals.size >= this.config.maxPendingActions) {
      res.status(429).json({
        success: false,
        code: 'TOO_MANY_PENDING_ACTIONS',
        error: 'Too many DevTools actions are already pending.',
      });
      return;
    }
    if (!this.isRuntimeConnected(runtime) || !runtime.metadata) {
      res.status(503).json({
        success: false,
        error: 'No app connected to the devtools server; the subscription was not evaluated',
      });
      return;
    }

    const evalId = randomUUID();
    const runtimeSessionId = runtime.metadata.sessionId;
    const sent = this.sendToRuntime(runtime, {
      type: 'eval-sub-to-client',
      runtimeId: runtime.runtimeId,
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
        ...this.runtimeResponseIdentity(runtime),
        error: `Subscription evaluation timed out after ${SUB_EVAL_TIMEOUT_MS}ms`,
      });
    }, SUB_EVAL_TIMEOUT_MS);
    this.pendingSubEvals.set(evalId, {
      res,
      timeout,
      runtimeSessionId,
      runtimeId: runtime.runtimeId,
    });
  }

  private processInboundRuntimeEvent(
    candidate: any,
    runtimeId: string,
    runtimeSessionId: string,
  ): RuntimeEventProcessingResult {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.type !== 'string' ||
      candidate.type.length === 0 ||
      candidate.type.length > 128 ||
      /[\u0000-\u001F\u007F]/.test(candidate.type)
    ) {
      return { status: 'invalid' };
    }
    const runtime = this.runtimes.get(runtimeId);
    if (
      !runtime ||
      runtime.metadata?.sessionId !== runtimeSessionId ||
      !this.isRuntimeConnected(runtime)
    ) {
      return { status: 'invalid' };
    }
    if (!this.validRuntimeEvent(candidate)) return { status: 'invalid' };

    let event: any;
    try {
      event = redactDevtoolsEvent(candidate, this.redaction, 'server');
    } catch {
      console.error(
        `[Uklad Devtools] Redaction failed for event type ${candidate.type}; payload dropped.`,
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
      if (event.type === 'uklad-dispatch-result') {
        this.resolveDispatch(event.payload, runtimeId, runtimeSessionId);
        return { status: 'accepted' };
      }
      if (event.type === 'uklad-operation-result') {
        this.resolveOperation(event.payload, runtimeId, runtimeSessionId);
        return { status: 'accepted' };
      }
      if (event.type === 'uklad-eval-sub-result') {
        this.resolveSubEval(event.payload, runtimeId, runtimeSessionId);
        return { status: 'accepted' };
      }

      const retentionRejected = this.processStorageEvent(runtime, event);
      if (event.type === 'uklad-runtime-info') {
        this.notifyUiRuntimeStatus();
      }
      this.broadcastEventToUI(runtime, event);
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
          `[Uklad Devtools] Retention limit rejected event type ${candidate.type}; payload dropped.`,
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
        `[Uklad Devtools] Internal processing failure for runtime event type ${candidate.type}.`,
      );
      return { status: 'internal-error' };
    }
  }

  private processStorageEvent(runtime: RuntimeEntry, event: any): boolean {
    const storage = runtime.snapshot;
    switch (event.type) {
      case 'uklad-traces':
        if (Array.isArray(event.payload)) {
          return storage.addTraces(event.payload);
        }
        break;
      case 'uklad-state':
        if (event.payload !== undefined) {
          storage.updateState(event.payload);
        }
        break;
      case 'uklad-active-subs':
        if (event.payload && typeof event.payload === 'object') {
          storage.updateActiveSubs(event.payload);
        }
        break;
      case 'uklad-handler-keys':
        if (event.payload) storage.updateHandlerKeys(event.payload);
        break;
      case 'uklad-runtime-info':
        if (event.payload) storage.updateRuntimeInfo(event.payload);
        break;
    }
    return false;
  }

  private resolveDispatch(payload: any, runtimeId: string, runtimeSessionId: string): void {
    const dispatchId = payload?.dispatchId;
    if (typeof dispatchId !== 'string') return;
    const pending = this.pendingDispatches.get(dispatchId);
    if (
      !pending ||
      pending.runtimeId !== runtimeId ||
      pending.runtimeSessionId !== runtimeSessionId
    )
      return;

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
        ...this.runtimeResponseIdentityById(pending.runtimeId),
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
        ...this.runtimeResponseIdentityById(pending.runtimeId),
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
      runtimeId: pending.runtimeId,
      status,
      reason,
      traceId: payload.trace?.id,
      durationMs: Date.now() - pending.startedAt,
    });
    this.sendSerialized(pending.res, body);
  }

  private resolveOperation(payload: any, runtimeId: string, runtimeSessionId: string): void {
    const dispatchId = payload?.dispatchId;
    if (typeof dispatchId !== 'string') return;
    const pending = this.pendingDispatches.get(dispatchId);
    if (
      !pending ||
      !pending.expectsOperationSnapshot ||
      pending.runtimeId !== runtimeId ||
      pending.runtimeSessionId !== runtimeSessionId
    ) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingDispatches.delete(dispatchId);
    const operation = payload?.result?.operation;
    const operationStatus = typeof operation?.status === 'string' ? operation.status : 'unknown';
    const status: AuditRecord['status'] =
      operationStatus === 'completed'
        ? 'succeeded'
        : operationStatus === 'completed-with-errors'
          ? 'effects-failed'
          : operationStatus === 'failed' || operationStatus === 'rejected'
            ? 'failed'
            : 'unknown';
    this.appendAudit({
      requestId: pending.requestId,
      principal: 'mcp',
      client: pending.client,
      transport: 'http',
      action: 'dispatch',
      capability: 'dispatch',
      target: pending.target,
      runtimeId: pending.runtimeId,
      status,
      reason: typeof payload?.error === 'string' ? payload.error : undefined,
      durationMs: Date.now() - pending.startedAt,
    });

    if (typeof payload?.error === 'string') {
      pending.res.status(502).json({
        success: false,
        requestId: pending.requestId,
        ...this.runtimeResponseIdentityById(pending.runtimeId),
        code: 'OPERATION_EXECUTION_FAILED',
        error: payload.error,
      });
      return;
    }

    this.sendSerialized(pending.res, {
      success: true,
      requestId: pending.requestId,
      ...this.runtimeResponseIdentityById(pending.runtimeId),
      operation,
      // Kept only for pre-operation-API MCP bridges. Both fields point to
      // the same DevTools-owned canonical snapshot; no legacy receipt is
      // reconstructed or retained by the runtime.
      receipt: operation,
    });
  }

  private resolveSubEval(payload: any, runtimeId: string, runtimeSessionId: string): void {
    const evalId = payload?.evalId;
    if (typeof evalId !== 'string') return;
    const pending = this.pendingSubEvals.get(evalId);
    if (
      !pending ||
      pending.runtimeId !== runtimeId ||
      pending.runtimeSessionId !== runtimeSessionId
    )
      return;

    clearTimeout(pending.timeout);
    this.pendingSubEvals.delete(evalId);
    if (payload.error) {
      pending.res.status(payload.error.phase === 'missing-handler' ? 404 : 422).json({
        success: false,
        ...this.runtimeResponseIdentityById(pending.runtimeId),
        error: payload.error,
      });
      return;
    }
    this.sendSerialized(pending.res, {
      success: true,
      ...this.runtimeResponseIdentityById(pending.runtimeId),
      value: payload.value,
    });
  }

  private failPendingDispatches(reason: string, runtimeId?: string): void {
    for (const [dispatchId, pending] of this.pendingDispatches) {
      if (runtimeId !== undefined && pending.runtimeId !== runtimeId) continue;
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
        runtimeId: pending.runtimeId,
        status: 'unknown',
        reason,
        durationMs: Date.now() - pending.startedAt,
      });
      pending.res.json({
        success: true,
        outcome: 'unknown',
        requestId: pending.requestId,
        ...this.runtimeResponseIdentityById(pending.runtimeId),
        message: reason,
      });
    }
  }

  private failPendingSubEvals(reason: string, runtimeId?: string): void {
    for (const [evalId, pending] of this.pendingSubEvals) {
      if (runtimeId !== undefined && pending.runtimeId !== runtimeId) continue;
      clearTimeout(pending.timeout);
      this.pendingSubEvals.delete(evalId);
      pending.res.status(503).json({
        success: false,
        ...this.runtimeResponseIdentityById(pending.runtimeId),
        error: reason,
      });
    }
  }

  private getTracingDemandCount(): number {
    const mcpNeedsTracing =
      this.config.enableMCP &&
      (this.capabilities.has('inspect') || this.capabilities.has('dispatch'));
    const uiNeedsTracing = [...this.uiClients.values()].some(
      ({ auth }) => auth.capabilities.has('inspect') || auth.capabilities.has('dispatch'),
    );
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
    for (const runtime of this.connectedRuntimes()) {
      this.sendTracingDemand(runtime.socket!);
    }
  }

  private sendRuntimeStatusToUi(client: WebSocket): void {
    const metadata = this.uiClients.get(client);
    this.sendToSocket(client, {
      type: 'devtools-runtime-status',
      payload: {
        selectedRuntimeId: metadata?.selectedRuntimeId ?? null,
        runtimes: this.runtimeSummaries(),
      },
      timestamp: Date.now(),
    });
  }

  private notifyUiRuntimeStatus(): void {
    for (const client of this.uiClients.keys()) {
      this.sendRuntimeStatusToUi(client);
    }
  }

  private refreshUiSelectionsAfterRuntimeConnect(runtime: RuntimeEntry): void {
    const isOnlyConnectedRuntime = this.connectedRuntimes().length === 1;
    for (const [client, metadata] of this.uiClients) {
      if (
        metadata.selectedRuntimeId !== runtime.runtimeId &&
        !(metadata.selectedRuntimeId === null && isOnlyConnectedRuntime)
      ) {
        continue;
      }
      metadata.selectedRuntimeId = runtime.runtimeId;
      this.sendRuntimeStatusToUi(client);
      this.sendSelectedRuntimeSnapshot(client, runtime);
    }
  }

  private sendSelectedRuntimeSnapshot(client: WebSocket, runtime: RuntimeEntry): void {
    this.sendRuntimeSelectionAcknowledgement(client, runtime);

    const metadata = this.uiClients.get(client);
    if (!metadata?.auth.capabilities.has('inspect')) return;

    const storage = runtime.snapshot;
    const traces = storage.getTraces();
    if (traces.length === 0) {
      this.sendTaggedRuntimeEventToUi(client, runtime, {
        type: 'uklad-traces',
        payload: [],
        timestamp: Date.now(),
      });
    } else {
      for (let index = 0; index < traces.length; index += 200) {
        this.sendTaggedRuntimeEventToUi(client, runtime, {
          type: 'uklad-traces',
          payload: traces.slice(index, index + 200),
          timestamp: Date.now(),
        });
      }
    }
    this.sendTaggedRuntimeEventToUi(client, runtime, {
      type: 'uklad-state',
      payload: storage.getState(),
      timestamp: Date.now(),
    });
    this.sendTaggedRuntimeEventToUi(client, runtime, {
      type: 'uklad-active-subs',
      payload: storage.getActiveSubs(),
      timestamp: Date.now(),
    });
    this.sendTaggedRuntimeEventToUi(client, runtime, {
      type: 'uklad-handler-keys',
      payload: storage.getHandlerKeys(),
      timestamp: Date.now(),
    });
    this.sendTaggedRuntimeEventToUi(client, runtime, {
      type: 'uklad-runtime-info',
      payload: storage.getRuntimeInfo(),
      timestamp: Date.now(),
    });
  }

  private sendRuntimeSelectionAcknowledgement(client: WebSocket, runtime: RuntimeEntry): void {
    this.sendToSocket(client, {
      type: 'devtools-runtime-selected',
      payload: this.runtimeResponseIdentity(runtime),
      timestamp: Date.now(),
    });
  }

  private sendTaggedRuntimeEventToUi(client: WebSocket, runtime: RuntimeEntry, event: any): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(
        {
          ...event,
          ...this.runtimeResponseIdentity(runtime),
        },
        ukladReplacer,
      );
    } catch {
      return;
    }
    this.sendRawToSocket(client, serialized);
  }

  private broadcastEventToUI(runtime: RuntimeEntry, event: any): void {
    for (const [client, metadata] of this.uiClients) {
      if (
        !metadata.auth.capabilities.has('inspect') ||
        metadata.selectedRuntimeId !== runtime.runtimeId
      )
        continue;
      this.sendTaggedRuntimeEventToUi(client, runtime, event);
    }
  }

  private sendToRuntime(runtime: RuntimeEntry, message: any): number {
    const client = runtime.socket;
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
    if (client.bufferedAmount > this.config.maxRuntimePayloadBytes * 2) {
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

  private runtimeTelemetryDropPayload(drop: RuntimeTelemetryDrop): RuntimeTelemetryDroppedPayload {
    return {
      code: UKLAD_DEVTOOLS_TELEMETRY_DROPPED_CODE,
      reason: drop.reason,
      eventType: drop.eventType,
    };
  }

  private sendRuntimeTelemetryNotice(client: WebSocket, drop: RuntimeTelemetryDrop): void {
    this.sendToSocket(client, {
      type: UKLAD_DEVTOOLS_RUNTIME_ERROR_TYPE,
      payload: this.runtimeTelemetryDropPayload(drop),
      timestamp: Date.now(),
    });
  }

  private appendAudit(
    record: Omit<AuditRecord, 'id' | 'timestamp' | 'sessionEpoch' | 'protocolVersion'>,
  ): void {
    const runtime = record.runtimeId ? this.runtimes.get(record.runtimeId) : undefined;
    const fullRecord: AuditRecord = Object.freeze({
      ...record,
      runtimeName: record.runtimeName ?? runtime?.runtimeName,
      id: randomUUID(),
      timestamp: Date.now(),
      sessionEpoch: runtime?.sessionEpoch ?? 0,
      protocolVersion: UKLAD_DEVTOOLS_PROTOCOL_VERSION,
    });
    this.auditRecords.push(fullRecord);
    if (this.auditRecords.length > this.config.maxAuditRecords) {
      this.auditRecords.splice(0, this.auditRecords.length - this.config.maxAuditRecords);
    }
    if (this.config.onAuditRecord) {
      try {
        void Promise.resolve(this.config.onAuditRecord(fullRecord)).catch(() =>
          console.error('[Uklad Devtools] Audit sink failed.'),
        );
      } catch {
        console.error('[Uklad Devtools] Audit sink failed.');
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
    return (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= MAX_EVENT_ID_LENGTH &&
      !/[\u0000-\u001F\u007F]/.test(value)
    );
  }

  private validRuntimeId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  }

  private validRuntimeIdentityText(value: unknown, maxLength: number): value is string {
    return (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= maxLength &&
      !/[\u0000-\u001F\u007F]/.test(value)
    );
  }

  private validDispatchPayload(payload: any): boolean {
    return (
      this.validEventId(payload?.eventName) &&
      (payload.params === undefined || Array.isArray(payload.params)) &&
      (payload.params?.length ?? 0) <= MAX_EVENT_PARAMS
    );
  }

  private validRuntimeEvent(event: any): boolean {
    switch (event.type) {
      case 'uklad-traces':
        return this.validTraceBatch(event.payload);
      case 'uklad-state':
        return event.payload !== undefined;
      case 'uklad-active-subs':
        return this.validActiveSubscriptions(event.payload);
      case 'uklad-handler-keys':
        return this.validHandlerKeys(event.payload);
      case 'uklad-runtime-info':
        return this.validRuntimeInfo(event.payload);
      case 'uklad-dispatch-result':
        return this.validDispatchResult(event.payload);
      case 'uklad-operation-result':
        return this.validOperationResult(event.payload);
      case 'uklad-eval-sub-result':
        return this.validSubEvaluationResult(event.payload);
      default:
        return false;
    }
  }

  private validTraceBatch(payload: unknown): boolean {
    if (!Array.isArray(payload) || payload.length > MAX_RUNTIME_TRACES_PER_MESSAGE) {
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
    if (!Number.isSafeInteger(trace.id) || trace.id < 0 || !Number.isFinite(trace.start)) {
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
        trace[key] !== undefined &&
        (typeof trace[key] !== 'string' || trace[key].length > limit)
      ) {
        return false;
      }
    }
    if (
      trace.runtimeInstanceId !== undefined
      && !this.validRuntimeIdentityText(trace.runtimeInstanceId, 256)
    ) {
      return false;
    }
    for (const key of ['eventInstanceId', 'parentEventInstanceId'] as const) {
      if (
        trace[key] !== undefined
        && !this.validRuntimeIdentityText(trace[key], MAX_EVENT_ID_LENGTH)
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
    return (
      entries.length <= MAX_ACTIVE_SUB_CHANGES_PER_MESSAGE &&
      entries.every(
        ([key]) =>
          key.length > 0 &&
          key.length <= MAX_DIAGNOSTIC_KEY_LENGTH &&
          !/[\u0000-\u001F\u007F]/.test(key),
      )
    );
  }

  private validHandlerKeys(payload: unknown): boolean {
    if (!isRecord(payload)) return false;
    return (['event', 'fx', 'cofx', 'sub'] as const).every((key) => {
      const values = payload[key];
      return (
        Array.isArray(values) &&
        values.length <= MAX_HANDLER_KEYS_PER_TYPE &&
        values.every((value) => this.validEventId(value))
      );
    });
  }

  private validRuntimeInfo(payload: unknown): boolean {
    if (!isRecord(payload)) return false;
    if (
      payload.runtime !== undefined &&
      payload.runtime !== 'browser' &&
      payload.runtime !== 'headless' &&
      payload.runtime !== 'react-native'
    ) {
      return false;
    }
    if (
      payload.effectMode !== undefined &&
      (typeof payload.effectMode !== 'string' || payload.effectMode.length > 256)
    ) {
      return false;
    }
    if (payload.tracing !== undefined && typeof payload.tracing !== 'boolean') {
      return false;
    }
    if (
      payload.protocolVersion !== undefined &&
      payload.protocolVersion !== UKLAD_DEVTOOLS_PROTOCOL_VERSION
    ) {
      return false;
    }
    if (payload.inspectorApiVersion !== undefined && payload.inspectorApiVersion !== 2) {
      return false;
    }
    if (payload.operationApiVersion !== undefined && payload.operationApiVersion !== 1) {
      return false;
    }
    if (payload.effects !== undefined) {
      if (!isRecord(payload.effects)) return false;
      const effects = Object.entries(payload.effects);
      if (effects.length > MAX_RUNTIME_EFFECT_ADAPTERS) return false;
      if (
        !effects.every(
          ([key, value]) =>
            this.validEventId(key) && typeof value === 'string' && value.length <= 256,
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private validDispatchResult(payload: unknown): boolean {
    if (
      !isRecord(payload) ||
      typeof payload.dispatchId !== 'string' ||
      payload.dispatchId.length > 128
    ) {
      return false;
    }
    if (payload.trace !== undefined && !this.validTraceBatch([payload.trace])) {
      return false;
    }
    return (
      payload.reason === undefined ||
      (typeof payload.reason === 'string' && payload.reason.length <= 1024)
    );
  }

  private validOperationResult(payload: unknown): boolean {
    if (
      !isRecord(payload) ||
      typeof payload.dispatchId !== 'string' ||
      payload.dispatchId.length > 128
    ) {
      return false;
    }
    return (
      (payload.result !== undefined && isRecord(payload.result)) ||
      (typeof payload.error === 'string' && payload.error.length <= 4096)
    );
  }

  private validSubEvaluationResult(payload: unknown): boolean {
    if (!isRecord(payload) || typeof payload.evalId !== 'string' || payload.evalId.length > 128) {
      return false;
    }
    if (payload.error === undefined) return 'value' in payload;
    if (!isRecord(payload.error)) return false;
    return (
      typeof payload.error.phase === 'string' &&
      payload.error.phase.length <= 128 &&
      typeof payload.error.message === 'string' &&
      payload.error.message.length <= 4096 &&
      (payload.error.stack === undefined ||
        (typeof payload.error.stack === 'string' && payload.error.stack.length <= 16 * 1024))
    );
  }

  private selectStatePath(state: unknown, pathValue: string): { found: boolean; value?: unknown } {
    const parts = pathValue.split(/\.|\[|\]/).filter((part) => part.length > 0);
    if (parts.length === 0 || parts.length > 64) return { found: false };

    let current: any = state;
    for (const part of parts) {
      if (part === '__proto__' || part === 'prototype' || part === 'constructor') {
        return { found: false };
      }
      if (current instanceof Map) {
        if (!current.has(part)) return { found: false };
        current = current.get(part);
        continue;
      }
      if (
        current === null ||
        (typeof current !== 'object' && !Array.isArray(current)) ||
        !Object.prototype.hasOwnProperty.call(current, part)
      ) {
        return { found: false };
      }
      current = current[part];
    }
    return { found: true, value: current };
  }

  private isRuntimeConnected(runtime: RuntimeEntry): boolean {
    return runtime.socket?.readyState === WebSocket.OPEN && runtime.metadata !== null;
  }

  private connectedRuntimes(): RuntimeEntry[] {
    return [...this.runtimes.values()].filter((runtime) => this.isRuntimeConnected(runtime));
  }

  private runtimeSummaries(): DevtoolsRuntimeSummary[] {
    return [...this.runtimes.values()].map((runtime) => ({
      runtimeId: runtime.runtimeId,
      runtimeName: runtime.runtimeName,
      ...(runtime.metadata?.runtimeInstanceId === undefined
        ? {}
        : { runtimeInstanceId: runtime.metadata.runtimeInstanceId }),
      connected: this.isRuntimeConnected(runtime),
      sessionEpoch: runtime.sessionEpoch,
      runtime: runtime.snapshot.getRuntimeInfo()?.runtime ?? null,
    }));
  }

  private createRuntimeStorage(): Pick<RuntimeEntry, 'snapshot' | 'storage'> {
    if (this.config.enableMCP) {
      const storage = new TraceStorage(this.config.maxTraces);
      return { snapshot: storage, storage };
    }

    // maxTraces=0 retains the bounded state/subscription/handler mirror and
    // applies trace patches while discarding trace history after each batch.
    return { snapshot: new TraceStorage(0), storage: null };
  }

  private runtimeResponseIdentity(runtime: RuntimeEntry): {
    runtimeId: string;
    runtimeName: string;
    sessionEpoch: number;
    runtimeInstanceId?: string;
  } {
    return {
      runtimeId: runtime.runtimeId,
      runtimeName: runtime.runtimeName,
      sessionEpoch: runtime.sessionEpoch,
      ...(runtime.metadata?.runtimeInstanceId === undefined
        ? {}
        : { runtimeInstanceId: runtime.metadata.runtimeInstanceId }),
    };
  }

  private runtimeResponseIdentityById(runtimeId: string): {
    runtimeId: string;
    runtimeName: string;
    sessionEpoch: number;
    runtimeInstanceId?: string;
  } {
    const runtime = this.runtimes.get(runtimeId);
    return runtime
      ? this.runtimeResponseIdentity(runtime)
      : { runtimeId, runtimeName: runtimeId, sessionEpoch: 0 };
  }

  private evictRetainedRuntimeIfNeeded(): void {
    if (this.runtimes.size < this.config.maxRuntimes) return;
    let oldest: RuntimeEntry | null = null;
    let oldestUnselected: RuntimeEntry | null = null;
    const selectedRuntimeIds = new Set(
      [...this.uiClients.values()]
        .map((metadata) => metadata.selectedRuntimeId)
        .filter((runtimeId): runtimeId is string => runtimeId !== null),
    );
    for (const runtime of this.runtimes.values()) {
      if (this.isRuntimeConnected(runtime)) continue;
      if (!oldest || runtime.lastConnectedAt < oldest.lastConnectedAt) {
        oldest = runtime;
      }
      if (
        !selectedRuntimeIds.has(runtime.runtimeId) &&
        (!oldestUnselected || runtime.lastConnectedAt < oldestUnselected.lastConnectedAt)
      ) {
        oldestUnselected = runtime;
      }
    }
    const evicted = oldestUnselected ?? oldest;
    if (!evicted) return;
    this.runtimes.delete(evicted.runtimeId);
    for (const metadata of this.uiClients.values()) {
      if (metadata.selectedRuntimeId === evicted.runtimeId) {
        metadata.selectedRuntimeId = null;
      }
    }
  }

  private resolveRuntimeSelection(runtimeId: unknown): RuntimeSelectionResult {
    if (runtimeId !== undefined) {
      if (!this.validRuntimeId(runtimeId)) {
        return {
          ok: false,
          status: 400,
          code: 'INVALID_RUNTIME_ID',
          error: 'runtimeId is invalid.',
        };
      }
      const runtime = this.runtimes.get(runtimeId);
      if (!runtime) {
        return {
          ok: false,
          status: 404,
          code: 'RUNTIME_NOT_FOUND',
          error: `No runtime with id "${runtimeId}" is known to this server.`,
        };
      }
      return { ok: true, runtime };
    }

    const connected = this.connectedRuntimes();
    if (connected.length === 1) {
      return { ok: true, runtime: connected[0]! };
    }
    return {
      ok: false,
      status: 409,
      code: 'RUNTIME_SELECTION_REQUIRED',
      error:
        connected.length === 0
          ? 'runtimeId is required because no runtime is connected.'
          : 'runtimeId is required because multiple runtimes are connected.',
    };
  }

  private sendRuntimeSelectionError(
    res: Response,
    selection: Exclude<RuntimeSelectionResult, { readonly ok: true }>,
    requestId?: string,
  ): void {
    res.status(selection.status).json({
      success: false,
      requestId,
      code: selection.code,
      error: selection.error,
      selectedRuntimeId: null,
      runtimes: this.runtimeSummaries(),
    });
  }

  private selectRuntimeForHttp(
    req: Request,
    res: Response,
    source: 'query' | 'body',
    requestId?: string,
  ): RuntimeEntry | null {
    const runtimeId = source === 'query' ? req.query.runtimeId : req.body?.runtimeId;
    const selection = this.resolveRuntimeSelection(runtimeId);
    if (!selection.ok) {
      this.sendRuntimeSelectionError(res, selection, requestId);
      return null;
    }
    return selection.runtime;
  }

  private requireStorage(runtime: RuntimeEntry, res: Response): boolean {
    if (runtime.storage) return true;
    res.status(503).json({
      success: false,
      runtimeId: runtime.runtimeId,
      error: 'MCP inspection is disabled. Start the server with --mcp.',
    });
    return false;
  }

  private sendSerialized(res: Response, value: unknown): void {
    res.type('application/json').send(JSON.stringify(value, mapSetUkladReplacer));
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
    console.error(`[Uklad Devtools] Internal server error (request ${requestId}; ${errorName}).`);
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
        const port = address && typeof address === 'object' ? address.port : this.config.port;
        console.log(`[Uklad Devtools] Dashboard: http://${this.config.host}:${port}`);
        console.log(
          `[Uklad Devtools] Capabilities: ${[...this.capabilities].join(', ') || 'none'}`,
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
    for (const runtime of this.runtimes.values()) {
      runtime.socket?.terminate();
      runtime.socket = null;
    }
    this.runtimes.clear();

    return new Promise((resolve) => {
      let websocketServersClosed = 0;
      const closeHttp = (): void => {
        websocketServersClosed += 1;
        if (websocketServersClosed !== 2) return;
        this.server.close(() => {
          console.log('[Uklad Devtools] Server stopped');
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
      const sockets = new Set<WebSocket>([...this.pendingWebSockets, ...this.uiClients.keys()]);
      for (const runtime of this.connectedRuntimes()) {
        sockets.add(runtime.socket!);
      }

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
