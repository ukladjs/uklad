import { registerTraceCb, getAppDb, getSubscriptionDiagnostics, dispatch, getHandlers, getSubscriptionValue, removeTraceCb } from "@flexsurfer/reflex";
import { reflexReplacer } from "../serialization.js";
import { diffSubscriptionDiagnostics } from "./subscriptionDiagnostics.js";

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
  private config: DevtoolsConfig;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isTracingEnabled = false;
  private serverAvailable = false;
  private subscriptionVersions = new Map<string, number>();
  private pendingDispatches: PendingDispatch[] = [];

  constructor(config: DevtoolsConfig) {
    this.config = {
      enabled: true,
      serverUrl: 'localhost:4000',
      runtime: detectRuntime(),
      ...config,
    };
  }

  async init(): Promise<void> {

    if (!this.config.enabled) return;

    // Browsers and React Native always have WebSocket; Node only from v22
    // (v21 experimentally). Without this guard the constructor throw would be
    // swallowed and the SDK would limp along on the HTTP fallback — traces
    // flowing but dispatch impossible — which is far harder to diagnose than
    // an explicit refusal.
    if (typeof WebSocket === 'undefined') {
      console.warn('[Reflex Devtools] No global WebSocket in this runtime — headless mode requires Node >= 22. Devtools disabled.');
      return;
    }

    this.startTracing();

    this.serverAvailable = await this.checkServerAvailability();
    if (!this.serverAvailable) {
      console.warn('[Reflex Devtools] Server not available, disabling devtools');
      this.stopTracing();
      return;
    }

    try {
      await this.connectWebSocket();
    } catch (error) {
    }
  }

  private mapSubscriptionDiagnostics(resetCache = false): Record<string, any> {
    return diffSubscriptionDiagnostics(
      getSubscriptionDiagnostics(),
      this.subscriptionVersions,
      resetCache,
    );
  }

  private getHandlerKeys(kindToIdToHandler: Record<string, Record<string, any>>): Record<string, string[]> {
    return {
      event: Object.keys(kindToIdToHandler.event || {}),
      fx: Object.keys(kindToIdToHandler.fx || {}).filter(key => !['dispatch', 'dispatch-later'].includes(key)),
      cofx: Object.keys(kindToIdToHandler.cofx || {}).filter(key => !['now', 'random'].includes(key)),
      sub: Object.keys(kindToIdToHandler.sub || {})
    };
  }

  private async checkServerAvailability(): Promise<boolean> {
    try {
      // Use a simple GET request to check if server is running
      const response = await fetch(`http://${this.config.serverUrl}/health`, {
        method: 'GET'
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = 'ws://' + this.config.serverUrl + '/sdk';
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleServerMessage(message);
        } catch (error) {
        }
      };

      this.ws.onerror = (error) => {
        reject(error);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
      };

      // Set a timeout for connection
      setTimeout(() => {
        if (!this.isConnected) {
          this.ws?.close();
          reject(new Error('WebSocket connection timeout'));
        }
      }, 5000);
    });
  }

  private handleServerMessage(message: any): void {
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
      const { dispatchId, eventName, params } = message.payload;

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
      dispatch([eventName, ...params]);
    } else if (message.type === 'eval-sub-to-client') {
      void this.evaluateSubscription(message.payload);
    }
  }

  private async evaluateSubscription(payload: any): Promise<void> {
    const { evalId, id, args } = payload;

    try {
      if (!getHandlers().sub?.[id]) {
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

      const value = getSubscriptionValue([id, ...args]);
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
  private async reportDispatchResults(traces: any[]): Promise<void> {
    if (this.pendingDispatches.length === 0) return;

    for (const trace of traces) {
      if (trace.opType !== 'event') continue;
      const index = this.pendingDispatches.findIndex(p => p.eventId === trace.operation);
      if (index === -1) continue;

      const [pending] = this.pendingDispatches.splice(index, 1);
      clearTimeout(pending.timeout);
      await this.sendEvent({
        type: 'reflex-dispatch-result',
        payload: { dispatchId: pending.dispatchId, trace }
      });
    }
  }

  private startTracing(): void {
    if (!this.isTracingEnabled) {

      this.isTracingEnabled = true;

      registerTraceCb('reflex-devtool', async (traces) => {
        // Awaited so the server has stored the traces before a dispatch
        // outcome referencing a trace id resolves — ws.send preserves order
        // by itself, but the HTTP fallback does not. sendEvent never rejects.
        await this.sendEvent({
          type: 'reflex-traces',
          component: 'Reflex',
          payload: traces
        });
        await this.sendEvent({
          type: 'reflex-active-subs',
          component: 'Reflex',
          payload: this.mapSubscriptionDiagnostics()
        });
        await this.reportDispatchResults(traces);
      });
    }

    this.sendEvent({
      type: 'reflex-app-db',
      component: 'Reflex',
      payload: getAppDb()
    });
    this.sendEvent({
      type: 'reflex-active-subs',
      component: 'Reflex',
      payload: this.mapSubscriptionDiagnostics(true)
    });
    this.sendEvent({
      type: 'reflex-handler-keys',
      component: 'Reflex',
      payload: this.getHandlerKeys(getHandlers())
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

  private stopTracing(): void {
    if (this.isTracingEnabled) {
      this.isTracingEnabled = false;
      removeTraceCb('reflex-devtool');

      // No more trace callbacks are coming; answer outstanding dispatches
      // now instead of letting them time out.
      for (const pending of this.pendingDispatches) {
        clearTimeout(pending.timeout);
        this.sendEvent({
          type: 'reflex-dispatch-result',
          payload: { dispatchId: pending.dispatchId, reason: 'tracing stopped before the outcome was observed' }
        });
      }
      this.pendingDispatches = [];

      this.sendRuntimeInfo();
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
    if (!this.config.enabled || !this.serverAvailable) return;

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
    try {
      await fetch(`http://${this.config.serverUrl}/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: serializedEvent,
      });
    } catch (error) {
      console.warn('[Reflex Devtools] Server not available, disabling devtools');
      this.serverAvailable = false;
      this.stopTracing();
    }
  }
}

let client: DevtoolsClient | null = null;

export function logEvent(event: EventPayload): void {
  if (client) {
    client.sendEvent(event);
  } else {
  }
}

export function enableDevtools(config: DevtoolsConfig = {}): void {
  client = new DevtoolsClient(config);
  client.init();
}
