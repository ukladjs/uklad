import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  type RuntimeKernel,
} from '../runtime/kernel';

import type { ExecutionEnvelope, ExecutionOutcome } from './outcomes';

export type OperationStatus =
  | 'queued'
  | 'running'
  | 'publishing'
  | 'completed'
  | 'completed-with-errors'
  | 'rejected'
  | 'failed';

export interface OperationSnapshot {
  readonly operationId: string;
  readonly rootEventInstanceId: string;
  readonly acceptedSequence: number;
  readonly acceptedRevision?: number;
  readonly startedRevision?: number;
  readonly publishedRevision?: number;
  readonly status: OperationStatus;
  readonly eventInstanceIds: readonly string[];
  readonly events: readonly OperationEventSnapshot[];
  readonly pendingEventInstanceIds: readonly string[];
  readonly pendingPublishedRevision?: number;
  readonly committedRevisions: readonly number[];
  readonly errors: readonly unknown[];
}

export interface OperationEventSnapshot {
  readonly eventInstanceId: string;
  readonly parentEventInstanceId?: string;
  readonly sourceEffectId?: string;
  readonly sourceEffectIndex?: number;
  readonly acceptedSequence: number;
  readonly acceptedRevision?: number;
  readonly startedRevision?: number;
  readonly committedRevision?: number;
  readonly status: 'queued' | 'running' | 'completed' | 'rejected' | 'failed' | 'dropped';
}

/** Terminal operation records kept by the internal transitional ledger. */
export const MAX_RETAINED_OPERATION_SNAPSHOTS = 256;

interface MutableOperationEventState {
  readonly envelope: ExecutionEnvelope;
  acceptedRevision: number | undefined;
  startedRevision: number | undefined;
  committedRevision: number | undefined;
  status: OperationEventSnapshot['status'];
}

interface MutableOperationState {
  readonly operationId: string;
  readonly rootEventInstanceId: string;
  readonly acceptedSequence: number;
  acceptedRevision: number | undefined;
  startedRevision: number | undefined;
  publishedRevision: number | undefined;
  status: OperationStatus;
  readonly eventInstanceIds: string[];
  readonly events: Map<string, MutableOperationEventState>;
  readonly pendingEventInstanceIds: Set<string>;
  readonly committedRevisions: number[];
  readonly errors: unknown[];
  hasNonTerminalError: boolean;
  pendingPublishedRevision: number | undefined;
}

interface OperationCoordinatorState {
  readonly operations: Map<string, MutableOperationState>;
  publishedRevision: number;
}

const OPERATION_COORDINATOR = createRuntimeStateKey<OperationCoordinatorState>(
  'reflex.operation-coordinator',
);

function getCoordinator(runtime: RuntimeKernel): OperationCoordinatorState {
  return getOrCreateRuntimeState(runtime, OPERATION_COORDINATOR, () => ({
    operations: new Map(),
    publishedRevision: 0,
  }));
}

/**
 * Apply one canonical executor outcome to the runtime-owned operation ledger.
 * This is synchronous and mandatory; telemetry is notified only after this
 * projection has accepted the record.
 */
