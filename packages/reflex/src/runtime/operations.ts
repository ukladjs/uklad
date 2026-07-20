import type { Patch } from 'immer';

import { getAppDbRevisionsForRuntime } from './app-db';
import { cloneStructuredValue } from './ownership';
import type { RuntimeScope } from './scope';

import type { EventVector, SubVector } from '../types';

export type OperationCompletionBoundary = 'cascade-published';
export type OperationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'rejected';
export type OperationOutcome =
  'pending' | 'succeeded' | 'effects-failed' | 'incomplete' | 'failed' | 'rejected';
export type OperationWaitStatus = 'settled' | 'timed-out';
export type OperationEffectMode =
  'runtime-defined' | 'real' | 'stubbed' | 'fixture-backed' | 'suppressed';
export type OperationEffectStatus =
  'succeeded' | 'returned' | 'failed' | 'unhandled' | 'invalid' | 'detached';
export type OperationEventStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dropped';
export type OperationEventStateStatus = 'not-attempted' | 'unchanged' | 'committed';
export type OperationEventStart = 'untracked' | 'running' | 'rejected';

export interface OperationExecutionContextInput {
  readonly profile: string;
  readonly defaultEffectMode?: OperationEffectMode;
  readonly effectModes?: Readonly<Record<string, OperationEffectMode>>;
  readonly fixtureSetId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OperationExecutionContext extends OperationExecutionContextInput {
  readonly source: 'runtime-default' | 'caller-declared';
  readonly enforced: false;
}

export interface DispatchAndWaitOptions {
  readonly completion?: OperationCompletionBoundary;
  readonly timeoutMs?: number;
  readonly idempotencyKey?: string;
  readonly expectedRevision?: number;
  readonly observe?: readonly SubVector[];
  readonly executionContext?: OperationExecutionContextInput;
}

export type OperationLookup =
  | { readonly operationId: string; readonly idempotencyKey?: never }
  | { readonly idempotencyKey: string; readonly operationId?: never };

export interface OperationPatch {
  readonly op: Patch['op'];
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
}

export interface OperationError {
  readonly kind:
    | 'handler'
    | 'missing-handler'
    | 'coeffect'
    | 'missing-coeffect'
    | 'effect'
    | 'invalid-effect'
    | 'unhandled-effect'
    | 'queue-dropped'
    | 'disposed'
    | 'publication'
    | 'observation'
    | 'idempotency-conflict'
    | 'revision-conflict'
    | 'capacity';
  readonly message: string;
  readonly eventInstanceId?: string;
  readonly effectId?: string;
  readonly stack?: string;
}

export interface OperationEventStateResult {
  readonly status: OperationEventStateStatus;
  readonly fromRevision: number;
  readonly committedRevision: number | null;
  readonly plannedPatches: readonly OperationPatch[];
  readonly committedPatches: readonly OperationPatch[];
  readonly truncated: boolean;
}

export interface OperationEventResult {
  readonly eventInstanceId: string;
  readonly parentEventInstanceId: string | null;
  readonly event: EventVector;
  readonly status: OperationEventStatus;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly state: OperationEventStateResult;
  readonly effectIds: readonly string[];
  readonly errors: readonly OperationError[];
}

export interface OperationEffectResult {
  readonly effectId: string;
  readonly eventInstanceId: string;
  readonly type: string;
  readonly value: unknown;
  readonly mode: OperationEffectMode;
  readonly status: OperationEffectStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly error?: OperationError;
}

export interface OperationObservationResult {
  readonly query: SubVector;
  readonly status: 'succeeded' | 'failed';
  readonly value?: unknown;
  readonly error?: OperationError;
}

export interface OperationStateSummary {
  readonly status: 'unchanged' | 'committed' | 'partially-committed' | 'failed';
  readonly patches: readonly OperationPatch[];
  readonly truncated: boolean;
}

export interface OperationEffectsSummary {
  readonly status: 'none' | 'succeeded' | 'failed' | 'incomplete';
  readonly items: readonly OperationEffectResult[];
  readonly truncated: boolean;
}

export interface OperationRevisionSummary {
  readonly accepted: number;
  readonly expected: number | null;
  readonly rootStart: number | null;
  readonly lastCommitted: number | null;
  readonly published: number;
  readonly observed: number;
  readonly concurrentChangesObserved: boolean;
}

export interface OperationCompletionResult {
  readonly boundary: OperationCompletionBoundary;
  readonly satisfied: boolean;
  readonly pendingEvents: number;
}

export interface OperationDeliveryResult {
  readonly status: OperationWaitStatus;
  readonly timeoutMs: number | null;
}

export interface OperationRetention {
  readonly scope: 'runtime-instance';
  readonly durability: 'memory';
  readonly maxOperations: number;
  readonly currentlyRetained: boolean;
  readonly terminalEvictionPolicy: 'oldest-terminal';
}

export interface OperationReceipt {
  /** Experimental receipt shape; the RFC's stable v1 schema is not frozen yet. */
  readonly schemaVersion: 0;
  readonly operationId: string;
  readonly runtimeId: string;
  readonly runtimeInstanceId: string;
  readonly status: OperationStatus;
  readonly outcome: OperationOutcome;
  readonly idempotencyKey: string | null;
  readonly acceptedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly rootEventInstanceId: string;
  readonly completion: OperationCompletionResult;
  readonly executionContext: OperationExecutionContext;
  readonly revisions: OperationRevisionSummary;
  readonly events: readonly OperationEventResult[];
  readonly state: OperationStateSummary;
  readonly effects: OperationEffectsSummary;
  readonly observations: readonly OperationObservationResult[];
  readonly errors: readonly OperationError[];
  readonly truncated: boolean;
  readonly retention: OperationRetention;
}

export interface OperationWaitResult {
  readonly operation: OperationReceipt;
  readonly delivery: OperationDeliveryResult;
  readonly replayed: boolean;
}

export interface OperationHandle {
  readonly operationId: string;
  readonly runtimeInstanceId: string;
  readonly result: Promise<OperationWaitResult>;
}

interface MutableEventStateResult {
  status: OperationEventStateStatus;
  fromRevision: number;
  committedRevision: number | null;
  plannedPatches: OperationPatch[];
  committedPatches: OperationPatch[];
  truncated: boolean;
}

interface MutableEventResult {
  eventInstanceId: string;
  parentEventInstanceId: string | null;
  event: EventVector;
  status: OperationEventStatus;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  state: MutableEventStateResult;
  plannedDb: unknown;
  effectIds: string[];
  errors: OperationError[];
}

interface MutableOperation {
  operationId: string;
  fingerprint: string;
  idempotencyKey: string | null;
  status: OperationStatus;
  outcome: OperationOutcome;
  acceptedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  rootEventInstanceId: string;
  completionBoundary: OperationCompletionBoundary;
  executionContext: OperationExecutionContext;
  acceptedRevision: number;
  expectedRevision: number | null;
  rootStartRevision: number | null;
  lastCommittedRevision: number | null;
  committedRevisions: number[];
  publishedRevision: number;
  observedRevision: number;
  pendingEvents: number;
  events: MutableEventResult[];
  effects: OperationEffectResult[];
  observations: OperationObservationResult[];
  errors: OperationError[];
  requestedObservations: readonly SubVector[];
  eventsTruncated: boolean;
  effectsTruncated: boolean;
  errorsTruncated: boolean;
  terminal: boolean;
  readyToPublish: boolean;
  completionPromise: Promise<void>;
  resolveCompletion: () => void;
}

interface QueuedOperationEvent {
  readonly operation: MutableOperation;
  readonly eventInstanceId: string;
  readonly eventRecord: MutableEventResult | null;
}

interface OperationRuntimeState {
  nextOperationId: number;
  nextEventInstanceId: number;
  nextEffectId: number;
  operations: Map<string, MutableOperation>;
  idempotencyKeys: Map<string, string>;
  eventMetadata: WeakMap<EventVector, QueuedOperationEvent>;
  currentEvent: QueuedOperationEvent | null;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OPERATIONS = 256;
const MAX_EVENTS = 128;
const MAX_EFFECTS = 256;
const MAX_PATCHES_PER_EVENT = 512;
const MAX_ERRORS = 128;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

const operationStates = new WeakMap<RuntimeScope, OperationRuntimeState>();

function getOperationState(runtime: RuntimeScope): OperationRuntimeState {
  let state = operationStates.get(runtime);
  if (!state) {
    state = {
      nextOperationId: 0,
      nextEventInstanceId: 0,
      nextEffectId: 0,
      operations: new Map(),
      idempotencyKeys: new Map(),
      eventMetadata: new WeakMap(),
      currentEvent: null,
    };
    operationStates.set(runtime, state);
  }
  return state;
}

/** @internal Create or replay one tracked root dispatch. */
export function createOperationDispatchForRuntime(
  runtime: RuntimeScope,
  event: EventVector,
  options: DispatchAndWaitOptions = {},
): {
  readonly event: EventVector;
  readonly operationId: string;
  readonly wait: Promise<OperationWaitResult>;
} {
  validateOptions(options);
  validateOperationInput(event, options);
  const state = getOperationState(runtime);
  const fingerprint = fingerprintOperation(event, options);
  const existing = findExistingOperation(state, options);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      const conflict = createUnstoredRejectedOperation(
        runtime,
        state,
        event,
        options,
        fingerprint,
        'idempotency-conflict',
        'The operation or idempotency key was already used with a different event payload.',
      );
      return {
        event,
        operationId: conflict.operationId,
        wait: Promise.resolve(createWaitResult(runtime, conflict, false, 'settled')),
      };
    }
    return {
      event,
      operationId: existing.operationId,
      wait: waitForOperation(runtime, existing, normalizeTimeout(options.timeoutMs), true),
    };
  }

