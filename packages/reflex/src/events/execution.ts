import { consoleLog } from '../core/logging';
import { mergeOptionalTraceForKernel, withOptionalTraceForKernel } from '../core/tracing';
import {
  beginRuntimeLifecycleEventForKernel,
  getRuntimeLifecycleTraceTagsForKernel,
  notifyRuntimeLifecycleForKernel,
  reportRuntimeLifecycleErrorForKernel,
} from '../runtime/lifecycle';
import { getStateRevisionsForKernel } from '../runtime/state';
import { commitTransitionForKernel, skipCommitForKernel } from './committer';
import { executeEffectsForKernel } from './effect-executor';
import type { ExecutionEnvelope } from './envelope';
import { notifyDevelopmentExecutionForKernel } from './execution-observer';
import { createExecutionEnvelopeForKernel } from './router';
import { runEventForKernel } from './runner';
import { beginHandlingEventForKernel, endHandlingEventForKernel } from './runner';

import type { EventVector, TraceErrorTag } from '../types';
import type { RuntimeKernel } from '../runtime/kernel';

/**
 * Coordinate one envelope through the legacy event runner, a single commit
 * decision, and post-commit effects. This is the sole place where those
 * components are composed.
 */
export function executeEventEnvelopeForKernel(
  runtime: RuntimeKernel,
  envelope: ExecutionEnvelope,
): void {
  const event = envelope.event;
  const acceptedRevision = getStateRevisionsForKernel(runtime).committedRevision;

  if (beginRuntimeLifecycleEventForKernel(runtime, event, acceptedRevision)) {
    if (envelope.operation) {
      notifyDevelopmentExecutionForKernel(runtime, 'transition', envelope.operation, 'aborted');
      notifyDevelopmentExecutionForKernel(runtime, 'finished', envelope.operation, 'rejected');
    }
    notifyRuntimeLifecycleForKernel(runtime, 'onEventFinished', event);
    return;
  }

  if (envelope.operation)
    notifyDevelopmentExecutionForKernel(runtime, 'started', envelope.operation, acceptedRevision);

  let error: unknown;
  let finishedStatus: 'completed' | 'failed' = 'completed';
  beginHandlingEventForKernel(runtime, envelope);
  try {
    withOptionalTraceForKernel(
      runtime,
      () => ({
        operation: event[0],
        opType: 'event',
        tags: { event, ...getRuntimeLifecycleTraceTagsForKernel(runtime) },
      }),
      () => {
        const result = runEventForKernel(runtime, event);
        let transitionError = result.error;
        if (result.status === 'missing-handler') {
          const missingHandlerError = new Error(`no event handler registered for: ${event[0]}`);
          consoleLog('error', '[reflex] no event handler registered for:', event[0]);
          const traceError: TraceErrorTag = {
            phase: 'missing-handler',
            message: missingHandlerError.message,
            eventV: event,
          };
          reportRuntimeLifecycleErrorForKernel(runtime, 'missing-handler', missingHandlerError);
          mergeOptionalTraceForKernel(runtime, () => ({ error: traceError }));
          transitionError = missingHandlerError;
        }

        if (envelope.operation)
          notifyDevelopmentExecutionForKernel(
            runtime,
            'transition',
            envelope.operation,
            result.status,
            transitionError,
          );

        if (result.status !== 'completed' || result.candidateState === undefined) {
          const commit = skipCommitForKernel(runtime);
          if (envelope.operation)
            notifyDevelopmentExecutionForKernel(
              runtime,
              'committed',
              envelope.operation,
              commit.status,
              commit.committedRevision,
            );
          return;
        }

        const commit = commitTransitionForKernel(runtime, result.candidateState);
        if (envelope.operation)
          notifyDevelopmentExecutionForKernel(
            runtime,
            'committed',
            envelope.operation,
            commit.status,
            commit.committedRevision,
          );
        for (const invalidEffects of result.invalidEffects)
          executeEffectsForKernel(runtime, envelope, invalidEffects);
        executeEffectsForKernel(runtime, envelope, result.effects);
      },
    );
  } catch (caughtError: unknown) {
    error = caughtError;
    finishedStatus = 'failed';
    if (envelope.operation)
      notifyDevelopmentExecutionForKernel(
        runtime,
        'transition',
        envelope.operation,
        'failed',
        caughtError,
      );
    throw caughtError;
  } finally {
    endHandlingEventForKernel(runtime);
    if (envelope.operation)
      notifyDevelopmentExecutionForKernel(
        runtime,
        'finished',
        envelope.operation,
        finishedStatus,
        error,
      );
    notifyRuntimeLifecycleForKernel(runtime, 'onEventFinished', event, error);
  }
}

/** @internal Legacy direct entry point for synchronous callers and tests. */
export function handleForKernel(runtime: RuntimeKernel, event: EventVector): void {
  executeEventEnvelopeForKernel(runtime, createExecutionEnvelopeForKernel(runtime, event));
}
