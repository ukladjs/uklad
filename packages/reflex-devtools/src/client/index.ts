import { reflexReplacer } from '../serialization.js';
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
  REFLEX_DEVTOOLS_RUNTIME_ID_HEADER,
  REFLEX_DEVTOOLS_RUNTIME_SESSION_HEADER,
  REFLEX_DEVTOOLS_TELEMETRY_DROPPED_CODE,
  REFLEX_DEVTOOLS_WS_PROTOCOL,
  type DevtoolsRuntimeKind,
  type RuntimeTelemetryDroppedPayload,
} from '../protocol.js';
import { diffSubscriptionDiagnostics } from './subscriptionDiagnostics.js';
import { createOperationInspector } from './operations/inspector.js';
import type {
  ReflexInspector,
  ReflexInspectorSnapshot,
  ReflexDevtoolsRuntime,
  ReflexTrace,
} from './types.js';
import type {
  OperationCompletionBoundary,
  OperationExecutionContextInput,
} from './operations/types.js';

export type {
  ReflexHandlerKeys,
  ReflexInspector,
  ReflexInspectorSnapshot,
  ReflexDevtoolsRuntime,
  ReflexSubscriptionDiagnostic,
  ReflexTrace,
  ReflexTraceCallback,
} from './types.js';
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
  REFLEX_DEVTOOLS_RUNTIME_ID_HEADER,
} from '../protocol.js';
export type {
  DevtoolsCapability,
  DevtoolsClientRole,
  DevtoolsProtocolInfo,
  DevtoolsRuntimeIdentity,
  DevtoolsRuntimeKind,
  DevtoolsRuntimeSummary,
} from '../protocol.js';

export interface DevtoolsConfig {
  serverUrl?: string;
  enabled?: boolean;
  /**
   * Permit sending a runtime bearer token to a non-loopback http:// endpoint.
   * Prefer HTTPS or a loopback SSH tunnel. This opt-out is intentionally
   * explicit because bearer credentials provide no protection on plaintext.
   */
  allowInsecureRemote?: boolean;
  /**
   * Runtime-scoped session token. Local loopback clients obtain a generated
   * process token automatically; remote clients must receive this explicitly.
   */
  sessionToken?: string;
  /**
   * Redaction runs before state or traces leave the application process.
   * Common credential-like keys are masked by default. Set `false` only when
   * the inspected data is known to be non-sensitive.
   */
  redaction?: DevtoolsRedaction | false;
  /**
   * Which environment the app runs in. Auto-detected when omitted:
   * 'react-native' when navigator.product says so, 'headless' when there
   * is no `window` (Node under tsx/vite-node), 'browser' otherwise.
   * Surfaced through the server's /api/status.
   */
  runtime?: DevtoolsRuntimeKind;
  /**
   * Free-form label for the app's side-effect policy, e.g. 'real' in the
   * browser entry or 'safe' in a headless entry whose adapters are
   * memory-backed/no-op.
   */
  effectMode?: string;
  /**
   * Adapter mode per effect/coeffect id, e.g.
   * { 'local-storage-set': 'memory', 'analytics-track': 'noop' }.
   * Purely informational — tells agents which effects really execute.
   */
  effects?: Record<string, string>;
  /**
   * Enable retained operation receipts for the target runtime. Normal
   * DevTools clients still never import or bundle Reflex.
   */
  operations?: DevtoolsOperationsConfig;
}

export interface DevtoolsOperationsConfig {
  /**
   * Informational defaults declared by the application for agent-executed
   * operations. They are attached to every server-initiated operation.
   */
  executionContext?: OperationExecutionContextInput;
  /** Completion boundary used for server-initiated operations. */
  completion?: OperationCompletionBoundary;
}

export interface EventPayload {
  type: string;
  component?: string;
  payload: any;
  timestamp?: number;
}

// How long a server-initiated dispatch waits for its event trace before
// reporting an unknown outcome. Kept below the server's own /api/dispatch
// timeout so the server gets a definitive answer instead of timing out.
const DISPATCH_TRACE_TIMEOUT_MS = 4000;
const HEALTH_REQUEST_TIMEOUT_MS = 3000;
const EVENT_REQUEST_TIMEOUT_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_STABILITY_MS = 10_000;
const MAX_DEDUPLICATED_DIAGNOSTICS = 128;
const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_RUNTIME_NAME_LENGTH = 256;
const MAX_RUNTIME_SESSION_ID_LENGTH = 128;

// React Native must be checked before `window`: RN aliases the global object
// to `window`, so a window check alone would mislabel it as a browser.
// navigator.product === 'ReactNative' is RN's canonical self-identification;
// real browsers report 'Gecko' and Node's navigator has no product at all.
function detectRuntime(): DevtoolsRuntimeKind {
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    return 'react-native';
  }
  return typeof window === 'undefined' ? 'headless' : 'browser';
}

