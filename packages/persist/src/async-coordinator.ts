const DISPOSED_ERROR = '[uklad-persist] Disposed before operation completed.';
const FLUSH_ERROR = '[uklad-persist] One or more storage writes failed.';

export interface AsyncTaskTicket {
  readonly sequence: number;
  readonly promise: Promise<void>;
}

export interface AsyncCoordinator {
  /** Queue one operation behind earlier operations for the same storage key. */
  enqueue(
    key: string,
    operation: () => Promise<void>,
    options?: { readonly trackFailure?: boolean; readonly coalesce?: boolean },
  ): AsyncTaskTicket;
  /** Wait for all operations accepted before the call to settle. */
  flush(): Promise<void>;
  /** Stop queued operations and wait for already-started storage work to settle. */
  dispose(): Promise<void> | undefined;
}

/**
 * Ordered per-key async work coordinator.
 *
 * Storage engines are allowed to complete independent keys concurrently, but
 * operations for one key are strictly serialized. Rejected operations do not
 * poison the key tail; the next operation still starts after the failure.
 */
export function createAsyncCoordinator(): AsyncCoordinator {
  let disposed = false;
  let nextSequence = 0;
  let resolveDisposed: (() => void) | undefined;
  const disposedSignal = new Promise<void>((resolve) => {
    resolveDisposed = resolve;
  });
  const tails = new Map<string, Promise<void>>();
  const tickets = new Map<number, Promise<void>>();
  const queuedCoalescible = new Map<
    string,
    {
      readonly state: {
        operation: () => Promise<void>;
        readonly sequences: Map<number, boolean>;
      };
      readonly promise: Promise<void>;
    }
  >();
  /**
   * Storage failures stay visible until a later successful operation for the
   * same key supersedes them. Keeping the resolution sequence lets a flush
   * whose snapshot predates that success still report the failure.
   */
  const failures = new Map<number, { readonly key: string; resolvedBy?: number }>();

  function enqueue(
    key: string,
    operation: () => Promise<void>,
    options?: { readonly trackFailure?: boolean; readonly coalesce?: boolean },
  ): AsyncTaskTicket {
    if (disposed) throw new Error(DISPOSED_ERROR);

    const sequence = ++nextSequence;
    const queued = options?.coalesce === true ? queuedCoalescible.get(key) : undefined;
    if (queued) {
      queued.state.operation = operation;
      queued.state.sequences.set(sequence, options?.trackFailure !== false);
      const ticket = queued.promise;
      tickets.set(sequence, ticket);
      return { sequence, promise: ticket };
    }

    // A non-coalescible operation is an ordering barrier. Later writes must
    // queue behind it rather than replacing an earlier write across it.
    queuedCoalescible.delete(key);
    const previous = tails.get(key) ?? Promise.resolve();
    const sequences = new Map([[sequence, options?.trackFailure !== false]]);
    const state = { operation, sequences };
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposed) throw new Error(DISPOSED_ERROR);
        if (queuedCoalescible.get(key)?.state === state) queuedCoalescible.delete(key);
        try {
          const result = await state.operation();
          if (!disposed) {
            const latestSequence = Math.max(...state.sequences.keys());
            for (const failure of failures.values()) {
              if (failure.key === key && failure.resolvedBy === undefined) {
                failure.resolvedBy = latestSequence;
              }
            }
          }
          return result;
        } catch (error) {
          if (!disposed) {
            for (const [acceptedSequence, trackFailure] of state.sequences) {
              if (trackFailure) failures.set(acceptedSequence, { key });
            }
          }
          throw error;
        }
      });
    const task = { state, promise: run };
    if (options?.coalesce === true) queuedCoalescible.set(key, task);

    const ticket = run;
    tickets.set(sequence, ticket);
    tails.set(key, run);
    void run
      .finally(() => {
        for (const acceptedSequence of state.sequences.keys()) tickets.delete(acceptedSequence);
        if (queuedCoalescible.get(key) === task) queuedCoalescible.delete(key);
        if (tails.get(key) === run) tails.delete(key);
      })
      .catch(() => {
        // The ticket owns the rejection; the coordinator must never create an
        // unhandled rejection from its internal cleanup chain.
      });
    return { sequence, promise: ticket };
  }

  async function flush(): Promise<void> {
    if (disposed) throw new Error(DISPOSED_ERROR);
    const targetSequence = nextSequence;
    const pending = [...tickets.entries()]
      .filter(([sequence]) => sequence <= targetSequence)
      .map(([, promise]) => promise);

    const pendingResult = Promise.allSettled(pending).then(() => undefined);
    await Promise.race([pendingResult, disposedSignal]);
    if (disposed) throw new Error(DISPOSED_ERROR);

    for (const [sequence, failure] of failures) {
      if (sequence > targetSequence) continue;
      if (failure.resolvedBy === undefined || failure.resolvedBy > targetSequence) {
        throw new Error(FLUSH_ERROR);
      }
    }
  }

  let disposalBarrier: Promise<void> | undefined;

  function dispose(): Promise<void> | undefined {
    if (disposed) return disposalBarrier;
    disposed = true;
    const accepted = [...tickets.values()];
    tails.clear();
    queuedCoalescible.clear();
    failures.clear();
    resolveDisposed?.();
    if (accepted.length > 0) {
      disposalBarrier = Promise.allSettled(accepted).then(() => undefined);
    }
    return disposalBarrier;
  }

  return { enqueue, flush, dispose };
}
