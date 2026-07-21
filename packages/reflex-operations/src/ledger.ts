import type {
  EventVector,
  ReflexRuntime,
  RuntimeLifecycleEffect,
  RuntimeLifecycleSubscription,
} from '@flexsurfer/reflex';

import { MAX_EFFECTS, MAX_ERRORS, MAX_EVENTS, MAX_OPERATIONS } from './limits.js';
import { deriveOutcome } from './receipt.js';
import type { EventMetadata, MutableEvent, MutableOperation, OperationState } from './state.js';
import type {
  OperationEffectResult,
  OperationError,
  OperationOptions,
} from './types.js';
import { getEffectMode, normalizeExecutionContext } from './validation.js';
import { cloneEvent, cloneQuery, safeString, snapshotValue, timestamp } from './values.js';

export function createOperation(
  runtime: ReflexRuntime<any>,
  state: OperationState,
  event: EventVector,
  options: OperationOptions,
  fingerprint: string,
): MutableOperation {
  let resolveCompletion = (): void => {};
  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const acceptedRevision = runtime.getStateRevisions().committedRevision;
  const operation: MutableOperation = {
    operationId: `${runtime.runtimeInstanceId}:op:${++state.nextOperationId}`,
    fingerprint,
    idempotencyKey: options.idempotencyKey ?? null,
    status: 'queued',
    outcome: 'pending',
    acceptedAt: timestamp(),
    startedAt: null,
    completedAt: null,
    rootEventInstanceId: `${runtime.runtimeInstanceId}:event:${++state.nextEventInstanceId}`,
    completionBoundary: options.completion ?? 'cascade-published',
    executionContext: normalizeExecutionContext(options.executionContext),
    acceptedRevision,
    expectedRevision: options.expectedRevision ?? null,
    rootStartRevision: null,
    lastCommittedRevision: null,
    committedRevisions: [],
    publishedRevision: acceptedRevision,
    observedRevision: acceptedRevision,
    pendingEvents: 1,
    events: [],
    effects: [],
    observations: [],
    recalculatedSubscriptions: [],
    errors: [],
    requestedObservations: (options.observe ?? []).map(cloneQuery),
    eventsTruncated: false,
    effectsTruncated: false,
    errorsTruncated: false,
    terminal: false,
    readyToPublish: false,
    completionPromise,
    resolveCompletion,
  };
  appendEvent(operation, operation.rootEventInstanceId, null, event);
  return operation;
}

/** Record the final, fully-settled publication wave for one operation. */
export function recordPublishedSubscriptions(
  operation: MutableOperation,
  recalculated: readonly RuntimeLifecycleSubscription[],
): void {
  operation.recalculatedSubscriptions = recalculated.map((subscription) => ({
    key: subscription.key,
    query: cloneQuery(subscription.query as never),
    kind: subscription.kind,
    active: subscription.active,
    version: subscription.version,
    status: subscription.status,
    ...(subscription.status === 'value' ? { value: snapshotValue(subscription.value) } : {}),
    ...(subscription.status === 'error' ? { error: subscription.error ?? '[Unknown subscription error]' } : {}),
  }));
}

export function createEventInstanceId(runtime: ReflexRuntime<any>, state: OperationState): string {
  return `${runtime.runtimeInstanceId}:event:${++state.nextEventInstanceId}`;
}

export function appendEvent(
  operation: MutableOperation,
  eventInstanceId: string,
  parentEventInstanceId: string | null,
  event: EventVector,
): MutableEvent | null {
  if (operation.events.length >= MAX_EVENTS) {
    operation.eventsTruncated = true;
    return null;
  }
  const record: MutableEvent = {
    eventInstanceId,
    parentEventInstanceId,
    event: cloneEvent(event),
    status: 'queued',
    queuedAt: timestamp(),
    startedAt: null,
    completedAt: null,
    state: {
      status: 'not-attempted',
      fromRevision: operation.acceptedRevision,
      committedRevision: null,
      plannedPatches: [],
      committedPatches: [],
      truncated: false,
    },
    plannedDb: undefined,
    effectIds: [],
    errors: [],
  };
  operation.events.push(record);
  return record;
}

export function requestFinalization(
  runtime: ReflexRuntime<any>,
  state: OperationState,
  operation: MutableOperation,
): void {
  void runtime
    .flush()
    .catch(() => undefined)
    .then(() => {
      if (
        operation.readyToPublish &&
        !operation.terminal &&
        (operation.lastCommittedRevision === null || state.knownPublishedRevision >= operation.lastCommittedRevision)
      ) {
        finalizeOperation(runtime, state, operation);
      }
    });
}

export function finalizeOperation(
  runtime: ReflexRuntime<any>,
  state: OperationState,
  operation: MutableOperation,
): void {
  if (!operation.readyToPublish || operation.terminal) return;
  operation.publishedRevision = state.knownPublishedRevision;
  operation.observedRevision = state.knownPublishedRevision;
  for (const query of operation.requestedObservations) {
    try {
      operation.observations.push({
        query: cloneQuery(query),
        status: 'succeeded',
        value: snapshotValue(runtime.getSubscriptionValue(query as never)),
      });
    } catch (error: unknown) {
      const operationError = normalizeError('observation', error);
      operation.observations.push({ query: cloneQuery(query), status: 'failed', error: operationError });
      recordError(operation, null, operationError);
    }
  }
  operation.completedAt = timestamp();
  operation.readyToPublish = false;
  operation.terminal = true;
  operation.status = hasFatalErrors(operation) ? 'failed' : 'completed';
  operation.outcome = deriveOutcome(operation);
  operation.resolveCompletion();
}

