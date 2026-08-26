import { DISPOSED_ERROR, HYDRATION_ERROR, PURGE_ERROR, createPersistLifecycle } from '../lifecycle';

describe('persistence lifecycle', () => {
  it('authenticates generations and makes hydrated attempts idempotent', async () => {
    const lifecycle = createPersistLifecycle();
    const generation = lifecycle.acceptSyncHydration();
    expect(generation).toBe(1);
    expect(lifecycle.state).toBe('hydrating');
    expect(lifecycle.completeHydration('hydrated', generation!)).toBe(true);
    await expect(lifecycle.whenHydrated()).resolves.toBeUndefined();
    expect(lifecycle.acceptSyncHydration()).toBeUndefined();
    expect(lifecycle.completeHydration('failed', generation!)).toBe(false);
    expect(lifecycle.state).toBe('hydrated');
  });

  it('keeps a waiter attached to a queued retry after failure', async () => {
    const lifecycle = createPersistLifecycle();
    const first = lifecycle.acceptSyncHydration()!;
    lifecycle.completeHydration('failed', first);
    await expect(lifecycle.whenHydrated()).rejects.toThrow(HYDRATION_ERROR);

    const second = lifecycle.queueAsyncHydration('retry')!;
    const pending = lifecycle.whenHydrated();
    expect(lifecycle.acceptAsyncHydration('retry', second)).toBe(second);
    lifecycle.consumeQueuedHydrationRequest('retry');
    lifecycle.completeHydration('hydrated', second);
    await expect(pending).resolves.toBeUndefined();
  });

  it('settles only purge tickets accepted by an attempt', async () => {
    const lifecycle = createPersistLifecycle();
    const first = lifecycle.createPurgeTicket('first');
    const second = lifecycle.createPurgeTicket('second');

    expect(lifecycle.admitPurge('first')).toBe('start');
    expect(lifecycle.beginPurge('first')).toBe(true);
    lifecycle.completePurge('hydrated');
    await expect(first.promise).resolves.toBeUndefined();

    expect(lifecycle.cancelPurge(second)).toBe(true);
    await expect(second.promise).rejects.toThrow(PURGE_ERROR);
  });

  it('rejects every pending barrier on disposal', async () => {
    const lifecycle = createPersistLifecycle();
    const hydration = lifecycle.whenHydrated();
    const purge = lifecycle.createPurgeTicket('purge').promise;

    lifecycle.dispose();

    await expect(hydration).rejects.toThrow(DISPOSED_ERROR);
    await expect(purge).rejects.toThrow(DISPOSED_ERROR);
    expect(lifecycle.disposed).toBe(true);
  });
});
