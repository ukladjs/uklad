/**
 * In-memory storage for raw traces and app state
 */

import { applyPatches, enablePatches, enableMapSet } from 'immer';

// Enable Immer patches plugin for applyPatches functionality
enablePatches();
enableMapSet();

export interface Trace {
  id: number;
  start: number;
  end?: number;
  duration?: number;
  operation?: string;
  opType?: string;
  tags?: Record<string, any>;
  childOf?: number;
}

export interface HandlerKeys {
  event: string[];
  fx: string[];
  cofx: string[];
  sub: string[];
}

// Self-description sent by the SDK: how the app runs (browser tab vs
// headless process), its side-effect adapter modes, and whether tracing
// is currently enabled. Cleared with the rest of the session on reconnect.
export interface RuntimeInfo {
  runtime?: 'browser' | 'headless' | 'react-native';
  effectMode?: string;
  effects?: Record<string, string>;
  tracing?: boolean;
}

export class TraceStorage {
  private traces: Trace[] = [];
  private appState: any = null;
  private activeSubs: Record<string, any> = {};
  private handlerKeys: HandlerKeys | null = null;
  private runtimeInfo: RuntimeInfo | null = null;
  private readonly maxTraces: number;

  constructor(maxTraces: number = 1000) {
    this.maxTraces = maxTraces;
  }

  addTraces(traces: Trace[]): void {
    // Store raw traces without processing
    this.traces.push(...traces);

    // Apply patches from traces to the app state
    const allPatches = traces
      .filter(trace => trace.tags?.patches?.length > 0)
      .flatMap(trace => trace.tags!.patches!);

    // Apply patches to the app state if we have patches and state
    if (allPatches.length > 0 && this.appState) {
      try {
        this.appState = applyPatches(this.appState, allPatches);
      } catch (error) {
        console.warn('[Reflex Devtools] Failed to apply patches to app state:', error);
        // Continue without applying patches - traces are still stored
      }
    }

    // Limit stored traces
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-this.maxTraces);
    }
  }

  updateAppState(state: any): void {
    this.appState = state;
  }

  updateActiveSubs(subs: Record<string, any>): void {
    for (const [key, value] of Object.entries(subs)) {
      if (value === "reflex-tool-sub-disposed") {
        delete this.activeSubs[key];
      } else {
        this.activeSubs[key] = value;
      }
    }
  }

  updateHandlerKeys(keys: HandlerKeys): void {
    this.handlerKeys = keys;
  }

  updateRuntimeInfo(info: RuntimeInfo): void {
    this.runtimeInfo = info;
  }

  getTraces(options: {
    limit?: number;
    eventFilter?: string;
    minDuration?: number;
    opType?: string;
  } = {}): Trace[] {
    let filtered = [...this.traces];

    // Filter by event name
    if (options.eventFilter) {
      const filter = options.eventFilter.toLowerCase();
      filtered = filtered.filter(trace =>
        trace.operation?.toLowerCase().includes(filter)
      );
    }

    // Filter by operation type
    if (options.opType) {
      filtered = filtered.filter(trace => trace.opType === options.opType);
    }

    // Filter by minimum duration
    if (options.minDuration !== undefined) {
      filtered = filtered.filter(trace =>
        trace.duration !== undefined && trace.duration >= options.minDuration!
      );
    }

    // Apply limit
    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  getTrace(id: number): Trace | undefined {
    return this.traces.find(trace => trace.id === id);
  }

  getAppState(): any {
    return this.appState;
  }

  getActiveSubs(): Record<string, any> {
    return this.activeSubs;
  }

  getHandlerKeys(): HandlerKeys | null {
    return this.handlerKeys;
  }

  getRuntimeInfo(): RuntimeInfo | null {
    return this.runtimeInfo;
  }

  getStats(): {
    totalTraces: number;
    eventTraces: number;
    renderTraces: number;
  } {
    const eventTraces = this.traces.filter(t => t.opType === 'event').length;
    const renderTraces = this.traces.filter(t => t.opType === 'render').length;

    return {
      totalTraces: this.traces.length,
      eventTraces,
      renderTraces
    };
  }
  
  clear(): void {
    this.traces = [];
    this.appState = null;
    this.activeSubs = {};
    this.handlerKeys = null;
    this.runtimeInfo = null;
  }
}

