import { getStateRevisionsForKernel, updateStateForKernel } from '../runtime/state';

import type { RuntimeKernel } from '../runtime/kernel';
import type { CommitOutcome, ExecutionEnvelope } from './outcomes';

/**
 * Install the state candidate produced by an event runner.
 *
 * This is deliberately separate from interceptors and effects: an event can
 * plan state, the committer makes exactly one commit decision, and only then
 * may external effects execute.
 */
export function commitTransitionForKernel(
  runtime: RuntimeKernel,
  envelope: ExecutionEnvelope,
  candidateState: unknown,
): CommitOutcome {
  const before = getStateRevisionsForKernel(runtime).committedRevision;
  const committedRevision = updateStateForKernel(runtime, candidateState);

  return Object.freeze({
    type: 'commit' as const,
    envelope,
    status: committedRevision === before ? ('unchanged' as const) : ('committed' as const),
    committedRevision,
  });
}

/** @internal Record that an event did not produce a state candidate. */
export function skipCommitForKernel(
  runtime: RuntimeKernel,
  envelope: ExecutionEnvelope,
): CommitOutcome {
  return Object.freeze({
    type: 'commit' as const,
    envelope,
    status: 'skipped' as const,
    committedRevision: getStateRevisionsForKernel(runtime).committedRevision,
  });
}
