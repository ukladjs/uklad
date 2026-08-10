import type { EventVector, InterceptorDirection } from '../types';

export type TraceId = number;
export type TraceTags = Record<string, unknown>;

export interface TraceOptions {
  operation?: string;
  opType?: string;
  tags?: TraceTags;
  childOf?: TraceId;
  /** Exact in-memory runtime lifetime for traces derived from one event. */
  runtimeInstanceId?: string;
  /** Concrete event occurrence shared with DevTools operation snapshots. */
  eventInstanceId?: string;
  /** Parent event occurrence, distinct from trace/span parentage. */
  parentEventInstanceId?: string;
}

export interface Trace extends TraceOptions {
  id: TraceId;
  start: number;
  end?: number;
  duration?: number;
}

export type TraceCallback = (traces: Trace[]) => void;

/**
 * JSON-serializable event-trace error metadata. `phase` identifies whether
 * failure happened during lookup, the interceptor chain, or effect execution.
 */
export interface TraceErrorTag {
  phase: 'missing-handler' | 'handler' | 'effect';
  message: string;
  stack?: string;
  interceptor?: string;
  direction?: InterceptorDirection;
  effect?: string;
  eventV?: EventVector;
}
