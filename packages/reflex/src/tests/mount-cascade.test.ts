/**
 * Regression guard for mount recompute cascades: newly mounting subscribers
 * must reuse clean cached values of shared parent subscriptions instead of
 * re-running them once per mount. By-id row subs over a shared sorted list is
 * the recommended pattern, so this is the hot path.
 */
import {
  clearSubscriptionCache,
  dispatch,
  getOrCreateSubscription,
  getSubscriptionSnapshot,
  initState,
  regEvent,
  regSub,
  subscribeToSubscription,
} from './runtime-test-api';
import { waitForScheduled, waitForAnimationFrame, waitForSubscription } from './test-utils';

describe('Mount recompute cascades', () => {
  const ROWS = 50;

  let sortCount = 0;

  regSub('mc-items');
  regSub(
    'mc-sorted',
    (items: any[]) => {
      sortCount++;
      return [...(items || [])].sort((a, b) => a.order - b.order);
    },
    () => [['mc-items']],
  );
  regSub(
    'mc-by-id',
    (sorted: any[], id: number) => {
      return sorted.find((item) => item.id === id);
    },
    () => [['mc-sorted']],
  );

  beforeEach(() => {
    clearSubscriptionCache();
    sortCount = 0;
    initState({
      'mc-items': Array.from({ length: ROWS }, (_, i) => ({ id: i, order: ROWS - i })),
    });
  });

  it('should run a shared parent sub once while many by-id subscribers mount', () => {
    const cleanups: Array<() => void> = [];
    const callbacks: jest.Mock[] = [];

    // Mimic what useSubscription does per row: read a snapshot during render,
    // then subscribe on commit
    for (let id = 0; id < ROWS; id++) {
      const subscription = getOrCreateSubscription(['mc-by-id', id])!;
      expect(getSubscriptionSnapshot(subscription)).toEqual({ id, order: ROWS - id });
      const callback = jest.fn();
      callbacks.push(callback);
      cleanups.push(subscribeToSubscription(subscription, callback));
    }

    expect(sortCount).toBe(1);
    expect(callbacks.every((callback) => callback.mock.calls.length === 0)).toBe(true);

    for (const cleanup of cleanups) cleanup();
  });

  it('should recompute the shared parent once per flush when data changes', async () => {
    regEvent('mc-reorder', ({ draftState }) => {
      draftState['mc-items'][0].order = 999;
    });

    const cleanups: Array<() => void> = [];
    const callbacks: jest.Mock[] = [];
    for (let id = 0; id < ROWS; id++) {
      const subscription = getOrCreateSubscription(['mc-by-id', id])!;
      getSubscriptionSnapshot(subscription);
      const callback = jest.fn();
      callbacks.push(callback);
      cleanups.push(subscribeToSubscription(subscription, callback));
    }
    expect(sortCount).toBe(1);

    dispatch(['mc-reorder']);
    await waitForScheduled();
    await waitForAnimationFrame();
    await waitForSubscription();

    expect(sortCount).toBe(2);
    expect(callbacks[0]).toHaveBeenCalledTimes(1);
    expect(callbacks.slice(1).every((callback) => callback.mock.calls.length === 0)).toBe(true);

    for (const cleanup of cleanups) cleanup();
  });
});
