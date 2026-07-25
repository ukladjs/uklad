export interface CommitResult {
  readonly status: 'committed' | 'unchanged' | 'skipped';
  readonly committedRevision: number;
}

/** Construct probe evidence only for an observed event. */
export function createCommitResult(
  status: CommitResult['status'],
  committedRevision: number,
): CommitResult {
  return Object.freeze({
    status,
    committedRevision,
  });
}