  evictTerminalOperation(state);
  if (state.operations.size >= MAX_OPERATIONS) {
    const rejected = createUnstoredRejectedOperation(
      runtime,
      state,
      event,
      options,
      fingerprint,
      'capacity',
      `The runtime already retains ${MAX_OPERATIONS} operations and none can be evicted.`,
    );
    return {
      event,
      operationId: rejected.operationId,
      wait: Promise.resolve(createWaitResult(runtime, rejected, false, 'settled')),
    };
  }

  const operation = createMutableOperation(runtime, state, event, options, fingerprint);
  state.operations.set(operation.operationId, operation);
  if (operation.idempotencyKey) {
    state.idempotencyKeys.set(operation.idempotencyKey, operation.operationId);
  }

  const queuedEvent = cloneEvent(event);
  const rootRecord = operation.events[0]!;
  state.eventMetadata.set(queuedEvent, {
    operation,
    eventInstanceId: rootRecord.eventInstanceId,
    eventRecord: rootRecord,
  });

  return {
    event: queuedEvent,
    operationId: operation.operationId,
    wait: waitForOperation(runtime, operation, normalizeTimeout(options.timeoutMs), false),
  };
}

/** @internal Attach a synchronous child dispatch to the currently executing operation. */
export function prepareOperationChildDispatchForRuntime(
  runtime: RuntimeScope,
  event: EventVector,
): EventVector {
  const state = getOperationState(runtime);
  const parent = state.currentEvent;
  if (!parent || parent.operation.terminal) return event;

  const queuedEvent = cloneEvent(event);
  const operation = parent.operation;
  const eventInstanceId = createEventInstanceId(runtime, state);
  const eventRecord = appendEventRecord(
    operation,
    eventInstanceId,
    parent.eventInstanceId,
    queuedEvent,
  );
  operation.pendingEvents++;
  state.eventMetadata.set(queuedEvent, { operation, eventInstanceId, eventRecord });
  return queuedEvent;
}