export function failDisposed(operation: MutableOperation): void {
  if (operation.terminal) return;
  const event = operation.events.find((candidate) => candidate.status === 'queued' || candidate.status === 'running');
  const error = normalizeError('disposed', new Error('[reflex] Runtime was disposed.'), event?.eventInstanceId);
  recordError(operation, event ?? null, error);
  if (event) {
    event.status = 'dropped';
    event.completedAt = timestamp();
  }
  operation.pendingEvents = 0;
  operation.readyToPublish = false;
  operation.completedAt = timestamp();
  operation.status = 'failed';
  operation.outcome = 'failed';
  operation.terminal = true;
  operation.resolveCompletion();
}

export function recordEffect(
  runtime: ReflexRuntime<any>,
  state: OperationState,
  metadata: EventMetadata,
  input: RuntimeLifecycleEffect,
): void {
  const operation = metadata.operation;
  if (operation.effects.length >= MAX_EFFECTS) {
    operation.effectsTruncated = true;
    return;
  }
  const effectId = `${runtime.runtimeInstanceId}:fx:${++state.nextEffectId}`;
  const completedAtMs = Date.now();
  const error =
    input.error === undefined
      ? undefined
      : normalizeError('effect', input.error, metadata.eventInstanceId, effectId);
  const effect: OperationEffectResult = {
    effectId,
    eventInstanceId: metadata.eventInstanceId,
    type: input.type,
    value: snapshotValue(input.value),
    mode: getEffectMode(operation.executionContext, input.type),
    status: input.status,
    startedAt: new Date(input.startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - input.startedAtMs),
    ...(error ? { error } : {}),
  };
  operation.effects.push(effect);
  metadata.eventRecord?.effectIds.push(effectId);
  if (error) recordError(operation, metadata.eventRecord, error);
  if (input.status === 'unhandled') {
    recordError(operation, metadata.eventRecord, {
      kind: 'unhandled-effect',
      message: `No effect handler is registered for '${input.type}'.`,
      eventInstanceId: metadata.eventInstanceId,
      effectId,
    });
  }
  if (input.status === 'invalid') {
    recordError(operation, metadata.eventRecord, {
      kind: 'invalid-effect',
      message: 'The event emitted an invalid effect vector.',
      eventInstanceId: metadata.eventInstanceId,
      effectId,
    });
  }
}

export function rejectOperation(
  operation: MutableOperation,
  kind: 'idempotency-conflict' | 'revision-conflict' | 'capacity',
  message: string,
): void {
  const error: OperationError = { kind, message };
  operation.errors.push(error);
  const root = operation.events[0];
  if (root) {
    root.errors.push(error);
    root.status = 'dropped';
    root.completedAt = timestamp();
  }
  operation.pendingEvents = 0;
  operation.status = 'rejected';
  operation.outcome = 'rejected';
  operation.completedAt = timestamp();
  operation.terminal = true;
  operation.resolveCompletion();
}

export function recordError(operation: MutableOperation, event: MutableEvent | null, error: OperationError): void {
  if (!operation.errors.some((item) => sameError(item, error))) {
    if (operation.errors.length < MAX_ERRORS) operation.errors.push(error);
    else operation.errorsTruncated = true;
  }
  if (event && !event.errors.some((item) => sameError(item, error)) && event.errors.length < MAX_ERRORS) {
    event.errors.push(error);
  }
}

export function normalizeError(
  kind: OperationError['kind'],
  value: unknown,
  eventInstanceId?: string,
  effectId?: string,
): OperationError {
  const error = value instanceof Error ? value : new Error(safeString(value));
  return {
    kind,
    message: error.message,
    ...(eventInstanceId ? { eventInstanceId } : {}),
    ...(effectId ? { effectId } : {}),
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
  };
}

export function evictTerminalOperation(state: OperationState): void {
  if (state.operations.size < MAX_OPERATIONS) return;
  for (const [operationId, operation] of state.operations) {
    if (!operation.terminal) continue;
    state.operations.delete(operationId);
    if (operation.idempotencyKey && state.idempotencyKeys.get(operation.idempotencyKey) === operationId) {
      state.idempotencyKeys.delete(operation.idempotencyKey);
    }
    return;
  }
}

function hasFatalErrors(operation: MutableOperation): boolean {
  return operation.errors.some(
    (error) => !['effect', 'invalid-effect', 'unhandled-effect'].includes(error.kind),
  );
}

function sameError(left: OperationError, right: OperationError): boolean {
  return (
    left.kind === right.kind &&
    left.message === right.message &&
    left.eventInstanceId === right.eventInstanceId &&
    left.effectId === right.effectId
  );
}
