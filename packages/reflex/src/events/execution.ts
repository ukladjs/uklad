import { consoleLog } from '../core/logging';
import { notifyTrackedRuntimeEvent } from '../runtime/probe';
import { createCommitResult } from './committer';
import { executeEffects } from './effect-executor';
import type { ExecutionEnvelope } from './envelope';
import { runEvent } from './runner';

import type { RuntimeCore } from '../runtime/core';
import type { RuntimeProbeTransition } from '../runtime/probe-types';

/**
 * Coordinate one envelope through runner → commit → effects. Instrumentation is
 * projected passively through the envelope's optional tracking context.
 */
export function executeEventEnvelope(runtime: RuntimeCore, envelope: ExecutionEnvelope): void {
  const event = envelope.event;
  const tracking = envelope.tracking;
  if (tracking) {
    notifyTrackedRuntimeEvent(tracking, 'eventStarted', runtime.state.committedRevision);
  }

  let error: unknown;
  let finishedStatus: 'completed' | 'failed' = 'completed';
  runtime.events.handlingEventId = envelope.event[0];
  runtime.events.handlingEnvelope = envelope;
  try {
    const result = runEvent(runtime, event);
    let transitionError = result.error;
    if (result.status === 'missing-handler') {
      const missingHandlerError = new Error(`no event handler registered for: ${event[0]}`);
      consoleLog('error', '[reflex] no event handler registered for:', event[0]);
      transitionError = missingHandlerError;
    }

    if (tracking) {
      notifyTrackedRuntimeEvent(
        tracking,
        'transition',
        Object.freeze({
          ...result,
          ...(transitionError === undefined ? {} : { error: transitionError }),
        }) satisfies RuntimeProbeTransition,
      );
    }

    if (result.status !== 'completed' || result.candidateState === undefined) {
      if (tracking) {
        notifyTrackedRuntimeEvent(
          tracking,
          'committed',
          createCommitResult('skipped', runtime.state.committedRevision),
        );
      }
      return;
    }

    const previousRevision = runtime.state.committedRevision;
    const committedRevision = runtime.state.commit(result.candidateState);
    if (tracking) {
      notifyTrackedRuntimeEvent(
        tracking,
        'committed',
        createCommitResult(
          committedRevision === previousRevision ? 'unchanged' : 'committed',
          committedRevision,
        ),
      );
    }
    for (const invalidEffects of result.invalidEffects) {
      executeEffects(runtime, envelope, invalidEffects);
    }
    executeEffects(runtime, envelope, result.effects);
  } catch (caughtError: unknown) {
    error = caughtError;
    finishedStatus = 'failed';
    if (tracking) {
      notifyTrackedRuntimeEvent(
        tracking,
        'transition',
        Object.freeze({
          status: 'failed',
          error: caughtError,
        }) satisfies RuntimeProbeTransition,
      );
    }
    throw caughtError;
  } finally {
    runtime.events.handlingEventId = null;
    runtime.events.handlingEnvelope = null;
    if (tracking) {
      notifyTrackedRuntimeEvent(tracking, 'eventFinished', finishedStatus, error);
    }
  }
}