/** @internal Mark a queued tracked event as running. */
export function beginOperationEventForRuntime(
  runtime: RuntimeScope,
  event: EventVector,
): OperationEventStart {
  const state = getOperationState(runtime);
  const metadata = state.eventMetadata.get(event);
  if (!metadata) return 'untracked';

  const currentRevision = getAppDbRevisionsForRuntime(runtime).committedRevision;
  const operation = metadata.operation;
  if (metadata.eventInstanceId === operation.rootEventInstanceId) {
    operation.rootStartRevision = currentRevision;
    if (operation.expectedRevision !== null && operation.expectedRevision !== currentRevision) {
      operation.publishedRevision = getAppDbRevisionsForRuntime(runtime).publishedRevision;
      operation.observedRevision = operation.publishedRevision;
      rejectOperation(
        operation,
        'revision-conflict',
        `Expected state revision ${operation.expectedRevision}, but the runtime was at revision ${currentRevision} when the root event was ready to start.`,
      );
      return 'rejected';
    }
  }

  state.currentEvent = metadata;
  const now = timestamp();
  if (operation.status === 'queued') operation.status = 'running';
  operation.startedAt ??= now;
  if (metadata.eventRecord) {
    metadata.eventRecord.status = 'running';
    metadata.eventRecord.startedAt = now;
    metadata.eventRecord.state.fromRevision = currentRevision;
  }
  return 'running';
}

/** @internal Clear lexical operation context and mark one event terminal. */
export function finishOperationEventForRuntime(
  runtime: RuntimeScope,
  event: EventVector,
  thrownError?: unknown,
): string | null {
  const state = getOperationState(runtime);
  const metadata = state.eventMetadata.get(event);
  if (!metadata) return null;
  if (state.currentEvent === metadata) state.currentEvent = null;

  const operation = metadata.operation;
  if (thrownError !== undefined) {
    const normalized = normalizeError('handler', thrownError, metadata.eventInstanceId);
    if (!hasEquivalentError(operation, normalized)) {
      recordError(operation, metadata.eventRecord, normalized);
    }
  }
  if (metadata.eventRecord) {
    metadata.eventRecord.completedAt = timestamp();
    metadata.eventRecord.status = hasFatalEventError(metadata.eventRecord) ? 'failed' : 'completed';
  }
  operation.pendingEvents = Math.max(0, operation.pendingEvents - 1);
  if (operation.pendingEvents !== 0 || operation.terminal) return null;
  operation.readyToPublish = true;
  return operation.operationId;
}

/** @internal Mark queued events terminal when a queue is purged or disposed. */
export function dropOperationEventsForRuntime(
  runtime: RuntimeScope,
  events: readonly EventVector[],
  reason: 'queue-dropped' | 'disposed',
  cause: unknown,
): readonly string[] {
  const state = getOperationState(runtime);
  const ready = new Set<string>();
  for (const event of events) {
    const metadata = state.eventMetadata.get(event);
    if (!metadata || metadata.operation.terminal) continue;
    const error = normalizeError(reason, cause, metadata.eventInstanceId);
    recordError(metadata.operation, metadata.eventRecord, error);
    if (metadata.eventRecord) {
      metadata.eventRecord.status = 'dropped';
      metadata.eventRecord.completedAt = timestamp();
    }
    metadata.operation.pendingEvents = Math.max(0, metadata.operation.pendingEvents - 1);
    if (metadata.operation.pendingEvents === 0) {
      metadata.operation.readyToPublish = true;
      ready.add(metadata.operation.operationId);
    }
  }
  return Array.from(ready);
}

