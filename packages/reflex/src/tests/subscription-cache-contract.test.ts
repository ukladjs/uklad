import {
  clearHandlers,
  clearSubscriptionCache,
  clearSubsForHotReload,
  dispatch,
  getOrCreateSubscription,
  getSubscriptionSnapshot,
  getSubscriptionValue,
  initState,
  readSubscription,
  regEvent,
  regSub,
  subscribeToSubscription,
} from './runtime-test-api';
import { waitForAnimationFrame, waitForSubscription, waitForScheduled } from './test-utils';

const waitForFlush = async () => {
  await waitForAnimationFrame();
  await waitForSubscription();
};

let mappedRuns = 0;
let lengthRuns = 0;
let selectedRuns = 0;

describe('Subscription cache contract', () => {
  regSub('cache-items');
  regSub(
    'cache-count',
    (items: number[]) => (items || []).length,
    () => [['cache-items']],
  );
  regSub(
    'cache-even-items',
    (items: number[]) => (items || []).filter((item) => item % 2 === 0),
    () => [['cache-items']],
  );
  regSub(
    'cache-even-count',
    (items: number[]) => items.length,
    () => [['cache-even-items']],
  );
  regSub('cache-revive-source');
  regSub(
    'cache-revive-double',
    (value: number) => value * 2,
    () => [['cache-revive-source']],
  );
  regSub(
    'cache-default-mapped',
    (items: number[]) => {
      mappedRuns++;
      return items.map((item) => item);
    },
    () => [['cache-items']],
  );
  regSub(
    'cache-default-length',
    (items: number[]) => {
      lengthRuns++;
      return items.length;
    },
    () => [['cache-default-mapped']],
  );
  regSub('cache-selected');
  regSub(
    'cache-selected-value',
    (selected: string | undefined) => {
      selectedRuns++;
      return selected;
    },
    () => [['cache-selected']],
  );
  regSub('cache-shared-source');
  regSub(
    'cache-shared-dependency',
    (value: number) => value * 2,
    () => [['cache-shared-source']],
  );
  regSub(
    'cache-dormant-parent',
    (value: number) => value + 1,
    () => [['cache-shared-dependency']],
  );
  regSub(
    'cache-live-sibling',
    (value: number) => value + 10,
    () => [['cache-shared-dependency']],
  );
  regSub(
    'cache-param-select',
    (value: number, offset: number) => value + offset,
    () => [['cache-shared-source']],
  );
  regSub(
    'cache-param-parent',
    (value: number) => value * 10,
    (offset: number) => [['cache-param-select', offset]],
  );

  regEvent('cache-add-item', ({ draftState }, item: number) => {
    draftState['cache-items'].push(item);
  });
  regEvent('cache-replace-items', ({ draftState }, items: number[]) => {
    draftState['cache-items'] = items;
  });
  regEvent('cache-set-revive-source', ({ draftState }, value: number) => {
    draftState['cache-revive-source'] = value;
  });
  regEvent('cache-set-selected', ({ draftState }, value: string | undefined) => {
    draftState['cache-selected'] = value;
  });

  beforeEach(() => {
    clearSubscriptionCache();
    mappedRuns = 0;
    lengthRuns = 0;
    selectedRuns = 0;
    initState({
      'cache-items': [1],
      'cache-revive-source': 1,
      'cache-selected': undefined,
      'cache-shared-source': 2,
    });
  });

  it('refreshes a dormant cached subscription after the state flush', async () => {
    const subscription = getOrCreateSubscription(['cache-count'])!;
    expect(readSubscription(subscription)).toBe(1);

    dispatch(['cache-add-item', 2]);
    await waitForScheduled();
    expect(getSubscriptionValue(['cache-count'])).toBe(1);

    await waitForFlush();
    expect(readSubscription(subscription)).toBe(2);
  });

  it('updates an active child through an unwatched shared parent', async () => {
    const subscription = getOrCreateSubscription(['cache-even-count'])!;
    const callback = jest.fn();
    const unsubscribe = subscribeToSubscription(subscription, callback);
    expect(getSubscriptionSnapshot(subscription)).toBe(0);

    dispatch(['cache-add-item', 2]);
    await waitForScheduled();
    await waitForFlush();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
    expect(getSubscriptionSnapshot(subscription)).toBe(1);
    unsubscribe();
  });

  it('recreates a terminal computed cell over its persistent root', async () => {
    const root = getOrCreateSubscription(['cache-revive-source'])!;
    const subscription = getOrCreateSubscription(['cache-revive-double'])!;
    const unsubscribe = subscribeToSubscription(subscription, () => {});
    expect(getSubscriptionSnapshot(subscription)).toBe(2);
    unsubscribe();

    dispatch(['cache-set-revive-source', 3]);
    await waitForScheduled();
    await waitForFlush();

    const recreated = getOrCreateSubscription(['cache-revive-double'])!;
    expect(recreated).not.toBe(subscription);
    expect(getOrCreateSubscription(['cache-revive-source'])).toBe(root);
    expect(getSubscriptionSnapshot(recreated)).toBe(6);
  });

  it('uses default deep equality to stop downstream propagation', async () => {
    const subscription = getOrCreateSubscription(['cache-default-length'])!;
    const callback = jest.fn();
    const unsubscribe = subscribeToSubscription(subscription, callback);
    expect(getSubscriptionSnapshot(subscription)).toBe(1);
    mappedRuns = 0;
    lengthRuns = 0;

    dispatch(['cache-replace-items', [1]]);
    await waitForScheduled();
    await waitForFlush();

    expect(mappedRuns).toBe(1);
    expect(lengthRuns).toBe(0);
    expect(callback).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('caches computed undefined as a successful value', () => {
    expect(getSubscriptionValue(['cache-selected-value'])).toBeUndefined();
    expect(getSubscriptionValue(['cache-selected-value'])).toBeUndefined();
    expect(selectedRuns).toBe(1);
  });

  it('notifies when a computed value changes to and from undefined', async () => {
    const subscription = getOrCreateSubscription(['cache-selected-value'])!;
    const callback = jest.fn();
    const unsubscribe = subscribeToSubscription(subscription, callback);
    expect(getSubscriptionSnapshot(subscription)).toBeUndefined();

    dispatch(['cache-set-selected', 'a']);
    await waitForScheduled();
    await waitForFlush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(subscription)).toBe('a');

    dispatch(['cache-set-selected', undefined]);
    await waitForScheduled();
    await waitForFlush();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(getSubscriptionSnapshot(subscription)).toBeUndefined();
    unsubscribe();
  });

  it('rebuilds dormant parents when a shared computed dependency becomes terminal', () => {
    const dormantParent = getOrCreateSubscription(['cache-dormant-parent'])!;
    expect(getSubscriptionSnapshot(dormantParent)).toBe(5);

    const liveSibling = getOrCreateSubscription(['cache-live-sibling'])!;
    const unsubscribeSibling = subscribeToSubscription(liveSibling, () => {});
    expect(getSubscriptionSnapshot(liveSibling)).toBe(14);
    unsubscribeSibling();

    const rebuiltParent = getOrCreateSubscription(['cache-dormant-parent'])!;
    expect(rebuiltParent).not.toBe(dormantParent);
    const listener = jest.fn();
    const unsubscribeParent = subscribeToSubscription(rebuiltParent, listener);
    expect(getSubscriptionSnapshot(rebuiltParent)).toBe(5);

    initState({ 'cache-shared-source': 3 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(rebuiltParent)).toBe(7);
    unsubscribeParent();
  });

  it('keeps a shared computed dependency while another live parent still uses it', () => {
    const firstParent = getOrCreateSubscription(['cache-dormant-parent'])!;
    const secondParent = getOrCreateSubscription(['cache-live-sibling'])!;
    const shared = getOrCreateSubscription(['cache-shared-dependency'])!;
    const unsubscribeFirst = subscribeToSubscription(firstParent, () => {});
    const secondListener = jest.fn();
    const unsubscribeSecond = subscribeToSubscription(secondParent, secondListener);

    unsubscribeFirst();
    expect(getOrCreateSubscription(['cache-shared-dependency'])).toBe(shared);

    initState({ 'cache-shared-source': 3 });
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(secondParent)).toBe(16);
    unsubscribeSecond();
  });

  it('cascades targeted subscription cache clearing through dormant dependents', () => {
    const original = getOrCreateSubscription(['cache-dormant-parent'])!;
    expect(getSubscriptionSnapshot(original)).toBe(5);

    clearSubscriptionCache(JSON.stringify(['cache-shared-source']));
    initState({ 'cache-shared-source': 3 });

    const rebuilt = getOrCreateSubscription(['cache-dormant-parent'])!;
    expect(rebuilt).not.toBe(original);
    expect(getSubscriptionSnapshot(rebuilt)).toBe(7);
  });

  it('keeps unrelated parameter branches when one cached key is cleared', () => {
    const first = getOrCreateSubscription(['cache-param-parent', 1])!;
    const second = getOrCreateSubscription(['cache-param-parent', 2])!;
    expect(getSubscriptionSnapshot(first)).toBe(30);
    expect(getSubscriptionSnapshot(second)).toBe(40);

    clearSubscriptionCache(JSON.stringify(['cache-param-select', 1]));

    expect(getOrCreateSubscription(['cache-param-parent', 1])).not.toBe(first);
    expect(getOrCreateSubscription(['cache-param-parent', 2])).toBe(second);
  });

  it('invalidates dormant dependents when a subscription handler is cleared', () => {
    const sourceId = 'cache-clear-handler-source';
    const derivedId = 'cache-clear-handler-derived';
    regSub(sourceId);
    regSub(
      derivedId,
      (value: number) => value * 2,
      () => [[sourceId]],
    );
    initState({ [sourceId]: 2 });
    expect(getSubscriptionValue([derivedId])).toBe(4);

    clearHandlers('sub', sourceId);
    initState({ [sourceId]: 3 });

    expect(() => getSubscriptionValue([derivedId])).toThrow(
      `depends on missing subscription '${sourceId}'`,
    );
  });

  it('does not let an old HMR cleanup evict a replacement graph', () => {
    const sourceId = 'cache-hmr-source';
    const derivedId = 'cache-hmr-derived';
    regSub(sourceId);
    regSub(
      derivedId,
      (value: number) => value * 2,
      () => [[sourceId]],
    );
    initState({ [sourceId]: 1 });

    const oldSubscription = getOrCreateSubscription([derivedId])!;
    const unsubscribeOld = subscribeToSubscription(oldSubscription, () => {});
    expect(getSubscriptionSnapshot(oldSubscription)).toBe(2);

    clearSubsForHotReload();
    regSub(sourceId);
    regSub(
      derivedId,
      (value: number) => value * 3,
      () => [[sourceId]],
    );
    const replacement = getOrCreateSubscription([derivedId])!;
    const unsubscribeReplacement = subscribeToSubscription(replacement, () => {});
    expect(getSubscriptionSnapshot(replacement)).toBe(3);

    unsubscribeOld();
    expect(getOrCreateSubscription([derivedId])).toBe(replacement);
    initState({ [sourceId]: 2 });
    expect(getSubscriptionSnapshot(replacement)).toBe(6);
    unsubscribeReplacement();
  });
});