interface PendingDispatch {
  dispatchId: string;
  eventId: string;
  timeout: ReturnType<typeof setTimeout>;
}

class DevtoolsClient {
  private inspector: ReflexInspector;
  private config: DevtoolsConfig;
  private httpBaseUrl: string;
  private webSocketBaseUrl: string;
  private sessionToken: string | null;
  private readonly hasConfiguredSessionToken: boolean;
  private runtimeSessionId: string | null = null;
  private redaction: DevtoolsRedaction | undefined;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isTracingEnabled = false;
  private serverAvailable = false;
  private isDisposed = false;
  private traceUnsubscribe: (() => void) | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectionStableTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxRuntimePayloadBytes =
    REFLEX_DEVTOOLS_DEFAULT_RUNTIME_PAYLOAD_BYTES;
  private readonly emittedDiagnostics = new Set<string>();
  private rejectConnection: ((error: unknown) => void) | null = null;
  private healthController: AbortController | null = null;
  private eventControllers = new Set<AbortController>();
  private subscriptionVersions = new Map<string, number>();
  private pendingDispatches: PendingDispatch[] = [];
  private dispatchCorrelations = new WeakMap<object, string>();

  constructor(inspector: ReflexInspector, config: DevtoolsConfig) {
    this.inspector = inspector;
    this.config = {
      enabled: true,
      serverUrl: '127.0.0.1:4000',
      runtime: detectRuntime(),
      ...config,
    };
    this.httpBaseUrl = normalizeHttpBaseUrl(
      this.config.serverUrl!,
      this.config.allowInsecureRemote ?? false,
    );
    this.webSocketBaseUrl = this.httpBaseUrl.replace(/^http/, 'ws');
    this.hasConfiguredSessionToken = this.config.sessionToken !== undefined;
    this.sessionToken = this.config.sessionToken ?? null;
    if (this.config.redaction === false) {
      this.redaction = undefined;
    } else {
      const redactSensitiveKeys = createKeyRedactor();
      this.redaction = {
        state: this.config.redaction?.state ?? redactSensitiveKeys,
        trace: this.config.redaction?.trace ?? redactSensitiveKeys,
      };
    }
  }

  async init(): Promise<void> {
    if (!this.config.enabled || this.isDisposed) return;

    // Browsers and React Native always have WebSocket; Node only from v22
    // (v21 experimentally). Without this guard the constructor throw would be
    // swallowed and the SDK would limp along on the HTTP fallback — traces
    // flowing but dispatch impossible — which is far harder to diagnose than
    // an explicit refusal.
    if (typeof WebSocket === 'undefined') {
      console.warn('[Reflex Devtools] No global WebSocket in this runtime — headless mode requires Node >= 22. Devtools disabled.');
      return;
    }

    this.serverAvailable = await this.checkServerAvailability();
    if (this.isDisposed) return;
    if (!this.serverAvailable) {
      console.warn('[Reflex Devtools] Server not available, disabling devtools');
      this.scheduleReconnect();
      return;
    }

    if (!this.sessionToken) {
      this.sessionToken = await this.bootstrapSession();
      if (this.isDisposed) return;
      if (!this.sessionToken) {
        console.warn(
          '[Reflex Devtools] Could not obtain a runtime session token. ' +
          'Remote servers require DevtoolsConfig.sessionToken.',
        );
        this.scheduleReconnect();
        return;
      }
    }

    try {
      await this.connectWebSocket();
    } catch (error) {
      if (!this.isDisposed) {
        console.warn(
          '[Reflex Devtools] Authenticated WebSocket connection failed:',
          error instanceof Error ? error.message : 'Unknown error',
        );
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.isDisposed || this.reconnectTimer) return;
    const exponentialDelay = Math.min(
      500 * (2 ** Math.min(this.reconnectAttempts, 5)),
      RECONNECT_MAX_DELAY_MS,
    );
    // Equal jitter avoids synchronized reconnect storms while retaining a
    // useful lower bound for repeated policy failures.
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      Math.ceil(exponentialDelay / 2)
        + Math.floor(Math.random() * Math.max(1, exponentialDelay / 2)),
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
    (this.reconnectTimer as any).unref?.();
  }

  private async reconnect(): Promise<void> {
    if (this.isDisposed || this.isConnected) return;

    this.serverAvailable = await this.checkServerAvailability();
    if (this.isDisposed) return;
    if (!this.serverAvailable) {
      this.scheduleReconnect();
      return;
    }

    if (!this.sessionToken) {
      this.sessionToken = await this.bootstrapSession();
      if (this.isDisposed) return;
      if (!this.sessionToken) {
        this.scheduleReconnect();
        return;
      }
    }

    try {
      await this.connectWebSocket();
    } catch {
      if (!this.isDisposed) this.scheduleReconnect();
    }
  }

  private mapSubscriptionDiagnostics(
    snapshot: ReflexInspectorSnapshot,
    resetCache = false,
  ): Record<string, unknown> {
    return diffSubscriptionDiagnostics(
      snapshot.subscriptions,
      this.subscriptionVersions,
      resetCache,
    );
  }

  private async checkServerAvailability(): Promise<boolean> {
    const controller = createAbortController();
    const timeout = controller
      ? setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS)
      : null;
    this.healthController = controller;
    const request: RequestInit = { method: 'GET', redirect: 'error' };
    if (controller) {
      request.signal = controller.signal;
    }

    try {
      const response = await fetch(`${this.httpBaseUrl}/health`, request);
      if (!response.ok || this.isDisposed) return false;
      const body = await response.json().catch(() => null);
      return response.headers.get(REFLEX_DEVTOOLS_PROTOCOL_HEADER)
          === String(REFLEX_DEVTOOLS_PROTOCOL_VERSION)
        && body?.protocolVersion === REFLEX_DEVTOOLS_PROTOCOL_VERSION;
    } catch (error) {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (this.healthController === controller) {
        this.healthController = null;
      }
    }
  }