/** @internal Return whether receipt-grade patch capture is active for this event. */
export function isOperationCaptureActiveForRuntime(runtime: RuntimeScope): boolean {
  return getOperationState(runtime).currentEvent !== null;
}

/** @internal Add the handler's proposed state patches to the current event. */
export function recordOperationPlanForRuntime(
  runtime: RuntimeScope,
  patches: readonly Patch[],
  plannedDb: unknown,
): void {
  const metadata = getOperationState(runtime).currentEvent;
  if (!metadata?.eventRecord) return;
  const converted = patches.slice(0, MAX_PATCHES_PER_EVENT).map(copyPatch);
  metadata.eventRecord.state.plannedPatches = converted;
  metadata.eventRecord.state.truncated = patches.length > converted.length;
  metadata.eventRecord.plannedDb = plannedDb;
}

/** @internal Record the actual app-db commit performed by do-fx. */
export function recordOperationCommitForRuntime(
  runtime: RuntimeScope,
  changed: boolean,
  committedRevision: number,
  committedDb: unknown,
): void {
  const metadata = getOperationState(runtime).currentEvent;
  if (!metadata) return;
  metadata.operation.lastCommittedRevision = changed
    ? committedRevision
    : metadata.operation.lastCommittedRevision;
  if (changed) metadata.operation.committedRevisions.push(committedRevision);
  if (!metadata.eventRecord) return;
  metadata.eventRecord.state.status = changed ? 'committed' : 'unchanged';
  metadata.eventRecord.state.committedRevision = committedRevision;
  metadata.eventRecord.state.committedPatches = changed
    ? metadata.eventRecord.plannedDb === committedDb
      ? [...metadata.eventRecord.state.plannedPatches]
      : [{ op: 'replace', path: [], value: snapshotValue(committedDb) }]
    : [];
}

/** @internal Record a structured pipeline failure independently of tracing. */
export function recordOperationErrorForRuntime(
  runtime: RuntimeScope,
  kind: OperationError['kind'],
  value: unknown,
): void {
  const metadata = getOperationState(runtime).currentEvent;
  if (!metadata) return;
  recordError(
    metadata.operation,
    metadata.eventRecord,
    normalizeError(kind, value, metadata.eventInstanceId),
  );
}

/** @internal Record one emitted effect and its synchronous execution result. */
export function recordOperationEffectForRuntime(
  runtime: RuntimeScope,
  input: {
    readonly type: string;
    readonly value: unknown;
    readonly status: OperationEffectStatus;
    readonly startedAtMs: number;
    readonly error?: unknown;
  },
): void {
  const state = getOperationState(runtime);
  const metadata = state.currentEvent;
  if (!metadata) return;
  const operation = metadata.operation;
  if (operation.effects.length >= MAX_EFFECTS) {
    operation.effectsTruncated = true;
    return;
  }

  const effectId = `${runtime.runtimeInstanceId}:fx:${++state.nextEffectId}`;
  const completedAtMs = Date.now();
  const operationError =
    input.error === undefined
      ? undefined
      : normalizeError('effect', input.error, metadata.eventInstanceId, effectId);
  const result: OperationEffectResult = {
    effectId,
    eventInstanceId: metadata.eventInstanceId,
    type: input.type,
    value: snapshotValue(input.value),
    mode: getEffectMode(operation.executionContext, input.type),
    status: input.status,
    startedAt: new Date(input.startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - input.startedAtMs),
    ...(operationError ? { error: operationError } : {}),
  };
  operation.effects.push(result);
  metadata.eventRecord?.effectIds.push(effectId);
  if (operationError) recordError(operation, metadata.eventRecord, operationError);
  if (input.status === 'unhandled') {
    recordError(operation, metadata.eventRecord, {
      kind: 'unhandled-effect',
      message: `No effect handler is registered for '${input.type}'.`,
      eventInstanceId: metadata.eventInstanceId,
      effectId,
    });
  } else if (input.status === 'invalid') {
    recordError(operation, metadata.eventRecord, {
      kind: 'invalid-effect',
      message: 'The event emitted an invalid effect vector.',
      eventInstanceId: metadata.eventInstanceId,
      effectId,
    });
  }
}

/** @internal Correlation tags added to traces as secondary evidence. */
export function getOperationTraceTagsForRuntime(
  runtime: RuntimeScope,
): Readonly<Record<string, unknown>> {
  const metadata = getOperationState(runtime).currentEvent;
  if (!metadata) return {};
  const parentEventInstanceId = metadata.eventRecord?.parentEventInstanceId ?? null;
  const revisions = getAppDbRevisionsForRuntime(runtime);
  return {
    operationId: metadata.operation.operationId,
    eventInstanceId: metadata.eventInstanceId,
    parentEventInstanceId,
    runtimeInstanceId: runtime.runtimeInstanceId,
    stateRevision: revisions.committedRevision,
    publishedRevision: revisions.publishedRevision,
  };
}

