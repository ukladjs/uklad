import { reflexReplacer } from '../serialization.js';
import { diffSubscriptionDiagnostics } from './subscriptionDiagnostics.js';
import type {
  ReflexInspector,
  ReflexInspectorSnapshot,
  ReflexTrace,
} from './types.js';

export type {
  ReflexHandlerKeys,
  ReflexInspector,
  ReflexInspectorSnapshot,
  ReflexSubscriptionDiagnostic,
  ReflexTrace,
  ReflexTraceCallback,
} from './types.js';

export interface DevtoolsConfig {
  serverUrl?: string;
  enabled?: boolean;
  /**
   * Which environment the app runs in. Auto-detected when omitted:
   * 'react-native' when navigator.product says so, 'headless' when there
   * is no `window` (Node under tsx/vite-node), 'browser' otherwise.
   * Surfaced through the server's /api/status.
   */
  runtime?: 'browser' | 'headless' | 'react-native';
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

// React Native must be checked before `window`: RN aliases the global object
// to `window`, so a window check alone would mislabel it as a browser.
// navigator.product === 'ReactNative' is RN's canonical self-identification;
// real browsers report 'Gecko' and Node's navigator has no product at all.
function detectRuntime(): 'browser' | 'headless' | 'react-native' {
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    return 'react-native';
  }
  return typeof window === 'undefined' ? 'headless' : 'browser';
}

interface PendingDispatch {
  dispatchId: number;
  eventId: string;
  timeout: ReturnType<typeof setTimeout>;
}

class DevtoolsClient {
  private inspector: ReflexInspector;
  private config: DevtoolsConfig;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isTracingEnabled = false;
  private serverAvailable = false;
  private isDisposed = false;
  private traceUnsubscribe: (() => void) | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private rejectConnection: ((error: unknown) => void) | null = null;
  private healthController: AbortController | null = null;
  private eventControllers = new Set<AbortController>();
  private subscriptionVersions = new Map<string, number>();
  private pendingDispatches: PendingDispatch[] = [];

  constructor(inspector: ReflexInspector, config: DevtoolsConfig) {
    this.inspector = inspector;
    this.config = {
      enabled: true,
      serverUrl: 'localhost:4000',
      runtime: detectRuntime(),
      ...config,
    };
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
      return;
    }

    try {
      await this.connectWebSocket();
    } catch (error) {
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
    this.healthController = controller;
    const request: RequestInit = { method: 'GET' };
    if (controller) {
      request.signal = controller.signal;
    }

    try {
      // Use a simple GET request to check if server is running
      const response = await fetch(`http://${this.config.serverUrl}/health`, request);
      return !this.isDisposed && response.ok;
    } catch (error) {
      return false;
    } finally {
      if (this.healthController === controller) {
        this.healthController = null;
      }
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isDisposed) {
        resolve();
        return;
      }

      const wsUrl = 'ws://' + this.config.serverUrl + '/sdk';
      const ws = new WebSocket(wsUrl);
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
        this.isConnected = true;
        resolveOnce();
      };

      ws.onmessage = (event) => {
        if (this.isDisposed) return;
        try {
          const message = JSON.parse(event.data);
          this.handleServerMessage(message);
        } catch (error) {
        }
      };

      ws.onerror = (error) => {
        rejectOnce(error);
      };

      ws.onclose = () => {
        this.isConnected = false;
        if (!settled) {
          rejectOnce(new Error('WebSocket closed before connecting'));
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

  private handleServerMessage(message: any): void {
    if (this.isDisposed) return;

    if (message.type === 'ui-connection-status') {
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
      this.inspector.dispatch([eventName, ...params]);
    } else if (message.type === 'eval-sub-to-client') {
      void this.evaluateSubscription(message.payload);
    }
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
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
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
      const index = this.pendingDispatches.findIndex(p => p.eventId === trace.operation);
      if (index === -1) continue;

      const pending = this.pendingDispatches.splice(index, 1)[0];
      if (!pending) continue;
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
      type: 'reflex-app-db',
      component: 'Reflex',
      payload: snapshot.appDb
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
    this.sendEvent({
      type: 'reflex-runtime-info',
      component: 'Reflex',
      payload: {
        runtime: this.config.runtime,
        effectMode: this.config.effectMode,
        effects: this.config.effects,
        tracing: this.isTracingEnabled
      }
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

    for (const pending of this.pendingDispatches) {
      clearTimeout(pending.timeout);
    }
    this.pendingDispatches = [];
    this.subscriptionVersions.clear();
    this.serverAvailable = false;
    this.isConnected = false;

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
        console.warn('[Reflex Devtools] ⚠️ Important: When passing data from draftDb to effects, always use the current() function to get the current (final) value. The draftDb object is an Immer draft proxy that will be finalized after the event completes, so passing draftDb data directly to effects will result in the empty proxy object.');
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

    const serializedEvent = this.serializeEventData(eventWithTimestamp);

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
    if (controller) {
      this.eventControllers.add(controller);
    }
    const request: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: serializedEvent,
    };
    if (controller) {
      request.signal = controller.signal;
    }

    try {
      await fetch(`http://${this.config.serverUrl}/event`, request);
    } catch (error) {
      if (controller?.signal.aborted || isAbortError(error) || this.isDisposed) {
        return;
      }
      console.warn('[Reflex Devtools] Server not available, disabling devtools');
      this.serverAvailable = false;
      this.stopTracing();
    } finally {
      if (controller) {
        this.eventControllers.delete(controller);
      }
    }
  }
}

let client: DevtoolsClient | null = null;

export function logEvent(event: EventPayload): void {
  if (client) {
    void client.sendEvent(event);
  }
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

function assertInspector(inspector: ReflexInspector): void {
  const candidate = inspector as Partial<ReflexInspector> | null | undefined;
  const hasMethods =
    typeof candidate?.getSnapshot === 'function' &&
    typeof candidate.subscribeTraces === 'function' &&
    typeof candidate.dispatch === 'function' &&
    typeof candidate.evaluateSubscription === 'function';

  if (candidate?.apiVersion !== 1 || !hasMethods) {
    throw new Error(
      '[Reflex Devtools] enableDevtools() requires a Reflex inspector as its first argument. ' +
      'Call enableDevtools(createReflexInspector(), config) using the inspector created by the same Reflex package as the application.',
    );
  }
}

export function enableDevtools(
  inspector: ReflexInspector,
  config: DevtoolsConfig = {},
): () => void {
  assertInspector(inspector);

  const nextClient = new DevtoolsClient(inspector, config);
  client?.dispose();
  client = nextClient;
  void nextClient.init().catch((error: unknown) => {
    console.error('[Reflex Devtools] Failed to initialize:', error);
    nextClient.dispose();
    if (client === nextClient) {
      client = null;
    }
  });

  let enabled = true;
  return () => {
    if (!enabled) return;
    enabled = false;
    nextClient.dispose();
    if (client === nextClient) {
      client = null;
    }
  };
}
