/**
 * In-memory storage for raw traces and app state
 */

import { applyPatches, enablePatches, enableMapSet } from 'immer';

// Enable Immer patches plugin for applyPatches functionality
enablePatches();
enableMapSet();

const DEFAULT_MAX_ACTIVE_SUBSCRIPTION_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STATE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TRACE_STORAGE_BYTES = 16 * 1024 * 1024;
const MAX_ESTIMATE_DEPTH = 100;

export type StorageRetentionKind = 'state' | 'active-subscriptions';

/** Expected capacity rejection, distinct from malformed data or server bugs. */
export class StorageRetentionError extends Error {
  readonly kind: StorageRetentionKind;

  constructor(kind: StorageRetentionKind) {
    super(
      kind === 'state'
        ? 'App state retention limit exceeded.'
        : 'Active subscription retention limit exceeded.',
    );
    this.name = 'StorageRetentionError';
    this.kind = kind;
  }
}

function estimateValueBytes(value: unknown, limit: number): number {
  let total = 0;
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const candidate = current.value;
    if (candidate === null || candidate === undefined) {
      total += 4;
    } else if (typeof candidate === 'string') {
      total += Buffer.byteLength(candidate, 'utf8');
    } else if (
      typeof candidate === 'number'
      || typeof candidate === 'bigint'
    ) {
      total += 16;
    } else if (typeof candidate === 'boolean') {
      total += 4;
    } else if (typeof candidate !== 'object') {
      total += 16;
    } else if (!seen.has(candidate)) {
      seen.add(candidate);
      if (current.depth >= MAX_ESTIMATE_DEPTH) {
        total += 32;
      } else if (Array.isArray(candidate)) {
        if (total + candidate.length * 4 > limit) return limit + 1;
        for (let index = 0; index < candidate.length; index += 1) {
          stack.push({
            value: candidate[index],
            depth: current.depth + 1,
          });
        }
      } else if (candidate instanceof Map) {
        if (total + candidate.size * 8 > limit) return limit + 1;
        for (const [key, item] of candidate) {
          stack.push({ value: key, depth: current.depth + 1 });
          stack.push({ value: item, depth: current.depth + 1 });
        }
      } else if (candidate instanceof Set) {
        if (total + candidate.size * 4 > limit) return limit + 1;
        for (const item of candidate) {
          stack.push({ value: item, depth: current.depth + 1 });
        }
      } else {
        for (const [key, item] of Object.entries(candidate)) {
          total += Buffer.byteLength(key, 'utf8');
          stack.push({ value: item, depth: current.depth + 1 });
        }
      }
    }

    if (total > limit) return total;
  }
  return total;
}

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
  protocolVersion?: number;
  inspectorApiVersion?: number;
}

export class TraceStorage {
  private traces: Trace[] = [];
  private traceSizes: number[] = [];
  private traceBytes = 0;
  private state: any = null;
  private activeSubs: Record<string, any> = Object.create(null);
  private activeSubSizes: Record<string, number> = Object.create(null);
  private activeSubBytes = 0;
  private handlerKeys: HandlerKeys | null = null;
  private runtimeInfo: RuntimeInfo | null = null;
  private readonly maxTraces: number;
  private readonly maxActiveSubscriptions: number;
  private readonly maxActiveSubscriptionBytes: number;
  private readonly maxStateBytes: number;
  private readonly maxTraceStorageBytes: number;

  constructor(
    maxTraces: number = 1000,
    maxActiveSubscriptions: number = 10_000,
    maxActiveSubscriptionBytes:
      number = DEFAULT_MAX_ACTIVE_SUBSCRIPTION_BYTES,
    maxStateBytes: number = DEFAULT_MAX_STATE_BYTES,
    maxTraceStorageBytes: number = DEFAULT_MAX_TRACE_STORAGE_BYTES,
  ) {
    this.maxTraces = maxTraces;
    this.maxActiveSubscriptions = maxActiveSubscriptions;
    this.maxActiveSubscriptionBytes = maxActiveSubscriptionBytes;
    this.maxStateBytes = maxStateBytes;
    this.maxTraceStorageBytes = maxTraceStorageBytes;
  }