/** @internal Publish observations and settle a ready operation. */
export function finalizeOperationForRuntime(
  runtime: RuntimeScope,
  operationId: string,
  evaluateObservation: (query: SubVector) => unknown,
  publicationError?: unknown,
): void {
  const operation = getOperationState(runtime).operations.get(operationId);
  if (!operation || operation.terminal || !operation.readyToPublish) return;

  const revisions = getAppDbRevisionsForRuntime(runtime);
  operation.publishedRevision = revisions.publishedRevision;
  operation.observedRevision = revisions.publishedRevision;
  if (publicationError !== undefined) {
    recordError(operation, null, normalizeError('publication', publicationError));
  } else {
    for (const query of operation.requestedObservations) {
      try {
        operation.observations.push({
          query: cloneQuery(query),
          status: 'succeeded',
          value: snapshotValue(evaluateObservation(query)),
        });
      } catch (error: unknown) {
        const operationError = normalizeError('observation', error);
        operation.observations.push({
          query: cloneQuery(query),
          status: 'failed',
          error: operationError,
        });
        recordError(operation, null, operationError);
      }
    }
  }

  operation.completedAt = timestamp();
  operation.readyToPublish = false;
  operation.terminal = true;
  operation.status = hasFatalErrors(operation) ? 'failed' : 'completed';
  operation.outcome = deriveOutcome(operation);
  operation.resolveCompletion();
}

/** @internal Read an operation by authoritative runtime-local identity. */
export function getOperationForRuntime(
  runtime: RuntimeScope,
  lookup: OperationLookup,
): OperationReceipt | undefined {
  const state = getOperationState(runtime);
  const operationId =
    'operationId' in lookup ? lookup.operationId : state.idempotencyKeys.get(lookup.idempotencyKey);
  if (!operationId) return undefined;
  const operation = state.operations.get(operationId);
  return operation ? snapshotOperation(runtime, operation) : undefined;
}

function createMutableOperation(
  runtime: RuntimeScope,
  state: OperationRuntimeState,
  event: EventVector,
  options: DispatchAndWaitOptions,
  fingerprint: string,
): MutableOperation {
  let resolveCompletion = (): void => {};
  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const revisions = getAppDbRevisionsForRuntime(runtime);
  const operationId = createOperationId(runtime, state);
  const rootEventInstanceId = createEventInstanceId(runtime, state);
  const acceptedAt = timestamp();
  const operation: MutableOperation = {
    operationId,
    fingerprint,
    idempotencyKey: options.idempotencyKey ?? null,
    status: 'queued',
    outcome: 'pending',
    acceptedAt,
    startedAt: null,
    completedAt: null,
    rootEventInstanceId,
    completionBoundary: options.completion ?? 'cascade-published',
    executionContext: normalizeExecutionContext(options.executionContext),
    acceptedRevision: revisions.committedRevision,
    expectedRevision: options.expectedRevision ?? null,
    rootStartRevision: null,
    lastCommittedRevision: null,
    committedRevisions: [],
    publishedRevision: revisions.publishedRevision,
    observedRevision: revisions.publishedRevision,
    pendingEvents: 1,
    events: [],
    effects: [],
    observations: [],
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
  appendEventRecord(operation, rootEventInstanceId, null, event);
  return operation;
}

function createUnstoredRejectedOperation(
  runtime: RuntimeScope,
  state: OperationRuntimeState,
  event: EventVector,
  options: DispatchAndWaitOptions,
  fingerprint: string,
  kind: 'idempotency-conflict' | 'capacity',
  message: string,
): MutableOperation {
  const operation = createMutableOperation(runtime, state, event, options, fingerprint);
  rejectOperation(operation, kind, message);
  return operation;
}

function rejectOperation(
  operation: MutableOperation,
  kind: 'idempotency-conflict' | 'revision-conflict' | 'capacity',
  message: string,
): void {
  const error: OperationError = { kind, message };
  operation.errors.push(error);
  operation.events[0]?.errors.push(error);
  if (operation.events[0]) {
    operation.events[0].status = 'dropped';
    operation.events[0].completedAt = timestamp();
  }
  operation.pendingEvents = 0;
  operation.status = 'rejected';
  operation.outcome = 'rejected';
  operation.completedAt = timestamp();
  operation.terminal = true;
  operation.resolveCompletion();
}

function appendEventRecord(
  operation: MutableOperation,
  eventInstanceId: string,
  parentEventInstanceId: string | null,
  event: EventVector,
): MutableEventResult | null {
  if (operation.events.length >= MAX_EVENTS) {
    operation.eventsTruncated = true;
    return null;
  }
  const eventRecord: MutableEventResult = {
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
  operation.events.push(eventRecord);
  return eventRecord;
}

async function waitForOperation(
  runtime: RuntimeScope,
  operation: MutableOperation,
  timeoutMs: number,
  replayed: boolean,
): Promise<OperationWaitResult> {
  if (operation.terminal) return createWaitResult(runtime, operation, replayed, 'settled');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
    const maybeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
    maybeTimer.unref?.();
  });
  const completed = operation.completionPromise.then(() => false);
  const didTimeOut = await Promise.race([timedOut, completed]);
  if (timer !== undefined) clearTimeout(timer);
  return createWaitResult(
    runtime,
    operation,
    replayed,
    didTimeOut ? 'timed-out' : 'settled',
    didTimeOut ? timeoutMs : undefined,
  );
}