export function applyExecutionOutcomeForKernel(
  runtime: RuntimeKernel,
  outcome: ExecutionOutcome,
): void {
  switch (outcome.type) {
    case 'queued':
      acceptEnvelope(runtime, outcome.envelope, outcome.committedRevision);
      return;
    case 'started': {
      const operation = getOperation(runtime, outcome.envelope);
      if (operation.status === 'queued') operation.status = 'running';
      operation.startedRevision ??= outcome.committedRevision;
      const event = operation.events.get(outcome.envelope.eventInstanceId);
      if (event) {
        event.startedRevision = outcome.committedRevision;
        event.status = 'running';
      }
      return;
    }
    case 'transition': {
      const operation = getOperation(runtime, outcome.envelope);
      if (outcome.status === 'failed') {
        operation.status = 'failed';
        recordError(operation, outcome.error);
        updateEventStatus(operation, outcome.envelope, 'failed');
      } else if (outcome.status === 'missing-handler') {
        operation.status = 'failed';
        recordError(operation, outcome.error);
        updateEventStatus(operation, outcome.envelope, 'failed');
      } else if (outcome.status !== 'completed') {
        operation.hasNonTerminalError = true;
        recordError(operation, outcome.error);
      }
      return;
    }
    case 'commit': {
      if (outcome.status !== 'committed') return;
      const operation = getOperation(runtime, outcome.envelope);
      operation.committedRevisions.push(outcome.committedRevision);
      const event = operation.events.get(outcome.envelope.eventInstanceId);
      if (event) event.committedRevision = outcome.committedRevision;
      if (outcome.committedRevision > getCoordinator(runtime).publishedRevision) {
        operation.pendingPublishedRevision = Math.max(
          operation.pendingPublishedRevision ?? 0,
          outcome.committedRevision,
        );
      }
      return;
    }
    case 'effect': {
      if (
        outcome.status !== 'failed' &&
        outcome.status !== 'invalid' &&
        outcome.status !== 'unhandled'
      ) {
        return;
      }
      const operation = getOperation(runtime, outcome.envelope);
      operation.hasNonTerminalError = true;
      recordError(operation, outcome.error);
      return;
    }
    case 'finished': {
      const operation = getOperation(runtime, outcome.envelope);
      operation.pendingEventInstanceIds.delete(outcome.envelope.eventInstanceId);
      if (outcome.status === 'failed') {
        operation.status = 'failed';
        recordError(operation, outcome.error);
        updateEventStatus(operation, outcome.envelope, 'failed');
        pruneTerminalOperations(getCoordinator(runtime));
        return;
      }
      if (outcome.status === 'rejected') {
        operation.status = 'rejected';
        recordError(operation, outcome.error);
        updateEventStatus(operation, outcome.envelope, 'rejected');
        pruneTerminalOperations(getCoordinator(runtime));
        return;
      }
      completeEvent(operation, outcome.envelope);
      settleIfComplete(operation);
      pruneTerminalOperations(getCoordinator(runtime));
      return;
    }
    case 'dropped':
      for (const envelope of outcome.envelopes) {
        const operation = getOperation(runtime, envelope);
        operation.pendingEventInstanceIds.delete(envelope.eventInstanceId);
        recordError(operation, outcome.error);
        operation.status = 'failed';
        updateEventStatus(operation, envelope, 'dropped');
      }
      pruneTerminalOperations(getCoordinator(runtime));
      return;
    case 'published': {
      const coordinator = getCoordinator(runtime);
      coordinator.publishedRevision = Math.max(
        coordinator.publishedRevision,
        outcome.publishedRevision,
      );
      for (const operation of coordinator.operations.values()) {
        if (
          operation.pendingPublishedRevision !== undefined &&
          operation.pendingPublishedRevision <= coordinator.publishedRevision
        ) {
          operation.pendingPublishedRevision = undefined;
          operation.publishedRevision = outcome.publishedRevision;
          settleIfComplete(operation);
        }
      }
      pruneTerminalOperations(coordinator);
      return;
    }
    case 'runtime-disposed': {
      const coordinator = getCoordinator(runtime);
      for (const operation of coordinator.operations.values()) {
        if (isTerminal(operation.status)) continue;
        operation.pendingEventInstanceIds.clear();
        operation.pendingPublishedRevision = undefined;
        operation.status = 'failed';
        recordError(operation, outcome.error);
        for (const event of operation.events.values()) {
          if (event.status === 'queued' || event.status === 'running') event.status = 'dropped';
        }
      }
      pruneTerminalOperations(coordinator);
      return;
    }
  }
}

/** @internal Return an immutable operation view for a future public ledger API. */
export function getOperationSnapshotForKernel(
  runtime: RuntimeKernel,
  operationId: string,
): OperationSnapshot | undefined {
  const operation = getCoordinator(runtime).operations.get(operationId);
  if (!operation) return undefined;
  return Object.freeze({
    operationId: operation.operationId,
    rootEventInstanceId: operation.rootEventInstanceId,
    acceptedSequence: operation.acceptedSequence,
    ...(operation.acceptedRevision === undefined
      ? {}
      : { acceptedRevision: operation.acceptedRevision }),
    ...(operation.startedRevision === undefined
      ? {}
      : { startedRevision: operation.startedRevision }),
    ...(operation.publishedRevision === undefined
      ? {}
      : { publishedRevision: operation.publishedRevision }),
    status: operation.status,
    eventInstanceIds: Object.freeze([...operation.eventInstanceIds]),
    events: Object.freeze(
      [...operation.events.values()].map((event) =>
        Object.freeze({
          eventInstanceId: event.envelope.eventInstanceId,
          ...(event.envelope.parentEventInstanceId === undefined
            ? {}
            : { parentEventInstanceId: event.envelope.parentEventInstanceId }),
          ...(event.envelope.sourceEffectId === undefined
            ? {}
            : { sourceEffectId: event.envelope.sourceEffectId }),
          ...(event.envelope.sourceEffectIndex === undefined
            ? {}
            : { sourceEffectIndex: event.envelope.sourceEffectIndex }),
          acceptedSequence: event.envelope.acceptedSequence,
          ...(event.acceptedRevision === undefined
            ? {}
            : { acceptedRevision: event.acceptedRevision }),
          ...(event.startedRevision === undefined
            ? {}
            : { startedRevision: event.startedRevision }),
          ...(event.committedRevision === undefined
            ? {}
            : { committedRevision: event.committedRevision }),
          status: event.status,
        }),
      ),
    ),
    pendingEventInstanceIds: Object.freeze([...operation.pendingEventInstanceIds]),
    ...(operation.pendingPublishedRevision === undefined
      ? {}
      : { pendingPublishedRevision: operation.pendingPublishedRevision }),
    committedRevisions: Object.freeze([...operation.committedRevisions]),
    errors: Object.freeze([...operation.errors]),
  });
}

