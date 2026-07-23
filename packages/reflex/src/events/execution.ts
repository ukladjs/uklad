import { consoleLog } from '../core/logging';
import { mergeTraceForKernel, withTraceForKernel } from '../core/tracing';
import {
  beginRuntimeLifecycleEventForKernel,
  getRuntimeLifecycleTraceTagsForKernel,
  notifyRuntimeLifecycleForKernel,
  reportRuntimeLifecycleErrorForKernel,
} from '../runtime/lifecycle';
import { getStateRevisionsForKernel } from '../runtime/state';
import { commitTransitionForKernel, skipCommitForKernel } from './committer';
import { executeEffectsForKernel } from './effect-executor';
import {
  createExecutionEnvelopeForKernel,
  recordExecutionOutcomeForKernel,
  type ExecutionEnvelope,
  type TransitionOutcome,
} from './outcomes';
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
    const transition: TransitionOutcome = Object.freeze({
      type: 'transition' as const,
      envelope,
      status: 'aborted' as const,
      previousState: undefined,
      effects: Object.freeze([]),
      invalidEffects: Object.freeze([]),
    });
    recordExecutionOutcomeForKernel(runtime, transition);
    recordExecutionOutcomeForKernel(runtime, {
      type: 'finished',
      envelope,
      status: 'rejected',
    });
    notifyRuntimeLifecycleForKernel(runtime, 'onEventFinished', event);
    return;
  }

  recordExecutionOutcomeForKernel(runtime, {
    type: 'started',
    envelope,
    committedRevision: acceptedRevision,
  });

  let error: unknown;
  let finishedStatus: 'completed' | 'failed' = 'completed';
  beginHandlingEventForKernel(runtime, envelope);
  try {
    withTraceForKernel(
      runtime,
      {
        operation: event[0],
        opType: 'event',
        tags: { event, ...getRuntimeLifecycleTraceTagsForKernel(runtime) },
      },
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
          mergeTraceForKernel(runtime, { tags: { error: traceError } });
          transitionError = missingHandlerError;
        }

        const transition: TransitionOutcome = Object.freeze({
          type: 'transition' as const,
          envelope,
          status: result.status,
          previousState: result.previousState,
          ...(result.candidateState === undefined ? {} : { candidateState: result.candidateState }),
          effects: result.effects,
          invalidEffects: result.invalidEffects,
          ...(transitionError === undefined ? {} : { error: transitionError }),
        });
        recordExecutionOutcomeForKernel(runtime, transition);

        if (result.status !== 'completed' || result.candidateState === undefined) {
          recordExecutionOutcomeForKernel(runtime, skipCommitForKernel(runtime, envelope));
          return;
        }

        recordExecutionOutcomeForKernel(
          runtime,
          commitTransitionForKernel(runtime, envelope, result.candidateState),
        );
        for (const [index, invalidEffects] of result.invalidEffects.entries()) {
          executeEffectsForKernel(runtime, envelope, invalidEffects, -1 - index);
        }
        executeEffectsForKernel(runtime, envelope, result.effects);
      },
    );
  } catch (caughtError: unknown) {
    error = caughtError;
    finishedStatus = 'failed';
    recordExecutionOutcomeForKernel(runtime, {
      type: 'transition',
      envelope,
      status: 'failed',
      previousState: undefined,
      effects: Object.freeze([]),
      invalidEffects: Object.freeze([]),
      error: caughtError,
    });
    throw caughtError;
  } finally {
    endHandlingEventForKernel(runtime);
    recordExecutionOutcomeForKernel(runtime, {
      type: 'finished',
      envelope,
      status: finishedStatus,
      ...(error === undefined ? {} : { error }),
    });
    notifyRuntimeLifecycleForKernel(runtime, 'onEventFinished', event, error);
  }
}

/** @internal Legacy direct entry point for synchronous callers and tests. */
export function handleForKernel(runtime: RuntimeKernel, event: EventVector): void {
  executeEventEnvelopeForKernel(runtime, createExecutionEnvelopeForKernel(runtime, event));
}