function createWaitResult(
  runtime: RuntimeScope,
  operation: MutableOperation,
  replayed: boolean,
  deliveryStatus: OperationWaitStatus,
  timeoutMs?: number,
): OperationWaitResult {
  return {
    operation: snapshotOperation(runtime, operation),
    delivery: {
      status: deliveryStatus,
      timeoutMs: timeoutMs ?? null,
    },
    replayed,
  };
}

function snapshotOperation(runtime: RuntimeScope, operation: MutableOperation): OperationReceipt {
  const stateSummary = summarizeState(operation);
  const effectsSummary = summarizeEffects(operation);
  const completedAtMs = operation.completedAt ? Date.parse(operation.completedAt) : null;
  const acceptedAtMs = Date.parse(operation.acceptedAt);
  return {
    schemaVersion: 0,
    operationId: operation.operationId,
    runtimeId: runtime.runtimeId,
    runtimeInstanceId: runtime.runtimeInstanceId,
    status: operation.status,
    outcome: operation.outcome,
    idempotencyKey: operation.idempotencyKey,
    acceptedAt: operation.acceptedAt,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    durationMs:
      completedAtMs === null || Number.isNaN(completedAtMs)
        ? null
        : Math.max(0, completedAtMs - acceptedAtMs),
    rootEventInstanceId: operation.rootEventInstanceId,
    completion: {
      boundary: operation.completionBoundary,
      satisfied: operation.terminal && operation.status !== 'rejected',
      pendingEvents: operation.pendingEvents,
    },
    executionContext: cloneExecutionContext(operation.executionContext),
    revisions: {
      accepted: operation.acceptedRevision,
      expected: operation.expectedRevision,
      rootStart: operation.rootStartRevision,
      lastCommitted: operation.lastCommittedRevision,
      published: operation.publishedRevision,
      observed: operation.observedRevision,
      concurrentChangesObserved:
        operation.observedRevision >
        operation.acceptedRevision + operation.committedRevisions.length,
    },
    events: operation.events.map(snapshotEvent),
    state: stateSummary,
    effects: effectsSummary,
    observations: operation.observations.map(snapshotObservation),
    errors: operation.errors.map(copyError),
    truncated:
      operation.eventsTruncated ||
      operation.effectsTruncated ||
      operation.errorsTruncated ||
      stateSummary.truncated,
    retention: {
      scope: 'runtime-instance',
      durability: 'memory',
      maxOperations: MAX_OPERATIONS,
      currentlyRetained:
        getOperationState(runtime).operations.get(operation.operationId) === operation,
      terminalEvictionPolicy: 'oldest-terminal',
    },
  };
}

function snapshotEvent(event: MutableEventResult): OperationEventResult {
  return {
    eventInstanceId: event.eventInstanceId,
    parentEventInstanceId: event.parentEventInstanceId,
    event: cloneEvent(event.event),
    status: event.status,
    queuedAt: event.queuedAt,
    startedAt: event.startedAt,
    completedAt: event.completedAt,
    state: {
      status: event.state.status,
      fromRevision: event.state.fromRevision,
      committedRevision: event.state.committedRevision,
      plannedPatches: event.state.plannedPatches.map(copyOperationPatch),
      committedPatches: event.state.committedPatches.map(copyOperationPatch),
      truncated: event.state.truncated,
    },
    effectIds: [...event.effectIds],
    errors: event.errors.map(copyError),
  };
}

function snapshotObservation(observation: OperationObservationResult): OperationObservationResult {
  return {
    query: cloneQuery(observation.query),
    status: observation.status,
    ...('value' in observation ? { value: snapshotValue(observation.value) } : {}),
    ...(observation.error ? { error: copyError(observation.error) } : {}),
  };
}

function summarizeState(operation: MutableOperation): OperationStateSummary {
  const committedEvents = operation.events.filter((event) => event.state.status === 'committed');
  const patches = committedEvents.flatMap((event) => event.state.committedPatches);
  const truncated =
    committedEvents.some((event) => event.state.truncated) ||
    patches.length > MAX_PATCHES_PER_EVENT;
  const boundedPatches = patches.slice(0, MAX_PATCHES_PER_EVENT).map(copyOperationPatch);
  const hasHandlerFailure = operation.errors.some(
    (error) =>
      error.kind === 'handler' ||
      error.kind === 'missing-handler' ||
      error.kind === 'queue-dropped' ||
      error.kind === 'disposed' ||
      error.kind === 'publication',
  );
  const status: OperationStateSummary['status'] =
    committedEvents.length > 0
      ? hasHandlerFailure
        ? 'partially-committed'
        : 'committed'
      : hasHandlerFailure
        ? 'failed'
        : 'unchanged';
  return { status, patches: boundedPatches, truncated };
}