function acceptEnvelope(
  runtime: RuntimeKernel,
  envelope: ExecutionEnvelope,
  acceptedRevision?: number,
): void {
  const coordinator = getCoordinator(runtime);
  let operation = coordinator.operations.get(envelope.operationId);
  if (!operation) {
    const created: MutableOperationState = {
      operationId: envelope.operationId,
      rootEventInstanceId: envelope.eventInstanceId,
      acceptedSequence: envelope.acceptedSequence,
      acceptedRevision,
      startedRevision: undefined,
      publishedRevision: undefined,
      status: 'queued',
      eventInstanceIds: [],
      events: new Map(),
      pendingEventInstanceIds: new Set(),
      committedRevisions: [],
      errors: [],
      hasNonTerminalError: false,
      pendingPublishedRevision: undefined,
    };
    coordinator.operations.set(envelope.operationId, created);
    operation = created;
  }
  operation.eventInstanceIds.push(envelope.eventInstanceId);
  operation.events.set(envelope.eventInstanceId, {
    envelope,
    acceptedRevision,
    startedRevision: undefined,
    committedRevision: undefined,
    status: 'queued',
  });
  operation.pendingEventInstanceIds.add(envelope.eventInstanceId);
}

function getOperation(runtime: RuntimeKernel, envelope: ExecutionEnvelope): MutableOperationState {
  const operation = getCoordinator(runtime).operations.get(envelope.operationId);
  if (operation) return operation;
  // Synchronous `dispatchSync` does not emit a queued record. It still gets an
  // exact operation entry before any runner, commit, or effect outcome arrives.
  acceptEnvelope(runtime, envelope);
  return getCoordinator(runtime).operations.get(envelope.operationId)!;
}

function settleIfComplete(operation: MutableOperationState): void {
  if (operation.pendingEventInstanceIds.size > 0 || isTerminal(operation.status)) return;
  if (operation.pendingPublishedRevision !== undefined) {
    operation.status = 'publishing';
    return;
  }
  operation.status = operation.hasNonTerminalError ? 'completed-with-errors' : 'completed';
}

function updateEventStatus(
  operation: MutableOperationState,
  envelope: ExecutionEnvelope,
  status: MutableOperationEventState['status'],
): void {
  const event = operation.events.get(envelope.eventInstanceId);
  if (event) event.status = status;
}

function completeEvent(operation: MutableOperationState, envelope: ExecutionEnvelope): void {
  const event = operation.events.get(envelope.eventInstanceId);
  if (event?.status === 'queued' || event?.status === 'running') event.status = 'completed';
}

function recordError(operation: MutableOperationState, error: unknown): void {
  if (error !== undefined && !operation.errors.includes(error)) operation.errors.push(error);
}

function isTerminal(status: OperationStatus): boolean {
  return (
    status === 'completed' ||
    status === 'completed-with-errors' ||
    status === 'rejected' ||
    status === 'failed'
  );
}

function pruneTerminalOperations(coordinator: OperationCoordinatorState): void {
  while (coordinator.operations.size > MAX_RETAINED_OPERATION_SNAPSHOTS) {
    const terminal = [...coordinator.operations.entries()].find(
      ([, operation]) =>
        isTerminal(operation.status) && operation.pendingEventInstanceIds.size === 0,
    );
    if (!terminal) return;
    coordinator.operations.delete(terminal[0]);
  }
}
