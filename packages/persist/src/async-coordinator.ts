const DISPOSED_ERROR = '[uklad-persist] Disposed before operation completed.';
const FLUSH_ERROR = '[uklad-persist] One or more storage writes failed.';

export interface AsyncTaskTicket<T> {
  readonly sequence: number;
  readonly promise: Promise<T>;
}

export interface AsyncCoordinator {
  /** Queue one operation behind earlier operations for the same storage key. */
  enqueue<T>(
    key: string,
    operation: () => Promise<T>,
    options?: { readonly trackFailure?: boolean },
  ): AsyncTaskTicket<T>;
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
  const tails = new Map<string, Promise<unknown>>();
  const tickets = new Map<number, Promise<unknown>>();
  /**
   * Storage failures stay visible until a later successful operation for the
   * same key supersedes them. Keeping the resolution sequence lets a flush
   * whose snapshot predates that success still report the failure.
   */
  const failures = new Map<number, { readonly key: string; resolvedBy?: number }>();

  function enqueue<T>(
    key: string,
    operation: () => Promise<T>,
    options?: { readonly trackFailure?: boolean },
  ): AsyncTaskTicket<T> {
    if (disposed) throw new Error(DISPOSED_ERROR);

    const sequence = ++nextSequence;
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        if (disposed) throw new Error(DISPOSED_ERROR);
        try {
          const result = await operation();
          if (!disposed) {
            for (const failure of failures.values()) {
              if (failure.key === key && failure.resolvedBy === undefined) {
                failure.resolvedBy = sequence;
              }
            }
          }
          return result;
        } catch (error) {
          if (!disposed && options?.trackFailure !== false) failures.set(sequence, { key });
          throw error;
        }
      });

    const ticket = run as Promise<T>;
    tickets.set(sequence, ticket);
    tails.set(key, run);
    void run
      .finally(() => {
        tickets.delete(sequence);
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
    failures.clear();
    resolveDisposed?.();
    if (accepted.length > 0) {
      disposalBarrier = Promise.allSettled(accepted).then(() => undefined);
    }
    return disposalBarrier;
  }

  return { enqueue, flush, dispose };
}