function summarizeEffects(operation: MutableOperation): OperationEffectsSummary {
  const hasFailure = operation.effects.some(
    (effect) =>
      effect.status === 'failed' || effect.status === 'unhandled' || effect.status === 'invalid',
  );
  const hasDetached = operation.effects.some((effect) => effect.status === 'detached');
  const hasUnacknowledgedReturn = operation.effects.some((effect) => effect.status === 'returned');
  const status: OperationEffectsSummary['status'] = operation.effectsTruncated
    ? 'incomplete'
    : operation.effects.length === 0
      ? 'none'
      : hasFailure
        ? 'failed'
        : hasDetached || hasUnacknowledgedReturn
          ? 'incomplete'
          : 'succeeded';
  return {
    status,
    items: operation.effects.map(snapshotEffect),
    truncated: operation.effectsTruncated,
  };
}

function snapshotEffect(effect: OperationEffectResult): OperationEffectResult {
  return {
    effectId: effect.effectId,
    eventInstanceId: effect.eventInstanceId,
    type: effect.type,
    value: snapshotValue(effect.value),
    mode: effect.mode,
    status: effect.status,
    startedAt: effect.startedAt,
    completedAt: effect.completedAt,
    durationMs: effect.durationMs,
    ...(effect.error ? { error: copyError(effect.error) } : {}),
  };
}

function deriveOutcome(operation: MutableOperation): OperationOutcome {
  if (operation.status === 'rejected') return 'rejected';
  if (hasFatalErrors(operation)) return 'failed';
  const effects = summarizeEffects(operation);
  if (effects.status === 'failed') return 'effects-failed';
  if (
    effects.status === 'incomplete' ||
    operation.eventsTruncated ||
    operation.errorsTruncated ||
    summarizeState(operation).truncated
  ) {
    return 'incomplete';
  }
  return 'succeeded';
}

function hasFatalErrors(operation: MutableOperation): boolean {
  return operation.errors.some(
    (error) =>
      error.kind !== 'effect' &&
      error.kind !== 'invalid-effect' &&
      error.kind !== 'unhandled-effect',
  );
}

function hasFatalEventError(event: MutableEventResult): boolean {
  return event.errors.some(
    (error) =>
      error.kind !== 'effect' &&
      error.kind !== 'invalid-effect' &&
      error.kind !== 'unhandled-effect',
  );
}

function hasEquivalentError(operation: MutableOperation, candidate: OperationError): boolean {
  return operation.errors.some(
    (error) =>
      error.kind === candidate.kind &&
      error.message === candidate.message &&
      error.eventInstanceId === candidate.eventInstanceId &&
      error.effectId === candidate.effectId,
  );
}

function recordError(
  operation: MutableOperation,
  event: MutableEventResult | null,
  error: OperationError,
): void {
  if (operation.errors.length < MAX_ERRORS) operation.errors.push(error);
  else operation.errorsTruncated = true;
  if (event && event.errors.length < MAX_ERRORS) event.errors.push(error);
}

function normalizeError(
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

function findExistingOperation(
  state: OperationRuntimeState,
  options: DispatchAndWaitOptions,
): MutableOperation | undefined {
  if (options.idempotencyKey) {
    const operationId = state.idempotencyKeys.get(options.idempotencyKey);
    if (operationId) return state.operations.get(operationId);
  }
  return undefined;
}

function evictTerminalOperation(state: OperationRuntimeState): void {
  if (state.operations.size < MAX_OPERATIONS) return;
  for (const [operationId, operation] of state.operations) {
    if (!operation.terminal) continue;
    state.operations.delete(operationId);
    if (
      operation.idempotencyKey &&
      state.idempotencyKeys.get(operation.idempotencyKey) === operationId
    ) {
      state.idempotencyKeys.delete(operation.idempotencyKey);
    }
    return;
  }
}

function validateOptions(options: DispatchAndWaitOptions): void {
  const allowedKeys = new Set([
    'completion',
    'timeoutMs',
    'idempotencyKey',
    'expectedRevision',
    'observe',
    'executionContext',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`[reflex] Unknown operation option '${key}'.`);
    }
  }
  if (options.completion !== undefined && options.completion !== 'cascade-published') {
    throw new Error("[reflex] completion must be 'cascade-published'.");
  }
  normalizeTimeout(options.timeoutMs);
  if (options.idempotencyKey !== undefined) {
    validateIdentifier(options.idempotencyKey, 'idempotencyKey');
  }
  if (
    options.expectedRevision !== undefined &&
    (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)
  ) {
    throw new Error('[reflex] expectedRevision must be a non-negative safe integer.');
  }
  if (options.observe && options.observe.length > 64) {
    throw new Error('[reflex] observe accepts at most 64 subscription queries.');
  }
}

function validateOperationInput(event: EventVector, options: DispatchAndWaitOptions): void {
  try {
    cloneStructuredValue({
      event,
      observations: options.observe ?? [],
      executionContext: options.executionContext ?? null,
    });
  } catch (error: unknown) {
    throw new Error(
      '[reflex] Tracked operation input must be structured-cloneable so its evidence is immutable.',
      { cause: error },
    );
  }
  if (options.idempotencyKey !== undefined) {
    assertJsonFingerprintInput({
      event,
      completion: options.completion ?? 'cascade-published',
      expectedRevision: options.expectedRevision ?? null,
      observations: options.observe ?? [],
      executionContext: options.executionContext ?? null,
    });
  }
}

