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
  /** Committed state head when this queued event was accepted. */
  acceptedRevision?: number;
  /** Committed state head when this event began execution. */
  startedRevision?: number;
  /** New committed state head when this event changed state. */
  committedRevision?: number;
  /** Whether this event committed, left state unchanged, or skipped commit. */
  stateStatus?: 'committed' | 'unchanged' | 'skipped';
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