  private async bootstrapSession(): Promise<string | null> {
    const controller = createAbortController();
    const timeout = controller
      ? setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS)
      : null;
    if (controller) this.eventControllers.add(controller);
    const request: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [REFLEX_DEVTOOLS_PROTOCOL_HEADER]:
          String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
        [REFLEX_DEVTOOLS_CLIENT_HEADER]: 'reflex-devtools-runtime',
      },
      body: JSON.stringify({ role: 'runtime' }),
      redirect: 'error',
    };
    if (controller) request.signal = controller.signal;

    try {
      const response = await fetch(
        `${this.httpBaseUrl}/auth/session`,
        request,
      );
      const body = await response.json().catch(() => null);
      if (
        !response.ok
        || response.headers.get(REFLEX_DEVTOOLS_PROTOCOL_HEADER)
          !== String(REFLEX_DEVTOOLS_PROTOCOL_VERSION)
        || body?.protocolVersion !== REFLEX_DEVTOOLS_PROTOCOL_VERSION
        || typeof body?.token !== 'string'
      ) {
        return null;
      }
      return body.token;
    } catch {
      return null;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (controller) this.eventControllers.delete(controller);
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isDisposed) {
        resolve();
        return;
      }

      const wsUrl = `${this.webSocketBaseUrl}/sdk`;
      const ws = new WebSocket(wsUrl, [REFLEX_DEVTOOLS_WS_PROTOCOL]);
      this.ws = ws;
      let settled = false;

      const clearConnectionTimeout = () => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
      };

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        this.rejectConnection = null;
        clearConnectionTimeout();
        resolve();
      };

      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        this.rejectConnection = null;
        clearConnectionTimeout();
        reject(error);
      };
      this.rejectConnection = rejectOnce;

      ws.onopen = () => {
        if (this.isDisposed) {
          ws.close();
          rejectOnce(new Error('Devtools client disposed during WebSocket connection'));
          return;
        }
        try {
          const operationCapability = this.operationCapability();
          ws.send(JSON.stringify({
            type: 'reflex-auth',
            payload: {
              role: 'runtime',
              token: this.sessionToken,
              protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
              inspectorApiVersion: this.inspector.apiVersion,
              runtimeId: this.inspector.runtimeId,
              runtimeName: this.inspector.runtimeName,
              ...(operationCapability
                ? {
                    operationApiVersion: 1,
                    runtimeInstanceId: operationCapability.runtimeInstanceId,
                  }
                : {}),
            },
          }));
        } catch (error) {
          rejectOnce(error);
        }
      };

      ws.onmessage = (event) => {
        if (this.isDisposed) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'devtools-server-hello') {
            const runtimePayloadBytes =
              message.payload?.limits?.runtimePayloadBytes;
            const runtimeSessionId = message.payload?.runtimeSessionId;
            const sessionEpoch = message.payload?.sessionEpoch;
            if (
              message.payload?.protocolVersion
                !== REFLEX_DEVTOOLS_PROTOCOL_VERSION
              || !validRuntimeIdentityText(
                runtimeSessionId,
                MAX_RUNTIME_SESSION_ID_LENGTH,
              )
              || message.payload.runtimeId !== this.inspector.runtimeId
              || message.payload.runtimeName !== this.inspector.runtimeName
              || !Number.isSafeInteger(sessionEpoch)
              || sessionEpoch < 1
              || !Number.isInteger(runtimePayloadBytes)
              || runtimePayloadBytes < 1
              || runtimePayloadBytes
                > REFLEX_DEVTOOLS_MAX_RUNTIME_PAYLOAD_BYTES
            ) {
              ws.close(1002, 'Invalid DevTools server hello');
              rejectOnce(new Error('DevTools protocol handshake failed'));
              return;
            }
            this.maxRuntimePayloadBytes = runtimePayloadBytes;
            this.runtimeSessionId = runtimeSessionId;
            this.isConnected = true;
            this.markConnectionStableAfter(ws);
            resolveOnce();
            return;
          }
          if (!this.isConnected) return;
          this.handleServerMessage(message);
        } catch (error) {
        }
      };

      ws.onerror = (error) => {
        rejectOnce(error);
      };

      ws.onclose = (event) => {
        const isCurrentSocket = this.ws === ws;
        if (isCurrentSocket) {
          this.ws = null;
          if (this.connectionStableTimer) {
            clearTimeout(this.connectionStableTimer);
            this.connectionStableTimer = null;
          }
          this.isConnected = false;
          this.runtimeSessionId = null;
          this.stopTracing(false);
          if (!this.hasConfiguredSessionToken) {
            this.sessionToken = null;
          }
        }
        if (!settled) {
          rejectOnce(new Error('WebSocket closed before connecting'));
        }
        const superseded =
          event.code === 1000
          && event.reason === 'Superseded by a newer authenticated runtime';
        if (!this.isDisposed && isCurrentSocket && !superseded) {
          this.reportAbnormalClose(event.code, event.reason);
          this.scheduleReconnect();
        }
      };

      // Set a timeout for connection
      this.connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          ws.close();
          rejectOnce(new Error('WebSocket connection timeout'));
        }
      }, 5000);
    });
  }

  private markConnectionStableAfter(ws: WebSocket): void {
    if (this.connectionStableTimer) {
      clearTimeout(this.connectionStableTimer);
    }
    this.connectionStableTimer = setTimeout(() => {
      this.connectionStableTimer = null;
      if (
        !this.isDisposed
        && this.ws === ws
        && this.isConnected
        && ws.readyState === WebSocket.OPEN
      ) {
        this.reconnectAttempts = 0;
      }
    }, RECONNECT_STABILITY_MS);
    (this.connectionStableTimer as any).unref?.();
  }

  private handleServerMessage(message: any): void {
    if (this.isDisposed) return;

    if (
      message.type === REFLEX_DEVTOOLS_RUNTIME_ERROR_TYPE
      && isRuntimeTelemetryDroppedPayload(message.payload)
    ) {
      this.reportRuntimeTelemetryDrop(message.payload);
    } else if (message.type === 'ui-connection-status') {
      const newUICount = message.payload.connectedUIs;


      // Start tracing when first UI connects
      if (newUICount > 0) {
        this.startTracing();
      }
      // Stop tracing when last UI disconnects
      else {
        this.stopTracing();
      }
    } else if (message.type === 'dispatch-to-client') {
      // Handle dispatch request from devtools UI or MCP
      const { dispatchId, eventName, params = [] } = message.payload;

      const eventVector: [string, ...any[]] = [eventName, ...params];
      if (message.payload.operation === true && dispatchId != null) {
        void this.executeOperation(dispatchId, eventVector);
        return;
      }

      // MCP dispatches carry a dispatchId and expect the event's trace back
      // (reflex-dispatch-result). UI dispatches don't. Register the watcher
      // before dispatching so the trace can't slip past it.
      if (dispatchId != null) {
        if (this.isTracingEnabled) {
          const timeout = setTimeout(() => {
            this.pendingDispatches = this.pendingDispatches.filter(p => p.dispatchId !== dispatchId);
            this.sendEvent({
              type: 'reflex-dispatch-result',
              payload: { dispatchId, reason: `no trace observed for '${eventName}' within ${DISPATCH_TRACE_TIMEOUT_MS}ms` }
            });
          }, DISPATCH_TRACE_TIMEOUT_MS);
          this.pendingDispatches.push({ dispatchId, eventId: eventName, timeout });
        } else {
          this.sendEvent({
            type: 'reflex-dispatch-result',
            payload: { dispatchId, reason: 'tracing is disabled in the app, outcome not observed' }
          });
        }
      }

      // Dispatch the event in the client app with all parameters
      if (typeof dispatchId === 'string') {
        this.dispatchCorrelations.set(eventVector, dispatchId);
      }
      this.inspector.dispatch(eventVector);
    } else if (message.type === 'eval-sub-to-client') {
      void this.evaluateSubscription(message.payload);
    }
  }

  private operationCapability(): {
    readonly runtimeInstanceId: string;
    readonly executeEvent: (event: [string, ...any[]]) => Promise<unknown>;
  } | null {
    if (
      this.inspector.operationApiVersion !== 1
      || !validRuntimeIdentityText(this.inspector.runtimeInstanceId, 256)
      || typeof this.inspector.executeEvent !== 'function'
    ) {
      return null;
    }
    return {
      runtimeInstanceId: this.inspector.runtimeInstanceId,
      executeEvent: (event) => this.inspector.executeEvent!(event, this.operationOptions()),
    };
  }

  private operationOptions(): {
    completion?: OperationCompletionBoundary;
    executionContext?: OperationExecutionContextInput;
  } | undefined {
    const operations = this.config.operations;
    if (!operations) return undefined;
    return {
      ...(operations.completion ? { completion: operations.completion } : {}),
      ...(operations.executionContext ? { executionContext: operations.executionContext } : {}),
    };
  }

  private async executeOperation(
    dispatchId: string,
    event: [string, ...any[]],
  ): Promise<void> {
    const operation = this.operationCapability();
    if (!operation) {
      await this.sendEvent({
        type: 'reflex-operation-result',
        payload: {
          dispatchId,
          error: 'The runtime does not expose the negotiated operation receipt capability.',
        },
      });
      return;
    }
    try {
      const result = await operation.executeEvent(event);
      await this.sendEvent({
        type: 'reflex-operation-result',
        payload: { dispatchId, result },
      });
    } catch (error) {
      await this.sendEvent({
        type: 'reflex-operation-result',
        payload: {
          dispatchId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private reportRuntimeTelemetryDrop(
    payload: RuntimeTelemetryDroppedPayload,
  ): void {
    const action = payload.reason === 'retention-limit'
      ? 'Reduce retained state/subscription data; reconnecting the runtime clears session retention.'
      : 'Check the server-side redaction hook; the unredacted value was not retained.';
    this.warnOnce(
      `${payload.code}:${payload.reason}:${payload.eventType}`,
      `[Reflex Devtools] Server dropped ${safeEventType(payload.eventType)} telemetry (${payload.reason}). ${action}`,
    );
  }

  private reportAbnormalClose(code: number, reason: string): void {
    if (code === 1000) return;
    const normalizedCode = Number.isInteger(code) ? code : 1006;
    const safeReason = sanitizeCloseReason(reason);
    const payloadGuidance = normalizedCode === 1009
      ? ' The peer enforced its hard WebSocket frame limit; verify the negotiated payload limit.'
      : '';
    this.warnOnce(
      `websocket-close:${normalizedCode}:${safeReason}`,
      `[Reflex Devtools] WebSocket closed abnormally (code ${normalizedCode}${safeReason ? `, reason: ${safeReason}` : ''}). Reconnecting with bounded backoff.${payloadGuidance}`,
    );
  }

  private warnOnce(key: string, message: string): void {
    if (this.emittedDiagnostics.has(key)) return;
    if (this.emittedDiagnostics.size >= MAX_DEDUPLICATED_DIAGNOSTICS) return;
    this.emittedDiagnostics.add(key);
    console.warn(message);
  }

  private async evaluateSubscription(payload: any): Promise<void> {
    const { evalId, id, args = [] } = payload;

    try {
      if (!this.inspector.getSnapshot().handlerKeys.sub.includes(id)) {
        await this.sendEvent({
          type: 'reflex-eval-sub-result',
          payload: {
            evalId,
            error: {
              phase: 'missing-handler',
              message: `No subscription handler registered for '${id}'`
            }
          }
        });
        return;
      }

      const value = this.inspector.evaluateSubscription([id, ...args]);
      await this.sendEvent({
        type: 'reflex-eval-sub-result',
        payload: { evalId, value }
      });
    } catch (error) {
      await this.sendEvent({
        type: 'reflex-eval-sub-result',
        payload: {
          evalId,
          error: {
            phase: 'evaluation',
            message: error instanceof Error ? error.message : String(error)
          }
        }
      });
    }
  }

  // Match freshly flushed event traces against dispatches awaiting an
  // outcome. FIFO by event id: if the app happens to dispatch the same event
  // concurrently, the earliest trace wins — acceptable ambiguity for a
  // dev-only observation channel.
  private async reportDispatchResults(traces: readonly ReflexTrace[]): Promise<void> {
    if (this.pendingDispatches.length === 0) return;

    for (const trace of traces) {
      if (trace.opType !== 'event') continue;
      const tracedEvent = trace.tags?.event;
      const correlationId =
        Array.isArray(tracedEvent)
          ? this.dispatchCorrelations.get(tracedEvent)
          : undefined;
      if (typeof correlationId !== 'string') continue;
      const index = this.pendingDispatches.findIndex(
        (pending) => pending.dispatchId === correlationId,
      );
      if (index === -1) continue;

      const pending = this.pendingDispatches.splice(index, 1)[0];
      if (!pending) continue;
      if (Array.isArray(tracedEvent)) {
        this.dispatchCorrelations.delete(tracedEvent);
      }
      clearTimeout(pending.timeout);
      await this.sendEvent({
        type: 'reflex-dispatch-result',
        payload: { dispatchId: pending.dispatchId, trace }
      });
    }
  }

  private startTracing(): void {
    if (this.isDisposed) return;

    if (!this.isTracingEnabled) {
      this.traceUnsubscribe = this.inspector.subscribeTraces(async (traces) => {
        if (this.isDisposed) return;

        // Awaited so the server has stored the traces before a dispatch
        // outcome referencing a trace id resolves — ws.send preserves order
        // by itself, but the HTTP fallback does not. sendEvent never rejects.
        await this.sendEvent({
          type: 'reflex-traces',
          component: 'Reflex',
          payload: traces
        });
        if (this.isDisposed) return;
        await this.sendEvent({
          type: 'reflex-active-subs',
          component: 'Reflex',
          payload: this.mapSubscriptionDiagnostics(this.inspector.getSnapshot())
        });
        await this.reportDispatchResults(traces);
      });
      this.isTracingEnabled = true;
    }

    const snapshot = this.inspector.getSnapshot();
    this.sendEvent({
      type: 'reflex-state',
      component: 'Reflex',
      payload: snapshot.appState
    });
    this.sendEvent({
      type: 'reflex-active-subs',
      component: 'Reflex',
      payload: this.mapSubscriptionDiagnostics(snapshot, true)
    });
    this.sendEvent({
      type: 'reflex-handler-keys',
      component: 'Reflex',
      payload: snapshot.handlerKeys
    });
    this.sendRuntimeInfo();
  }

  // Tells the server how this app runs (browser tab vs headless process),
  // which effect adapters are active, and whether tracing is on — surfaced
  // to agents through /api/status. Re-sent whenever tracing flips so the
  // server's view never goes stale.
  private sendRuntimeInfo(): void {
    // Omit unset optional fields instead of sending them as undefined: the
    // reflexReplacer serializes undefined to the string 'undefined', which the
    // server's runtime-info schema rejects (e.g. effects must be a record),
    // closing the socket and forcing a reconnect loop.
    const payload: Record<string, unknown> = {
      runtime: this.config.runtime,
      tracing: this.isTracingEnabled,
      protocolVersion: REFLEX_DEVTOOLS_PROTOCOL_VERSION,
      inspectorApiVersion: this.inspector.apiVersion,
      ...(this.operationCapability() ? { operationApiVersion: 1 } : {}),
    };
    if (this.config.effectMode !== undefined) {
      payload.effectMode = this.config.effectMode;
    }
    if (this.config.effects !== undefined) {
      payload.effects = this.config.effects;
    }
    this.sendEvent({
      type: 'reflex-runtime-info',
      component: 'Reflex',
      payload,
    });
  }

  private stopTracing(notifyServer = true): void {
    if (this.isTracingEnabled) {
      this.isTracingEnabled = false;
      this.traceUnsubscribe?.();
      this.traceUnsubscribe = null;

      // No more trace callbacks are coming; answer outstanding dispatches
      // now instead of letting them time out.
      for (const pending of this.pendingDispatches) {
        clearTimeout(pending.timeout);
        if (notifyServer) {
          this.sendEvent({
            type: 'reflex-dispatch-result',
            payload: { dispatchId: pending.dispatchId, reason: 'tracing stopped before the outcome was observed' }
          });
        }
      }
      this.pendingDispatches = [];

      if (notifyServer) {
        this.sendRuntimeInfo();
      }
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.stopTracing(false);
    this.rejectConnection?.(new Error('Devtools client disposed during WebSocket connection'));
    this.rejectConnection = null;
    this.healthController?.abort();
    this.healthController = null;
    for (const controller of this.eventControllers) {
      controller.abort();
    }
    this.eventControllers.clear();

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.connectionStableTimer) {
      clearTimeout(this.connectionStableTimer);
      this.connectionStableTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const pending of this.pendingDispatches) {
      clearTimeout(pending.timeout);
    }
    this.pendingDispatches = [];
    this.subscriptionVersions.clear();
    this.serverAvailable = false;
    this.isConnected = false;
    this.runtimeSessionId = null;

    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    }
  }

  private serializeEventData(obj: any): string {
    try {
      return JSON.stringify(obj, reflexReplacer);
    } catch (error) {
      console.error('[Reflex Devtools] Error serializing object:', error);
      if (error instanceof Error && error.message.includes("Cannot perform 'get' on a proxy that has been revoked")) {
        console.warn('[Reflex Devtools] ⚠️ Important: When passing data from draftState to effects, always use the current() function to get the current (final) value. The draftState object is an Immer draft proxy that will be finalized after the event completes, so passing draftState data directly to effects will result in the empty proxy object.');
      }
      return JSON.stringify({ __reflex_type: 'SerializationError', error: 'Serialization failed' });
    }
  }

  async sendEvent(event: EventPayload): Promise<void> {
    if (this.isDisposed || !this.config.enabled || !this.serverAvailable) return;

    const eventWithTimestamp = {
      ...event,
      timestamp: event.timestamp || Date.now()
    };

    let redactedEvent: EventPayload;
    try {
      redactedEvent = redactDevtoolsEvent(
        eventWithTimestamp,
        this.redaction,
        'runtime',
      );
    } catch {
      console.error(
        `[Reflex Devtools] Redaction failed for event type ${event.type}; payload dropped.`,
      );
      return;
    }

    const serializedEvent = this.serializeEventData(redactedEvent);
    const serializedBytes = utf8ByteLength(serializedEvent);
    if (serializedBytes > this.maxRuntimePayloadBytes) {
      this.warnOnce(
        `payload-limit:${event.type}:${this.maxRuntimePayloadBytes}`,
        `[Reflex Devtools] Dropped ${safeEventType(event.type)} telemetry before transport: serialized size ${serializedBytes} bytes exceeds the negotiated ${this.maxRuntimePayloadBytes}-byte runtime limit. Reduce the inspected state/trace batch or raise maxRuntimePayloadBytes on the trusted devtools server.`,
      );
      return;
    }

    // Try WebSocket first
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(serializedEvent);
        return;
      } catch (error) {
      }
    }

    // Fallback to HTTP
    const controller = createAbortController();
    const timeout = controller
      ? setTimeout(() => controller.abort(), EVENT_REQUEST_TIMEOUT_MS)
      : null;
    if (controller) {
      this.eventControllers.add(controller);
    }
    const request: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.sessionToken}`,
        [REFLEX_DEVTOOLS_PROTOCOL_HEADER]:
          String(REFLEX_DEVTOOLS_PROTOCOL_VERSION),
        [REFLEX_DEVTOOLS_CLIENT_HEADER]: 'reflex-devtools-runtime',
        [REFLEX_DEVTOOLS_RUNTIME_ID_HEADER]: this.inspector.runtimeId,
        [REFLEX_DEVTOOLS_RUNTIME_SESSION_HEADER]:
          this.runtimeSessionId ?? '',
      },
      body: serializedEvent,
      redirect: 'error',
    };
    if (controller) {
      request.signal = controller.signal;
    }

    try {
      const response = await fetch(`${this.httpBaseUrl}/event`, request);
      const responseBody = await response.json().catch(() => null);
      const runtimeDrop = isRuntimeTelemetryDroppedPayload(
        responseBody?.notice ?? responseBody,
      )
        ? responseBody.notice ?? responseBody
        : null;
      const responseVersion = response.headers.get(
        REFLEX_DEVTOOLS_PROTOCOL_HEADER,
      );
      if (
        response.status === 401
        || response.status === 409
        || response.status === 426
        || responseVersion !== String(REFLEX_DEVTOOLS_PROTOCOL_VERSION)
      ) {
        this.serverAvailable = false;
        this.stopTracing(false);
        if (!this.hasConfiguredSessionToken) this.sessionToken = null;
        this.scheduleReconnect();
      } else if (runtimeDrop) {
        this.reportRuntimeTelemetryDrop(runtimeDrop);
      } else if (!response.ok) {
        console.warn(
          `[Reflex Devtools] Runtime event was rejected with HTTP ${response.status}.`,
        );
      }
    } catch (error) {
      if (controller?.signal.aborted || isAbortError(error) || this.isDisposed) {
        return;
      }
      console.warn('[Reflex Devtools] Server not available, disabling devtools');
      this.serverAvailable = false;
      this.stopTracing(false);
      this.scheduleReconnect();
    } finally {
      if (timeout) clearTimeout(timeout);
      if (controller) {
        this.eventControllers.delete(controller);
      }
    }
  }
}

const clientsByRuntimeId = new Map<string, DevtoolsClient>();
let warnedAboutAmbiguousLogEvent = false;

/**
 * Send a custom telemetry event through an enabled runtime client.
 *
 * The legacy one-argument form remains valid while exactly one client is
 * enabled. Multi-runtime callers must provide a runtime id so telemetry can
 * never cross an inspector boundary accidentally.
 */
export function logEvent(event: EventPayload, runtimeId?: string): void {
  if (runtimeId !== undefined) {
    const client = clientsByRuntimeId.get(runtimeId);
    if (client) void client.sendEvent(event);
    return;
  }

  if (clientsByRuntimeId.size > 1) {
    if (!warnedAboutAmbiguousLogEvent) {
      warnedAboutAmbiguousLogEvent = true;
      console.warn(
        '[Reflex Devtools] logEvent() requires runtimeId when multiple runtime clients are enabled; telemetry was not sent.',
      );
    }
    return;
  }

  const client = clientsByRuntimeId.values().next().value;
  if (client) void client.sendEvent(event);
}

function registerClient(runtimeId: string, client: DevtoolsClient): void {
  const previous = clientsByRuntimeId.get(runtimeId);
  previous?.dispose();
  clientsByRuntimeId.set(runtimeId, client);
}

function unregisterClient(runtimeId: string, client: DevtoolsClient): void {
  if (clientsByRuntimeId.get(runtimeId) === client) {
    clientsByRuntimeId.delete(runtimeId);
  }
  if (clientsByRuntimeId.size <= 1) warnedAboutAmbiguousLogEvent = false;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7F) bytes += 1;
    else if (codePoint <= 0x7FF) bytes += 2;
    else if (codePoint <= 0xFFFF) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function isRuntimeTelemetryDroppedPayload(
  value: unknown,
): value is RuntimeTelemetryDroppedPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<RuntimeTelemetryDroppedPayload>;
  return payload.code === REFLEX_DEVTOOLS_TELEMETRY_DROPPED_CODE
    && (
      payload.reason === 'redaction-failed'
      || payload.reason === 'retention-limit'
    )
    && typeof payload.eventType === 'string'
    && payload.eventType.length > 0
    && payload.eventType.length <= 128
    && !/[\u0000-\u001F\u007F]/.test(payload.eventType);
}

function safeEventType(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return 'runtime-event';
  }
  return JSON.stringify(
    value.replace(/[\u0000-\u001F\u007F]/g, '?').slice(0, 128),
  );
}

function sanitizeCloseReason(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001F\u007F]/g, '?')
    .slice(0, 256);
}

function createAbortController(): AbortController | null {
  return typeof AbortController === 'undefined' ? null : new AbortController();
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

function normalizeHttpBaseUrl(
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
      '[Reflex Devtools] serverUrl must be an http(s) URL without credentials, query, or fragment.',
    );
  }
  if (
    url.protocol === 'http:'
    && !isLoopbackHostname(url.hostname)
    && !allowInsecureRemote
  ) {
    throw new Error(
      '[Reflex Devtools] Refusing to send a runtime token over remote plaintext HTTP. ' +
      'Use HTTPS, a loopback SSH tunnel, or set allowInsecureRemote only on a trusted network.',
    );
  }
  return url.toString().replace(/\/+$/, '');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:127.')) return true;
  const octets = normalized.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.every((octet) =>
      /^\d{1,3}$/.test(octet)
      && Number(octet) >= 0
      && Number(octet) <= 255);
}

function assertRuntime(runtime: ReflexDevtoolsRuntime): void {
  const candidate = runtime as Partial<ReflexDevtoolsRuntime> | null | undefined;
  if (typeof candidate?.createInspector !== 'function') {
    throw new Error(
      '[Reflex Devtools] enableDevtools() requires a Reflex runtime as its first argument. ' +
      'Call enableDevtools(runtime, config).',
    );
  }
}

function assertInspector(inspector: ReflexInspector): void {
  const candidate = inspector as Partial<ReflexInspector> | null | undefined;
  const hasMethods =
    typeof candidate?.getSnapshot === 'function' &&
    typeof candidate.subscribeTraces === 'function' &&
    typeof candidate.dispatch === 'function' &&
    typeof candidate.evaluateSubscription === 'function';
  const hasIdentity =
    typeof candidate?.runtimeId === 'string' &&
    RUNTIME_ID_PATTERN.test(candidate.runtimeId) &&
    validRuntimeIdentityText(candidate?.runtimeName, MAX_RUNTIME_NAME_LENGTH);

  if (candidate?.apiVersion !== 2 || !hasMethods || !hasIdentity) {
    throw new Error(
      '[Reflex Devtools] runtime.createInspector() must return a compatible Reflex inspector.',
    );
  }
}

function validRuntimeIdentityText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001F\u007F]/.test(value);
}

export function enableDevtools(
  runtime: ReflexDevtoolsRuntime,
  config?: DevtoolsConfig,
): () => void;
export function enableDevtools(
  runtime: ReflexDevtoolsRuntime,
  config: DevtoolsConfig = {},
): () => void {
  assertRuntime(runtime);
  const inspector = runtime.createInspector();
  assertInspector(inspector);

  const operationInspector = config.operations && config.enabled !== false
    ? createOperationInspector(inspector)
    : inspector;
  const nextClient = new DevtoolsClient(operationInspector, config);
  registerClient(inspector.runtimeId, nextClient);
  void nextClient.init().catch((error: unknown) => {
    console.error('[Reflex Devtools] Failed to initialize:', error);
    nextClient.dispose();
    unregisterClient(inspector.runtimeId, nextClient);
  });

  let enabled = true;
  return () => {
    if (!enabled) return;
    enabled = false;
    nextClient.dispose();
    unregisterClient(inspector.runtimeId, nextClient);
  };
}