function assertJsonFingerprintInput(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'boolean' ||
      (typeof current === 'number' && Number.isFinite(current))
    ) {
      return;
    }
    if (typeof current !== 'object') {
      throw new Error('[reflex] Idempotent operation input must be JSON-compatible.');
    }
    if (seen.has(current)) {
      throw new Error('[reflex] Idempotent operation input must not contain cycles.');
    }
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      seen.delete(current);
      return;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        '[reflex] Idempotent operation input must use JSON arrays and plain objects.',
      );
    }
    for (const item of Object.values(current)) visit(item);
    seen.delete(current);
  };
  visit(value);
}

function validateIdentifier(value: string, field: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `[reflex] ${field} must be 1-256 characters and contain only letters, numbers, dot, underscore, colon, or hyphen.`,
    );
  }
}

function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`[reflex] timeoutMs must be between 0 and ${MAX_TIMEOUT_MS}.`);
  }
  return timeoutMs;
}

function normalizeExecutionContext(
  context: OperationExecutionContextInput | undefined,
): OperationExecutionContext {
  return {
    profile: context?.profile ?? 'runtime',
    source: context ? 'caller-declared' : 'runtime-default',
    enforced: false,
    defaultEffectMode: context?.defaultEffectMode ?? 'runtime-defined',
    ...(context?.effectModes ? { effectModes: { ...context.effectModes } } : {}),
    ...(context?.fixtureSetId ? { fixtureSetId: context.fixtureSetId } : {}),
    ...(context?.metadata ? { metadata: { ...context.metadata } } : {}),
  };
}

function cloneExecutionContext(context: OperationExecutionContext): OperationExecutionContext {
  return {
    profile: context.profile,
    source: context.source,
    enforced: false,
    ...(context.defaultEffectMode ? { defaultEffectMode: context.defaultEffectMode } : {}),
    ...(context.effectModes ? { effectModes: { ...context.effectModes } } : {}),
    ...(context.fixtureSetId ? { fixtureSetId: context.fixtureSetId } : {}),
    ...(context.metadata ? { metadata: { ...context.metadata } } : {}),
  };
}

function getEffectMode(context: OperationExecutionContext, type: string): OperationEffectMode {
  return context.effectModes?.[type] ?? context.defaultEffectMode ?? 'runtime-defined';
}

function createOperationId(runtime: RuntimeScope, state: OperationRuntimeState): string {
  state.nextOperationId++;
  return `${runtime.runtimeInstanceId}:op:${state.nextOperationId}`;
}

function createEventInstanceId(runtime: RuntimeScope, state: OperationRuntimeState): string {
  state.nextEventInstanceId++;
  return `${runtime.runtimeInstanceId}:event:${state.nextEventInstanceId}`;
}

function cloneEvent(event: EventVector): EventVector {
  const clone = event.map(snapshotValue) as EventVector;
  const metadata = (event as EventVector & { meta?: unknown }).meta;
  if (metadata !== undefined) {
    (clone as EventVector & { meta?: unknown }).meta = snapshotValue(metadata);
  }
  return clone;
}

function cloneQuery(query: SubVector): SubVector {
  return query.map(snapshotValue) as SubVector;
}

function copyPatch(patch: Patch): OperationPatch {
  return {
    op: patch.op,
    path: [...patch.path],
    ...('value' in patch ? { value: snapshotValue(patch.value) } : {}),
  };
}

function copyOperationPatch(patch: OperationPatch): OperationPatch {
  return {
    op: patch.op,
    path: [...patch.path],
    ...('value' in patch ? { value: snapshotValue(patch.value) } : {}),
  };
}

function copyError(error: OperationError): OperationError {
  return { ...error };
}

function snapshotValue<T>(value: T): T {
  try {
    return cloneStructuredValue(value);
  } catch {
    return {
      $reflex: 'unavailable',
      reason: 'value-is-not-structured-cloneable',
      type: typeof value,
    } as T;
  }
}

function fingerprintOperation(event: EventVector, options: DispatchAndWaitOptions): string {
  return fingerprintValue({
    event,
    completion: options.completion ?? 'cascade-published',
    expectedRevision: options.expectedRevision ?? null,
    observations: options.observe ?? [],
    executionContext: options.executionContext ?? null,
  });
}

function fingerprintValue(input: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (value: unknown): unknown => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return { $number: 'NaN' };
      if (value === Infinity) return { $number: 'Infinity' };
      if (value === -Infinity) return { $number: '-Infinity' };
      if (Object.is(value, -0)) return { $number: '-0' };
      return value;
    }
    if (typeof value === 'undefined') return { $undefined: true };
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    if (typeof value === 'symbol') return { $symbol: String(value) };
    if (typeof value === 'function') return { $function: value.name };
    if (typeof value !== 'object') return safeString(value);
    if (seen.has(value)) return { $cycle: true };
    seen.add(value);
    if (Array.isArray(value)) return value.map(normalize);
    if (value instanceof Date) return { $date: value.toISOString() };
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return result;
  };
  return JSON.stringify(normalize(input));
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[Unprintable value]';
  }
}

function timestamp(): string {
  return new Date().toISOString();
}
