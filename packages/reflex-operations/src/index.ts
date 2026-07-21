import type { EventVector, ReflexContracts, ReflexRuntime, SubVector } from '@flexsurfer/reflex';

export type OperationStatus = 'queued' | 'running' | 'completed' | 'failed';
export type OperationWaitStatus = 'settled' | 'timed-out';

export interface OperationOptions {
  /** Return the existing operation when this key is retried with identical input. */
  readonly idempotencyKey?: string;
  /** Subscription values to read after Reflex publishes the queue's db head. */
  readonly observe?: readonly SubVector[];
  /** Resolve a delivery result early; the operation itself continues to settle. */
  readonly timeoutMs?: number;
}

export interface OperationEvent {
  readonly event: EventVector;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface OperationObservation {
  readonly query: SubVector;
  readonly status: 'succeeded' | 'failed';
  readonly value?: unknown;
  readonly error?: string;
}

export interface OperationReceipt {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly runtimeId: string;
  readonly status: OperationStatus;
  readonly idempotencyKey: string | null;
  readonly acceptedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly event: OperationEvent;
  readonly observations: readonly OperationObservation[];
  readonly error?: string;
}

export interface OperationWaitResult {
  readonly operation: OperationReceipt;
  readonly delivery: { readonly status: OperationWaitStatus; readonly timeoutMs: number | null };
  readonly replayed: boolean;
}

export interface OperationHandle {
  readonly operationId: string;
  readonly result: Promise<OperationWaitResult>;
}

export interface OperationClient {
  start(event: EventVector, options?: OperationOptions): OperationHandle;
  dispatchAndWait(event: EventVector, options?: OperationOptions): Promise<OperationWaitResult>;
  get(operationId: string): OperationReceipt | undefined;
}

interface MutableOperation {
  receipt: {
    schemaVersion: 1;
    operationId: string;
    runtimeId: string;
    status: OperationStatus;
    idempotencyKey: string | null;
    acceptedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    event: OperationEvent;
    observations: OperationObservation[];
    error?: string;
  };
  fingerprint: string;
  completion: Promise<void>;
}

const states = new WeakMap<object, { nextId: number; operations: Map<string, MutableOperation>; keys: Map<string, string> }>();

/**
 * Add authoritative operation receipts to one explicit runtime.
 *
 * This package intentionally uses only `ReflexRuntime`'s public API. It owns
 * its receipt registry, can be installed or omitted per application, and does
 * not make the Reflex kernel aware of operations.
 */
export function createOperationClient<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
): OperationClient {
  const state = getState(runtime);

  const start = (event: EventVector, options: OperationOptions = {}): OperationHandle => {
    assertEvent(event);
    assertOptions(options);
    const eventFingerprint = fingerprint(event, options);
    const existing = options.idempotencyKey ? state.keys.get(options.idempotencyKey) : undefined;
    if (existing) {
      const operation = state.operations.get(existing)!;
      if (operation.fingerprint !== eventFingerprint) {
        throw new Error('[reflex-operations] idempotencyKey was already used with different input.');
      }
      return { operationId: existing, result: waitFor(operation, true, options.timeoutMs) };
    }

    const operationId = `${runtime.runtimeId}:operation:${++state.nextId}`;
    const acceptedAt = new Date().toISOString();
    const ownedEvent = clone(event);
    const operation: MutableOperation = {
      fingerprint: eventFingerprint,
      receipt: {
        schemaVersion: 1,
        operationId,
        runtimeId: runtime.runtimeId,
        status: 'queued',
        idempotencyKey: options.idempotencyKey ?? null,
        acceptedAt,
        startedAt: null,
        completedAt: null,
        event: { event: ownedEvent, queuedAt: acceptedAt, startedAt: null, completedAt: null },
        observations: [],
      },
      completion: Promise.resolve(),
    };
    operation.completion = settle(runtime, operation, options);
    state.operations.set(operationId, operation);
    if (options.idempotencyKey) state.keys.set(options.idempotencyKey, operationId);
    return { operationId, result: waitFor(operation, false, options.timeoutMs) };
  };

  return {
    start,
    dispatchAndWait: (event, options) => start(event, options).result,
    get: (operationId) => snapshot(state.operations.get(operationId)?.receipt),
  };
}

function getState(runtime: object) {
  let state = states.get(runtime);
  if (!state) {
    state = { nextId: 0, operations: new Map(), keys: new Map() };
    states.set(runtime, state);
  }
  return state;
}

async function settle<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
  operation: MutableOperation,
  options: OperationOptions,
): Promise<void> {
  const startedAt = new Date().toISOString();
  operation.receipt.status = 'running';
  operation.receipt.startedAt = startedAt;
  operation.receipt.event = { ...operation.receipt.event, startedAt };
  try {
    runtime.dispatch(operation.receipt.event.event as never);
    await runtime.flush();
    operation.receipt.observations = (options.observe ?? []).map((query) => observe(runtime, query));
    operation.receipt.status = 'completed';
  } catch (error) {
    operation.receipt.status = 'failed';
    operation.receipt.error = errorMessage(error);
  } finally {
    const completedAt = new Date().toISOString();
    operation.receipt.completedAt = completedAt;
    operation.receipt.event = { ...operation.receipt.event, completedAt };
  }
}

function observe<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
  query: SubVector,
): OperationObservation {
  try {
    return { query: clone(query), status: 'succeeded', value: clone(runtime.getSubscriptionValue(query as never)) };
  } catch (error) {
    return { query: clone(query), status: 'failed', error: errorMessage(error) };
  }
}

async function waitFor(
  operation: MutableOperation,
  replayed: boolean,
  timeoutMs: number | undefined,
): Promise<OperationWaitResult> {
  if (timeoutMs === undefined) {
    await operation.completion;
    return result(operation, replayed, 'settled', null);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('[reflex-operations] timeoutMs must be a non-negative finite number.');
  }
  const completed = operation.completion.then(() => false);
  const timedOut = new Promise<true>((resolve) => setTimeout(() => resolve(true), timeoutMs));
  if (await Promise.race([completed, timedOut])) return result(operation, replayed, 'timed-out', timeoutMs);
  return result(operation, replayed, 'settled', timeoutMs);
}

function result(operation: MutableOperation, replayed: boolean, status: OperationWaitStatus, timeoutMs: number | null): OperationWaitResult {
  return { operation: snapshot(operation.receipt)!, delivery: { status, timeoutMs }, replayed };
}

function assertEvent(event: EventVector): void {
  if (!Array.isArray(event) || event.length === 0 || typeof event[0] !== 'string') {
    throw new Error('[reflex-operations] event must be a non-empty event vector.');
  }
}

function assertOptions(options: OperationOptions): void {
  if (options.idempotencyKey !== undefined && (options.idempotencyKey.length === 0 || options.idempotencyKey.length > 256)) {
    throw new Error('[reflex-operations] idempotencyKey must contain 1-256 characters.');
  }
}

function fingerprint(event: EventVector, options: OperationOptions): string {
  return JSON.stringify([event, options.observe ?? []]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshot<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}
