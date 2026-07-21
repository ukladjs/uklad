import type { DevtoolsOperationRuntime } from './runtime.js';

import { MAX_OPERATIONS, MAX_PATCHES_PER_EVENT } from './limits.js';
import type { MutableEvent, MutableOperation, OperationState } from './state.js';
import type {
  OperationEffectResult,
  OperationEffectsSummary,
  OperationObservationResult,
  OperationOutcome,
  OperationRecalculatedSubscription,
  OperationReceipt,
  OperationStateSummary,
  OperationSubscriptionsSummary,
} from './types.js';
import {
  cloneEvent,
  cloneExecutionContext,
  cloneQuery,
  copyError,
  copyOperationPatch,
  snapshotValue,
} from './values.js';

export function snapshotOperation(
  runtime: DevtoolsOperationRuntime,
  state: OperationState,
  operation: MutableOperation,
): OperationReceipt {
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
        operation.observedRevision > operation.acceptedRevision + operation.committedRevisions.length,
    },
    events: operation.events.map(snapshotEvent),
    state: stateSummary,
    subscriptions: snapshotSubscriptions(operation),
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
      currentlyRetained: state.operations.get(operation.operationId) === operation,
      terminalEvictionPolicy: 'oldest-terminal',
    },
  };
}

function snapshotSubscriptions(operation: MutableOperation): OperationSubscriptionsSummary {
  return {
    status: 'settled',
    publishedRevision: operation.publishedRevision,
    recalculated: operation.recalculatedSubscriptions.map(snapshotSubscription),
  };
}

export function summarizeState(operation: MutableOperation): OperationStateSummary {
  const committed = operation.events.filter((event) => event.state.status === 'committed');
  const patches = committed.flatMap((event) => event.state.committedPatches);
  const truncated = committed.some((event) => event.state.truncated) || patches.length > MAX_PATCHES_PER_EVENT;
  const hasHandlerFailure = operation.errors.some((error) =>
    ['handler', 'missing-handler', 'coeffect', 'missing-coeffect', 'queue-dropped', 'disposed', 'publication'].includes(error.kind),
  );
  return {
    status:
      committed.length > 0
        ? hasHandlerFailure
          ? 'partially-committed'
          : 'committed'
        : hasHandlerFailure
          ? 'failed'
          : 'unchanged',
    patches: patches.slice(0, MAX_PATCHES_PER_EVENT).map(copyOperationPatch),
    truncated,
  };
}

export function summarizeEffects(operation: MutableOperation): OperationEffectsSummary {
  const hasFailure = operation.effects.some((effect) =>
    ['failed', 'unhandled', 'invalid'].includes(effect.status),
  );
  const hasIncomplete = operation.effects.some((effect) =>
    ['detached', 'returned'].includes(effect.status),
  );
  return {
    status: operation.effectsTruncated
      ? 'incomplete'
      : operation.effects.length === 0
        ? 'none'
        : hasFailure
          ? 'failed'
          : hasIncomplete
            ? 'incomplete'
            : 'succeeded',
    items: operation.effects.map(snapshotEffect),
    truncated: operation.effectsTruncated,
  };
}

export function deriveOutcome(operation: MutableOperation): OperationOutcome {
  if (operation.status === 'rejected') return 'rejected';
  if (hasFatalErrors(operation)) return 'failed';
  const effects = summarizeEffects(operation);
  if (effects.status === 'failed') return 'effects-failed';
  if (effects.status === 'incomplete' || operation.eventsTruncated || operation.errorsTruncated || summarizeState(operation).truncated) {
    return 'incomplete';
  }
  return 'succeeded';
}

export function hasFatalErrors(operation: MutableOperation): boolean {
  return operation.errors.some(
    (error) => !['effect', 'invalid-effect', 'unhandled-effect'].includes(error.kind),
  );
}

export function hasFatalEventError(event: MutableEvent): boolean {
  return event.errors.some(
    (error) => !['effect', 'invalid-effect', 'unhandled-effect'].includes(error.kind),
  );
}

function snapshotEvent(event: MutableEvent) {
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

function snapshotObservation(value: OperationObservationResult): OperationObservationResult {
  return {
    query: cloneQuery(value.query),
    status: value.status,
    ...('value' in value ? { value: snapshotValue(value.value) } : {}),
    ...(value.error ? { error: copyError(value.error) } : {}),
  };
}

function snapshotEffect(effect: OperationEffectResult): OperationEffectResult {
  return {
    ...effect,
    value: snapshotValue(effect.value),
    ...(effect.error ? { error: copyError(effect.error) } : {}),
  };
}

function snapshotSubscription(
  subscription: OperationRecalculatedSubscription,
): OperationRecalculatedSubscription {
  return {
    key: subscription.key,
    query: cloneQuery(subscription.query),
    kind: subscription.kind,
    active: subscription.active,
    version: subscription.version,
    status: subscription.status,
    ...(subscription.status === 'value' ? { value: snapshotValue(subscription.value) } : {}),
    ...(subscription.status === 'error' ? { error: subscription.error ?? '[Unknown subscription error]' } : {}),
  };
}
