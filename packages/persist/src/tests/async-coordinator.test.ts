import { createAsyncCoordinator } from '../async-coordinator';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('async persistence coordinator', () => {
  it('serializes operations per key while allowing independent keys to start', async () => {
    const coordinator = createAsyncCoordinator();
    const first = deferred<void>();
    const second = deferred<void>();
    const started: string[] = [];

    const firstTicket = coordinator.enqueue('todos', async () => {
      started.push('todos:first');
      await first.promise;
    });
    const secondTicket = coordinator.enqueue('todos', async () => {
      started.push('todos:second');
      await second.promise;
    });
    const settingsTicket = coordinator.enqueue('settings', async () => {
      started.push('settings:first');
    });

    await settingsTicket.promise;
    expect(started).toEqual(['todos:first', 'settings:first']);

    first.resolve();
    await firstTicket.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['todos:first', 'settings:first', 'todos:second']);

    second.resolve();
    await secondTicket.promise;
    await coordinator.flush();
  });

  it('keeps the queue usable after a failed operation and clears it after a later success', async () => {
    const coordinator = createAsyncCoordinator();
    const failure = coordinator.enqueue('count', async () => {
      throw new Error('storage failure must not leak');
    });

    await expect(failure.promise).rejects.toThrow();
    await expect(coordinator.flush()).rejects.toThrow('storage writes failed');

    const succeeding = coordinator.enqueue('count', async () => undefined);
    await expect(succeeding.promise).resolves.toBeUndefined();
    await expect(coordinator.flush()).resolves.toBeUndefined();
  });

  it('gives concurrent flush callers the same result for a failed write', async () => {
    const coordinator = createAsyncCoordinator();
    const failure = coordinator.enqueue('count', async () => {
      throw new Error('storage failure must not leak');
    });

    await expect(failure.promise).rejects.toThrow();
    const results = await Promise.allSettled([coordinator.flush(), coordinator.flush()]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
  });

  it('can leave non-write lifecycle failures out of the durability barrier', async () => {
    const coordinator = createAsyncCoordinator();
    const removal = coordinator.enqueue(
      'count',
      async () => {
        throw new Error('purge failure');
      },
      { trackFailure: false },
    );

    await expect(removal.promise).rejects.toThrow();
    await expect(coordinator.flush()).resolves.toBeUndefined();
  });

  it('rejects a pending flush when disposed', async () => {
    const coordinator = createAsyncCoordinator();
    const pending = deferred<void>();
    coordinator.enqueue('count', async () => pending.promise);
    const flush = coordinator.flush();

    const disposal = coordinator.dispose();
    await expect(flush).rejects.toThrow('Disposed before operation completed');
    expect(disposal).toBeDefined();
    pending.resolve();
    await expect(disposal).resolves.toBeUndefined();
  });

  it('cancels queued work and keeps disposal pending until active work settles', async () => {
    const coordinator = createAsyncCoordinator();
    const active = deferred<void>();
    const started: string[] = [];
    coordinator.enqueue('count', async () => {
      started.push('active');
      await active.promise;
    });
    const queued = coordinator.enqueue('count', async () => {
      started.push('queued');
    });
    const queuedFailure = expect(queued.promise).rejects.toThrow(
      'Disposed before operation completed',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const disposal = coordinator.dispose();
    expect(disposal).toBeDefined();
    expect(started).toEqual(['active']);

    active.resolve();
    await expect(disposal).resolves.toBeUndefined();
    await queuedFailure;
    expect(started).toEqual(['active']);
  });
});
