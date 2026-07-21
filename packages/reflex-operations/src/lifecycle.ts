import type { ReflexRuntime } from '@flexsurfer/reflex';

import {
  appendEvent,
  createEventInstanceId,
  failDisposed,
  finalizeOperation,
  normalizeError,
  recordEffect,
  recordError,
  rejectOperation,
  recordPublishedSubscriptions,
  requestFinalization,
} from './ledger.js';
import { MAX_PATCHES_PER_EVENT } from './limits.js';
import { hasFatalEventError } from './receipt.js';
import type { OperationState } from './state.js';
import { copyOperationPatch, copyPatch, snapshotValue, timestamp } from './values.js';

/** Translate generic runtime lifecycle evidence into mutable operation ledger records. */
export function observeOperationLifecycle(runtime: ReflexRuntime<any>, state: OperationState): void {
  runtime.observeLifecycle({
    onEventQueued(event) {
      const root = state.pendingRoot;
      if (root) {
        state.pendingRoot = null;
        state.eventMetadata.set(event, root);
        return;
      }
      const parent = state.currentEvent;
      if (!parent || parent.operation.terminal) return;
      const eventInstanceId = createEventInstanceId(runtime, state);
      const eventRecord = appendEvent(parent.operation, eventInstanceId, parent.eventInstanceId, event);
      parent.operation.pendingEvents++;
      state.eventMetadata.set(event, { operation: parent.operation, eventInstanceId, eventRecord });
    },
    onEventStarted(event, committedRevision) {
      const metadata = state.eventMetadata.get(event);
      if (!metadata) return;
      const operation = metadata.operation;
      if (metadata.eventInstanceId === operation.rootEventInstanceId) {
        operation.rootStartRevision = committedRevision;
        if (operation.expectedRevision !== null && operation.expectedRevision !== committedRevision) {
          rejectOperation(
            operation,
            'revision-conflict',
            `Expected state revision ${operation.expectedRevision}, but the runtime was at revision ${committedRevision} when the root event was ready to start.`,
          );
          return true;
        }
      }
      state.currentEvent = metadata;
      const now = timestamp();
      if (operation.status === 'queued') operation.status = 'running';
      operation.startedAt ??= now;
      if (metadata.eventRecord) {
        metadata.eventRecord.status = 'running';
        metadata.eventRecord.startedAt = now;
        metadata.eventRecord.state.fromRevision = committedRevision;
      }
      return undefined;
    },
    onEventError(kind, error) {
      const metadata = state.currentEvent;
      if (!metadata) return;
      recordError(metadata.operation, metadata.eventRecord, normalizeError(kind, error, metadata.eventInstanceId));
      return kind === 'coeffect' || kind === 'missing-coeffect';
    },
    onStatePlanned(plan) {
      const record = state.currentEvent?.eventRecord;
      if (!record) return;
      const patches = plan.patches.slice(0, MAX_PATCHES_PER_EVENT).map(copyPatch);
      record.state.plannedPatches = patches;
      record.state.truncated = plan.patches.length > patches.length;
      record.plannedDb = plan.plannedDb;
    },
    onStateCommitted(_previous, next, revision) {
      const metadata = state.currentEvent;
      if (!metadata) return;
      const { operation, eventRecord } = metadata;
      operation.lastCommittedRevision = revision;
      operation.committedRevisions.push(revision);
      if (!eventRecord) return;
      eventRecord.state.status = 'committed';
      eventRecord.state.committedRevision = revision;
      eventRecord.state.committedPatches =
        eventRecord.plannedDb === next
          ? eventRecord.state.plannedPatches.map(copyOperationPatch)
          : [{ op: 'replace', path: [], value: snapshotValue(next) }];
    },
    onEffects() {
      // The per-effect callback below is the authoritative execution record.
    },
    onEffect(effect) {
      const metadata = state.currentEvent;
      if (!metadata) return;
      recordEffect(runtime, state, metadata, effect);
    },
    onEventFinished(event, error) {
      const metadata = state.eventMetadata.get(event);
      if (!metadata) return;
      if (state.currentEvent === metadata) state.currentEvent = null;
      const { operation, eventRecord } = metadata;
      if (operation.terminal) return;
      if (error !== undefined) {
        recordError(operation, eventRecord, normalizeError('handler', error, metadata.eventInstanceId));
      }
      if (eventRecord) {
        eventRecord.completedAt = timestamp();
        if (eventRecord.state.status === 'not-attempted' && !hasFatalEventError(eventRecord)) {
          eventRecord.state.status = 'unchanged';
        }
        eventRecord.status = hasFatalEventError(eventRecord) ? 'failed' : 'completed';
      }
      operation.pendingEvents = Math.max(0, operation.pendingEvents - 1);
      if (operation.pendingEvents === 0) {
        operation.readyToPublish = true;
        requestFinalization(runtime, state, operation);
      }
    },
    onEventDropped(events, reason, error) {
      for (const event of events) {
        const metadata = state.eventMetadata.get(event);
        if (!metadata || metadata.operation.terminal) continue;
        const operationError = normalizeError(reason, error, metadata.eventInstanceId);
        recordError(metadata.operation, metadata.eventRecord, operationError);
        if (metadata.eventRecord) {
          metadata.eventRecord.status = 'dropped';
          metadata.eventRecord.completedAt = timestamp();
        }
        metadata.operation.pendingEvents = Math.max(0, metadata.operation.pendingEvents - 1);
        if (metadata.operation.pendingEvents === 0) {
          metadata.operation.readyToPublish = true;
          requestFinalization(runtime, state, metadata.operation);
        }
      }
    },
    onStatePublished(_db, revision, recalculated) {
      state.knownPublishedRevision = revision;
      for (const operation of state.operations.values()) {
        if (
          operation.readyToPublish &&
          !operation.terminal &&
          (operation.lastCommittedRevision === null || revision >= operation.lastCommittedRevision)
        ) {
          // An operation that never committed state must not claim a
          // concurrent operation's publication wave as its own.
          if (operation.lastCommittedRevision !== null) {
            recordPublishedSubscriptions(operation, recalculated);
          }
          finalizeOperation(runtime, state, operation);
        }
      }
    },
    getTraceTags() {
      const metadata = state.currentEvent;
      if (!metadata) return {};
      return {
        operationId: metadata.operation.operationId,
        eventInstanceId: metadata.eventInstanceId,
        parentEventInstanceId: metadata.eventRecord?.parentEventInstanceId ?? null,
        runtimeInstanceId: runtime.runtimeInstanceId,
      };
    },
    onRuntimeDisposed() {
      for (const operation of state.operations.values()) {
        if (operation.terminal) continue;
        failDisposed(operation);
      }
    },
  });
}