  addTraces(traces: Trace[]): boolean {
    let stateRetentionRejected = false;

    // Avoid spreading attacker-controlled arrays into a function call; large
    // argument lists can throw before the configured retention bound applies.
    for (const trace of traces) {
      this.traces.push(trace);
      const traceSize = estimateValueBytes(
        trace,
        this.maxTraceStorageBytes + 1,
      );
      this.traceSizes.push(traceSize);
      this.traceBytes += traceSize;

      const patches = trace.tags?.patches;
      if (Array.isArray(patches) && patches.length > 0 && this.state !== null) {
        try {
          const nextState = applyPatches(this.state, patches);
          if (
            estimateValueBytes(nextState, this.maxStateBytes + 1)
            > this.maxStateBytes
          ) {
            throw new StorageRetentionError('state');
          }
          this.state = nextState;
        } catch (error) {
          if (error instanceof StorageRetentionError) {
            stateRetentionRejected = true;
          } else {
            console.warn('[Reflex Devtools] Failed to apply trace patches to app state.');
          }
        }
      }
    }

    let removeCount = Math.max(0, this.traces.length - this.maxTraces);
    let removedBytes = 0;
    for (let index = 0; index < removeCount; index += 1) {
      removedBytes += this.traceSizes[index] ?? 0;
    }
    while (
      removeCount < this.traces.length
      && this.traceBytes - removedBytes > this.maxTraceStorageBytes
    ) {
      removedBytes += this.traceSizes[removeCount] ?? 0;
      removeCount += 1;
    }
    if (removeCount > 0) {
      this.traces.splice(0, removeCount);
      this.traceSizes.splice(0, removeCount);
      this.traceBytes -= removedBytes;
    }

    return stateRetentionRejected;
  }

  updateState(state: any): void {
    if (
      estimateValueBytes(state, this.maxStateBytes + 1)
      > this.maxStateBytes
    ) {
      throw new StorageRetentionError('state');
    }
    this.state = state;
  }

  updateActiveSubs(subs: Record<string, any>): void {
    let projectedSize = Object.keys(this.activeSubs).length;
    let projectedBytes = this.activeSubBytes;
    const nextSizes = new Map<string, number>();
    for (const [key, value] of Object.entries(subs)) {
      const exists = Object.prototype.hasOwnProperty.call(this.activeSubs, key);
      const previousSize = this.activeSubSizes[key] ?? 0;
      if (value === 'reflex-tool-sub-disposed') {
        if (exists) {
          projectedSize -= 1;
          projectedBytes -= previousSize;
        }
      } else if (!exists) {
        projectedSize += 1;
        const nextSize = estimateValueBytes(
          value,
          this.maxActiveSubscriptionBytes + 1,
        );
        nextSizes.set(key, nextSize);
        projectedBytes += nextSize;
      } else {
        const nextSize = estimateValueBytes(
          value,
          this.maxActiveSubscriptionBytes + 1,
        );
        nextSizes.set(key, nextSize);
        projectedBytes += nextSize - previousSize;
      }
    }
    if (
      projectedSize > this.maxActiveSubscriptions
      || projectedBytes > this.maxActiveSubscriptionBytes
    ) {
      throw new StorageRetentionError('active-subscriptions');
    }

    for (const [key, value] of Object.entries(subs)) {
      if (value === 'reflex-tool-sub-disposed') {
        delete this.activeSubs[key];
        delete this.activeSubSizes[key];
      } else {
        this.activeSubs[key] = value;
        this.activeSubSizes[key] = nextSizes.get(key) ?? 0;
      }
    }
    this.activeSubBytes = projectedBytes;
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

  getState(): any {
    return this.state;
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
    this.traceSizes = [];
    this.traceBytes = 0;
    this.state = null;
    this.activeSubs = Object.create(null);
    this.activeSubSizes = Object.create(null);
    this.activeSubBytes = 0;
    this.handlerKeys = null;
    this.runtimeInfo = null;
  }
}
