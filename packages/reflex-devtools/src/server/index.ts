import express, { type Request, type Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { TraceStorage } from './storage.js';
import { reflexReviver, mapSetReflexReplacer } from '../serialization.js';

export interface ServerConfig {
  port: number;
  host?: string;
  maxTraces?: number;
  enableMCP?: boolean;
}

// How long /api/dispatch waits for the SDK to report the event's trace before
// answering with outcome 'unknown'. Traces are debounced 50ms client-side, so
// a healthy round trip is well under a second.
const DISPATCH_OUTCOME_TIMEOUT_MS = 5000;
const SUB_EVAL_TIMEOUT_MS = 5000;

export class DevtoolsServer {
  private app: express.Application;
  private server: any;
  private wss: WebSocketServer;
  private config: ServerConfig;
  private uiClients: Set<WebSocket> = new Set();
  private sdkClients: Set<WebSocket> = new Set();
  private storage: TraceStorage | null = null;
  private uiPath: string;
  private pendingDispatches: Map<number, { res: Response; timeout: NodeJS.Timeout }> = new Map();
  private nextDispatchId = 1;
  private pendingSubEvals: Map<number, { res: Response; timeout: NodeJS.Timeout }> = new Map();
  private nextSubEvalId = 1;
  // Bumped every time an SDK client connects (which also clears storage):
  // any change tells an agent "the app restarted — trace ids reset, seeded
  // state is gone". 0 means no app has connected since the server started.
  private sessionEpoch = 0;

  constructor(config: ServerConfig) {
    this.config = {
      host: 'localhost',
      maxTraces: 1000,
      enableMCP: false,
      ...config
    };

    // Initialize storage only if MCP is enabled
    if (this.config.enableMCP) {
      this.storage = new TraceStorage(this.config.maxTraces!);
      console.log('[Reflex Devtools] MCP enabled - trace storage active');
    }

    // Get the directory of the current module and resolve UI path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.uiPath = path.join(__dirname, '../ui');

    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(cors());

    // Capture raw body before express.json parses it
    this.app.use(express.json({
      limit: '50mb',
      verify: (req: any, _res, buf) => {
        (req as any).rawBody = buf;
      }
    }));

    this.app.use(express.static(this.uiPath));
  }

  private setupRoutes(): void {
    // HTTP fallback endpoint for receiving events from client SDK
    this.app.post('/event', (req: Request, res: Response) => {
      const rawBodyStr = (req as any).rawBody.toString();

      if (this.processRawEventMessage(rawBodyStr)) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: 'Invalid event format' });
      }
    });

    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        connectedClients: this.uiClients.size,
        timestamp: Date.now()
      });
    });

    // MCP API: App/session status — the cheap health check agents call first.
    // Deliberately not gated on --mcp: when the server is misconfigured this
    // response is the diagnosis, not a 503. Runtime/handler details come from
    // storage (SDK-fed), so without --mcp they are simply null.
    this.app.get('/api/status', (_req: Request, res: Response) => {
      const connectedApps = [...this.sdkClients]
        .filter(client => client.readyState === WebSocket.OPEN).length;
      const runtimeInfo = this.storage?.getRuntimeInfo() ?? null;
      const handlerKeys = this.storage?.getHandlerKeys() ?? null;

      res.json({
        success: true,
        mcpEnabled: !!this.config.enableMCP,
        appConnected: connectedApps > 0,
        connectedApps,
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
              sub: handlerKeys.sub.length
            }
          : null,
        stateAvailable: this.storage ? this.storage.getAppState() !== null : false,
        traceCount: this.storage ? this.storage.getStats().totalTraces : 0
      });
    });

    // MCP API: Get traces
    this.app.get('/api/traces', (req: Request, res: Response) => {
      if (!this.storage) {
        res.status(503).json({ 
          success: false, 
          error: 'MCP not enabled. Start server with --mcp flag to enable trace storage.' 
        });
        return;
      }

      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const eventFilter = req.query.eventFilter as string | undefined;
        const minDuration = req.query.minDuration ? parseFloat(req.query.minDuration as string) : undefined;
        const opType = req.query.opType as string | undefined;

        const traces = this.storage.getTraces({
          limit,
          eventFilter,
          minDuration,
          opType
        });

        res.type('application/json').send(JSON.stringify({ success: true, traces }, mapSetReflexReplacer));
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // MCP API: Get app state
    this.app.get('/api/state', (_req: Request, res: Response) => {
      if (!this.storage) {
        res.status(503).json({ 
          success: false, 
          error: 'MCP not enabled. Start server with --mcp flag to enable trace storage.' 
        });
        return;
      }

      try {
        const state = this.storage.getAppState();
        res.type('application/json').send(JSON.stringify({ success: true, state }, mapSetReflexReplacer));
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // MCP API: Get active subscriptions
    this.app.get('/api/subscriptions', (_req: Request, res: Response) => {
      if (!this.storage) {
        res.status(503).json({ 
          success: false, 
          error: 'MCP not enabled. Start server with --mcp flag to enable trace storage.' 
        });
        return;
      }

      try {
        const subs = this.storage.getActiveSubs();
        res.type('application/json').send(JSON.stringify({ success: true, subscriptions: subs }, mapSetReflexReplacer));
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // MCP API: Get handlers
    this.app.get('/api/handlers', (_req: Request, res: Response) => {
      if (!this.storage) {
        res.status(503).json({ 
          success: false, 
          error: 'MCP not enabled. Start server with --mcp flag to enable trace storage.' 
        });
        return;
      }

      try {
        const handlerKeys = this.storage.getHandlerKeys();

        res.json({
          success: true,
          handlerKeys
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // MCP API: Get storage stats
    this.app.get('/api/stats', (_req: Request, res: Response) => {
      if (!this.storage) {
        res.status(503).json({ 
          success: false, 
          error: 'MCP not enabled. Start server with --mcp flag to enable trace storage.' 
        });
        return;
      }

      try {
        const stats = this.storage.getStats();
        res.json({ success: true, stats });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // MCP API: Get a single trace with full detail
    this.app.get('/api/traces/:id', (req: Request, res: Response) => {
      if (!this.storage) {
        res.status(503).json({
          success: false,
          error: 'MCP not enabled. Start server with --mcp flag to enable trace storage.'
        });
        return;
      }

      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
          res.status(400).json({ success: false, error: 'Trace id must be a number' });
          return;
        }

        const trace = this.storage.getTrace(id);
        if (!trace) {
          res.status(404).json({ success: false, error: `No trace with id ${id}` });
          return;
        }

        res.type('application/json').send(JSON.stringify({ success: true, trace }, mapSetReflexReplacer));
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // MCP API: Dispatch event to client and report the observed outcome.
    // The response is held until the SDK sends back the event's trace
    // (reflex-dispatch-result), so a typo'd id or a throwing handler comes
    // back as a failure instead of a blind "dispatched".
    this.app.post('/api/dispatch', (req: Request, res: Response) => {
      try {
        if (!this.config.enableMCP) {
          res.status(503).json({
            success: false,
            error: 'MCP dispatch is disabled. Start reflex-devtools with --mcp to enable /api/dispatch.'
          });
          return;
        }

        const { eventName, params } = req.body;

        if (typeof eventName !== 'string' || eventName.trim() === '') {
          res.status(400).json({ success: false, error: 'eventName is required' });
          return;
        }

        if (params != null && !Array.isArray(params)) {
          res.status(400).json({ success: false, error: 'params must be an array' });
          return;
        }

        const eventParams = params ?? [];
        const dispatchId = this.nextDispatchId++;

        // Sent count, not sdkClients.size: the set can hold stale sockets
        // that broadcastToSDK skips. The client's reply can't arrive before
        // this handler returns, so registering the pending entry after the
        // broadcast is race-free.
        const sent = this.broadcastToSDK({
          type: 'dispatch-to-client',
          payload: { dispatchId, eventName, params: eventParams },
          timestamp: Date.now()
        });

        if (sent === 0) {
          res.status(503).json({
            success: false,
            error: 'No app connected to the devtools server; the event was not dispatched'
          });
          return;
        }

        const timeout = setTimeout(() => {
          this.pendingDispatches.delete(dispatchId);
          res.json({
            success: true,
            outcome: 'unknown',
            message: `Event dispatched, but the app reported no trace for it within ${DISPATCH_OUTCOME_TIMEOUT_MS}ms`
          });
        }, DISPATCH_OUTCOME_TIMEOUT_MS);
        this.pendingDispatches.set(dispatchId, { res, timeout });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // MCP API: Evaluate any registered subscription, including one that no
    // mounted component currently uses. The SDK computes it against the live
    // app runtime and sends the value back over the same request/result bridge
    // used by dispatch outcomes.
    this.app.post('/api/eval-sub', (req: Request, res: Response) => {
      try {
        if (!this.config.enableMCP) {
          res.status(503).json({
            success: false,
            error: 'MCP subscription evaluation is disabled. Start reflex-devtools with --mcp to enable /api/eval-sub.'
          });
          return;
        }

        const { id, args } = req.body;
        if (typeof id !== 'string' || id.trim() === '') {
          res.status(400).json({ success: false, error: 'id is required' });
          return;
        }
        if (args != null && !Array.isArray(args)) {
          res.status(400).json({ success: false, error: 'args must be an array' });
          return;
        }

        const subArgs = args ?? [];
        const evalId = this.nextSubEvalId++;
        const sent = this.broadcastToSDK({
          type: 'eval-sub-to-client',
          payload: { evalId, id, args: subArgs },
          timestamp: Date.now()
        });

        if (sent === 0) {
          res.status(503).json({
            success: false,
            error: 'No app connected to the devtools server; the subscription was not evaluated'
          });
          return;
        }

        const timeout = setTimeout(() => {
          this.pendingSubEvals.delete(evalId);
          res.status(504).json({
            success: false,
            error: `Subscription evaluation timed out after ${SUB_EVAL_TIMEOUT_MS}ms`
          });
        }, SUB_EVAL_TIMEOUT_MS);
        this.pendingSubEvals.set(evalId, { res, timeout });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Serve UI dashboard for all other routes
    // (express 5 / path-to-regexp v8 syntax: '{*splat}' is the catch-all)
    this.app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(this.uiPath, 'index.html'));
    });
  }

  private processRawEventMessage(rawMessage: string): boolean {
    try {
      // Dispatch results resolve a pending /api/dispatch response; they are
      // neither stored nor forwarded to UI clients. The substring gate keeps
      // the UI-relay path parse-free when nothing is pending.
      if (this.pendingDispatches.size > 0 && rawMessage.includes('reflex-dispatch-result')) {
        const event = JSON.parse(rawMessage, reflexReviver);
        if (event.type === 'reflex-dispatch-result') {
          this.resolveDispatch(event.payload);
          return true;
        }
      }

      if (this.pendingSubEvals.size > 0 && rawMessage.includes('reflex-eval-sub-result')) {
        const event = JSON.parse(rawMessage, reflexReviver);
        if (event.type === 'reflex-eval-sub-result') {
          this.resolveSubEval(event.payload);
          return true;
        }
      }

      // Process and store the event
      this.processEvent(rawMessage);

      // Forward the original JSON string to UI clients (preserve serialization)
      this.broadcastRawToUI(rawMessage);

      return true;
    } catch (error) {
      console.error('[Reflex Devtools] Error parsing event:', error);
      return false;
    }
  }

  // Answer a held /api/dispatch response with the outcome derived from the
  // event's trace tags: `error` means the event never committed,
  // `effectErrors` means it committed but effects failed. reversePatches are
  // deliberately dropped — outcome consumers never time-travel.
  private resolveDispatch(payload: any): void {
    const pending = this.pendingDispatches.get(payload?.dispatchId);
    if (!pending) return; // already timed out

    clearTimeout(pending.timeout);
    this.pendingDispatches.delete(payload.dispatchId);

    let body: Record<string, any>;
    if (payload.trace) {
      const tags = payload.trace.tags || {};
      const outcome = tags.error ? 'failed'
        : (tags.effectErrors?.length ? 'effects-failed' : 'succeeded');
      body = {
        success: true,
        outcome,
        traceId: payload.trace.id,
        event: tags.event,
        duration: payload.trace.duration,
        error: tags.error,
        effectErrors: tags.effectErrors,
        patches: tags.patches,
        effects: tags.effects
      };
    } else {
      body = {
        success: true,
        outcome: 'unknown',
        message: payload.reason || 'The app reported no trace for this dispatch'
      };
    }

    pending.res.type('application/json').send(JSON.stringify(body, mapSetReflexReplacer));
  }

  private failPendingDispatches(reason: string): void {
    for (const [dispatchId, pending] of this.pendingDispatches) {
      clearTimeout(pending.timeout);
      this.pendingDispatches.delete(dispatchId);
      pending.res.json({ success: true, outcome: 'unknown', message: reason });
    }
  }

  private resolveSubEval(payload: any): void {
    const pending = this.pendingSubEvals.get(payload?.evalId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingSubEvals.delete(payload.evalId);

    if (payload.error) {
      pending.res.status(payload.error.phase === 'missing-handler' ? 404 : 422).json({
        success: false,
        error: payload.error
      });
      return;
    }

    pending.res.type('application/json').send(JSON.stringify({
      success: true,
      value: payload.value
    }, mapSetReflexReplacer));
  }

  private failPendingSubEvals(reason: string): void {
    for (const [evalId, pending] of this.pendingSubEvals) {
      clearTimeout(pending.timeout);
      this.pendingSubEvals.delete(evalId);
      pending.res.status(503).json({ success: false, error: reason });
    }
  }

  private processEvent(rawMessage: string): void {
    // Store events in the trace storage (only if MCP is enabled)
    if (!this.storage) return;

    try {
      const event = JSON.parse(rawMessage, reflexReviver);
      switch (event.type) {
        case 'reflex-traces':
          if (event.payload && Array.isArray(event.payload)) {
            this.storage.addTraces(event.payload);
          }
          break;

        case 'reflex-app-db':
          if (event.payload) {
            this.storage.updateAppState(event.payload);
          }
          break;

        case 'reflex-active-subs':
          if (event.payload) {
            this.storage.updateActiveSubs(event.payload);
          }
          break;

        case 'reflex-handler-keys':
          if (event.payload) {
            this.storage.updateHandlerKeys(event.payload);
          }
          break;

        case 'reflex-runtime-info':
          if (event.payload) {
            this.storage.updateRuntimeInfo(event.payload);
          }
          break;
      }
    } catch (error) {
      console.error('[Reflex Devtools] Error processing event:', error);
    }
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws, req) => {
      const url = req.url;
      
      if (url === '/sdk') {
        // Connection from client SDK
        console.log('[Reflex Devtools] SDK client connected');

        // Every SDK connection is a new app session: bump the epoch so agents
        // can detect the restart from any subsequent /api/status call.
        this.sessionEpoch++;

        // Clear storage on client reconnect (new session)
        if (this.storage) {
          this.storage.clear();
          console.log('[Reflex Devtools] Storage cleared - new client session');
        }

        // Dispatches still awaiting an outcome were sent to the previous
        // session; this session will never answer them. Fail them now rather
        // than let them ride the 5s timeout — or worse, let a late result
        // from the dying session (its client falls back to HTTP once the
        // socket dies) report success about a world that was just reset.
        this.failPendingDispatches('App session restarted before the dispatch outcome was observed');
        this.failPendingSubEvals('App session restarted before the subscription evaluation completed');

        // Single-app session model: storage mirrors exactly one app and every
        // dispatch is broadcast, so a lingering older connection would double-
        // execute events (a forgotten browser tab, or a headless watcher
        // re-running the entry in the same process). The newest connection
        // supersedes all previous ones. Add the new socket first so the stale
        // sockets' close handlers never see an empty set and fail dispatches.
        const staleSdkClients = [...this.sdkClients];
        this.sdkClients.add(ws);
        for (const stale of staleSdkClients) {
          console.log('[Reflex Devtools] Terminating previous SDK client (superseded by new session)');
          this.sdkClients.delete(stale);
          stale.terminate();
        }

        // Send current tracing demand to the newly connected SDK client.
        const connectedUIs = this.getTracingDemandCount();
        ws.send(JSON.stringify({
          type: 'ui-connection-status',
          payload: { connectedUIs },
          timestamp: Date.now()
        }));
        
        ws.on('message', (data) => {
          const rawMessage = data.toString();
          this.processRawEventMessage(rawMessage);
        });

        ws.on('close', () => {
          console.log('[Reflex Devtools] SDK client disconnected');
          this.sdkClients.delete(ws);
          if (this.sdkClients.size === 0) {
            this.failPendingDispatches('App disconnected before reporting the dispatch outcome');
            this.failPendingSubEvals('App disconnected before reporting the subscription value');
          }
        });

        ws.on('error', (error) => {
          console.error('[Reflex Devtools] SDK WebSocket error:', error);
          this.sdkClients.delete(ws);
          if (this.sdkClients.size === 0) {
            this.failPendingDispatches('App disconnected before reporting the dispatch outcome');
            this.failPendingSubEvals('App disconnected before reporting the subscription value');
          }
        });

      } else if (url === '/ui') {
        // Connection from UI dashboard
        console.log('[Reflex Devtools] UI client connected');
        this.uiClients.add(ws);
        
        // Notify all SDK clients about UI connection change
        this.notifySDKClientsUIStatus();
        
        // Send welcome message
        ws.send(JSON.stringify({
          type: 'devtools-connected',
          payload: { message: 'Connected to Reflex Devtools' },
          timestamp: Date.now()
        }));

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            // Handle messages from UI (e.g., dispatch-to-client)
            if (message.type === 'dispatch-to-client') {
              // Forward the dispatch request to all SDK clients
              this.broadcastToSDK(message);
            }
          } catch (error) {
            console.error('[Reflex Devtools] Error parsing UI message:', error);
          }
        });

        ws.on('close', () => {
          console.log('[Reflex Devtools] UI client disconnected');
          this.uiClients.delete(ws);
          
          // Notify all SDK clients about UI connection change
          this.notifySDKClientsUIStatus();
        });

        ws.on('error', (error) => {
          console.error('[Reflex Devtools] UI WebSocket error:', error);
          this.uiClients.delete(ws);
          
          // Notify all SDK clients about UI connection change
          this.notifySDKClientsUIStatus();
        });
      }
    });
  }

  /**
   * The SDK treats `connectedUIs` as an on/off tracing-demand signal.
   * MCP remains a consumer even when no browser dashboard is connected.
   */
  private getTracingDemandCount(): number {
    return this.config.enableMCP ? 1 : this.uiClients.size;
  }

  private notifySDKClientsUIStatus(): void {
    const message = JSON.stringify({
      type: 'ui-connection-status',
      payload: { connectedUIs: this.getTracingDemandCount() },
      timestamp: Date.now()
    });
    
    this.sdkClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('[Reflex Devtools] Error sending UI status to SDK client:', error);
          this.sdkClients.delete(client);
        }
      } else {
        this.sdkClients.delete(client);
      }
    });
  }

  private broadcastRawToUI(rawMessage: string): void {
    this.uiClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(rawMessage);
        } catch (error) {
          console.error('[Reflex Devtools] Error sending raw message to UI client:', error);
          this.uiClients.delete(client);
        }
      } else {
        this.uiClients.delete(client);
      }
    });
  }

  // Returns the number of SDK clients the message was actually sent to, so
  // callers can tell "dispatched" apart from "broadcast into the void".
  private broadcastToSDK(message: any): number {
    const messageStr = JSON.stringify(message);
    let sent = 0;

    this.sdkClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          sent++;
        } catch (error) {
          console.error('[Reflex Devtools] Error sending to SDK client:', error);
          this.sdkClients.delete(client);
        }
      } else {
        this.sdkClients.delete(client);
      }
    });

    return sent;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`[Reflex Devtools] Dashboard: http://${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all active WebSocket connections
      this.uiClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
          client.terminate();
        }
      });
      this.uiClients.clear();

      this.sdkClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
          client.terminate();
        }
      });
      this.sdkClients.clear();

      // Close WebSocket server
      this.wss.close(() => {
        // Close HTTP server
        this.server.close(() => {
          console.log('[Reflex Devtools] Server stopped');
          resolve();
        });
      });
    });
  }
}
