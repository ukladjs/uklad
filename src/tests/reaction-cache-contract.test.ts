import { Reaction } from '../reaction';
import { regEvent } from '../events';
import { dispatch } from '../router';
import { initAppDb } from '../db';
import { clearReactions } from '../registrar';
import { getOrCreateReaction, getSubscriptionValue, regSub } from '../subs';
import { waitForAnimationFrame, waitForReaction, waitForScheduled } from './test-utils';

const waitForFlush = async () => {
  await waitForAnimationFrame();
  await waitForReaction();
};

const waitForMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('Reaction cache contract after mount cascade fix', () => {
  regSub('cache-items');
  regSub('cache-count', (items: number[]) => (items || []).length, () => [['cache-items']]);
  regSub('cache-even-items', (items: number[]) => (items || []).filter((item) => item % 2 === 0), () => [['cache-items']]);
  regSub('cache-even-count', (items: number[]) => items.length, () => [['cache-even-items']]);
  regSub('cache-revive-source');
  regSub('cache-revive-double', (value: number) => value * 2, () => [['cache-revive-source']]);

  regEvent('cache-add-item', ({ draftDb }, item: number) => {
    draftDb['cache-items'].push(item);
  });
  regEvent('cache-set-revive-source', ({ draftDb }, value: number) => {
    draftDb['cache-revive-source'] = value;
  });

  beforeEach(() => {
    clearReactions();
    initAppDb({
      'cache-items': [1],
      'cache-revive-source': 1,
    });
  });

  it('refreshes a dormant cached subscription after the db flush', async () => {
    const reaction = getOrCreateReaction(['cache-count']);

    expect(reaction.computeValue()).toBe(1);

    dispatch(['cache-add-item', 2]);
    await waitForScheduled();

    // The event committed, but subscriptions still read the last flushed
    // generation until the scheduled flush promotes renderDb.
    expect(getSubscriptionValue(['cache-count'])).toBe(1);

    await waitForFlush();

    // The reaction was never watched, so it did not receive scheduled
    // recomputes. The next read must still validate through the root and see
    // the flushed generation.
    expect(reaction.computeValue()).toBe(2);
  });

  it('updates an alive child through an unwatched shared parent', async () => {
    const reaction = getOrCreateReaction(['cache-even-count']);
    const callback = jest.fn();

    reaction.watch(callback);
    expect(reaction.getSnapshot()).toBe(0);

    dispatch(['cache-add-item', 2]);
    await waitForScheduled();
    await waitForFlush();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(1);
    expect(reaction.getSnapshot()).toBe(1);

    reaction.unwatch(callback);
  });

  it('re-resolves disposed dependencies on revival and refreshes stale values', async () => {
    const reaction = getOrCreateReaction(['cache-revive-double']);
    const callback = jest.fn();

    reaction.watch(callback);
    expect(reaction.getSnapshot()).toBe(2);

    reaction.unwatch(callback);

    dispatch(['cache-set-revive-source', 3]);
    await waitForScheduled();
    await waitForFlush();

    const revivedCallback = jest.fn();
    reaction.watch(revivedCallback);

    expect(reaction.getSnapshot()).toBe(6);
    expect(revivedCallback).not.toHaveBeenCalled();

    reaction.unwatch(revivedCallback);
  });

  it('keeps diamond graphs correct when the shared root changes identity', async () => {
    let rootValue = { n: 1 };
    let leftRuns = 0;
    let rightRuns = 0;
    let topRuns = 0;

    const root = Reaction.create(() => rootValue);
    const left = Reaction.create((value) => {
      leftRuns++;
      return value.n + 1;
    }, [root]);
    const right = Reaction.create((value) => {
      rightRuns++;
      return value.n + 2;
    }, [root]);
    const top = Reaction.create((leftValue, rightValue) => {
      topRuns++;
      return leftValue + rightValue;
    }, [left, right]);
    const callback = jest.fn();

    top.watch(callback);
    expect(top.computeValue()).toBe(5);
    expect(leftRuns).toBe(1);
    expect(rightRuns).toBe(1);
    expect(topRuns).toBe(1);

    rootValue = { n: 2 };
    root.markDirty();
    await waitForMicrotasks();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(7);
    expect(top.getSnapshot()).toBe(7);
    expect(leftRuns).toBe(2);
    expect(rightRuns).toBe(2);
    expect(topRuns).toBe(2);

    top.unwatch(callback);
  });

  it('delivers a pending notification after another watcher pulls the value first', async () => {
    let source = { n: 1 };
    const root = Reaction.create(() => source);
    const reader = Reaction.create((value) => value.n, [root]);
    const shared = Reaction.create((value) => value.n * 10, [root]);
    const sharedWatcher = jest.fn();
    const readerWatcher = jest.fn(() => {
      // `reader` is scheduled first. Its watcher runs while `shared` is also
      // scheduled and pulls the new shared value without notifying watchers.
      // The later shared microtask must still deliver its pending change.
      shared.computeValue();
    });

    reader.watch(readerWatcher);
    shared.watch(sharedWatcher);
    expect(reader.getSnapshot()).toBe(1);
    expect(shared.getSnapshot()).toBe(10);

    source = { n: 2 };
    root.markDirty();
    await waitForMicrotasks();

    expect(readerWatcher).toHaveBeenCalledTimes(1);
    expect(sharedWatcher).toHaveBeenCalledTimes(1);
    expect(sharedWatcher).toHaveBeenCalledWith(20);
    expect(shared.getSnapshot()).toBe(20);

    reader.unwatch(readerWatcher);
    shared.unwatch(sharedWatcher);
  });

  it('lets a parent pull satisfy dependency tasks without duplicate evaluation', async () => {
    let source = 1;
    let rootRuns = 0;
    const root = Reaction.create(() => {
      rootRuns++;
      return source;
    });
    const middle = Reaction.create((value) => value * 2, [root]);
    const top = Reaction.create((value) => value + 1, [middle]);
    const middleWatcher = jest.fn();
    const topWatcher = jest.fn();

    middle.watch(middleWatcher);
    top.watch(topWatcher);
    expect(top.getSnapshot()).toBe(3);
    rootRuns = 0;

    source = 2;
    root.markDirty();
    await waitForMicrotasks();

    expect(rootRuns).toBe(1);
    expect(middleWatcher).toHaveBeenCalledTimes(1);
    expect(middleWatcher).toHaveBeenCalledWith(4);
    expect(topWatcher).toHaveBeenCalledTimes(1);
    expect(topWatcher).toHaveBeenCalledWith(5);

    middle.unwatch(middleWatcher);
    top.unwatch(topWatcher);
  });

  it('does not let a disposed task notify a watcher from a revived lifecycle', async () => {
    let source = 1;
    const reaction = Reaction.create(() => source);
    const oldWatcher = jest.fn();
    const revivedWatcher = jest.fn();

    reaction.watch(oldWatcher);
    expect(reaction.getSnapshot()).toBe(1);

    source = 2;
    reaction.markDirty();
    reaction.unwatch(oldWatcher);
    reaction.watch(revivedWatcher);

    expect(reaction.getSnapshot()).toBe(2);
    await waitForMicrotasks();
    expect(oldWatcher).not.toHaveBeenCalled();
    expect(revivedWatcher).not.toHaveBeenCalled();

    source = 3;
    reaction.markDirty();
    await waitForMicrotasks();
    expect(revivedWatcher).toHaveBeenCalledTimes(1);
    expect(revivedWatcher).toHaveBeenCalledWith(3);

    reaction.unwatch(revivedWatcher);
  });

  it('delivers one coherent version to every watcher during a re-entrant update', async () => {
    let source = 1;
    const reaction = Reaction.create(() => source);
    const firstSeen: number[] = [];
    const secondSeen: number[] = [];
    const firstWatcher = (value: number) => {
      firstSeen.push(value);
      if (value === 2) {
        source = 3;
        reaction.markDirty();
      }
    };
    const secondWatcher = (value: number) => secondSeen.push(value);

    reaction.watch(firstWatcher);
    reaction.watch(secondWatcher);
    expect(reaction.getSnapshot()).toBe(1);

    source = 2;
    reaction.markDirty();
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(firstSeen).toEqual([2, 3]);
    expect(secondSeen).toEqual([2, 3]);
    expect(reaction.getSnapshot()).toBe(3);

    reaction.unwatch(firstWatcher);
    reaction.unwatch(secondWatcher);
  });

  it('does not cancel a newer re-entrant signal during a synchronous diamond walk', async () => {
    let source = 1;
    const root = Reaction.create(() => source);
    const left = Reaction.create((value) => value * 2, [root]);
    const right = Reaction.create((value) => value + 1, [root]);
    const top = Reaction.create((leftValue, rightValue) => leftValue + rightValue, [left, right]);
    const seen: number[] = [];
    const watcher = (value: number) => {
      seen.push(value);
      if (value === 7) {
        source = 3;
        root.markDirty();
      }
    };

    top.watch(watcher);
    expect(top.getSnapshot()).toBe(4);

    source = 2;
    root.markDirty();
    root.recomputeTreeSync();

    expect(seen).toEqual([7, 10]);
    expect(top.getSnapshot()).toBe(10);
    await waitForMicrotasks();
    expect(seen).toEqual([7, 10]);

    top.unwatch(watcher);
  });

  it('re-probes a later sync sibling after an earlier watcher signals again', async () => {
    let source = 1;
    const root = Reaction.create(() => source);
    const first = Reaction.create((value) => value, [root]);
    const second = Reaction.create((value) => value * 10, [root]);
    const firstSeen: number[] = [];
    const secondSeen: number[] = [];
    const firstWatcher = (value: number) => {
      firstSeen.push(value);
      if (value === 2) {
        source = 3;
        root.markDirty();
      }
    };
    const secondWatcher = (value: number) => secondSeen.push(value);

    first.watch(firstWatcher);
    second.watch(secondWatcher);
    expect(first.getSnapshot()).toBe(1);
    expect(second.getSnapshot()).toBe(10);

    source = 2;
    root.markDirty();
    root.recomputeTreeSync();

    // `second` had not yet been visited when the first watcher changed the
    // source again. It must not trust the earlier pass's root probe.
    expect(secondSeen).toEqual([30]);
    expect(second.getSnapshot()).toBe(30);

    await waitForMicrotasks();
    expect(firstSeen).toEqual([2, 3]);
    expect(first.getSnapshot()).toBe(3);
    expect(secondSeen).toEqual([30]);

    first.unwatch(firstWatcher);
    second.unwatch(secondWatcher);
  });

  it('lets computed equality stop downstream propagation after equal recompute', async () => {
    let source = { items: [1, 2] };
    let mappedRuns = 0;
    let lengthRuns = 0;

    const root = Reaction.create(() => source);
    const mapped = Reaction.create((value) => {
      mappedRuns++;
      return value.items.map((item: number) => item);
    }, [root]);
    const length = Reaction.create((items) => {
      lengthRuns++;
      return items.length;
    }, [mapped]);
    const callback = jest.fn();

    length.watch(callback);
    expect(length.computeValue()).toBe(2);
    expect(mappedRuns).toBe(1);
    expect(lengthRuns).toBe(1);

    // New root identity means the mapped subscription must re-run. Its fresh
    // array is deeply equal to the previous result, so the mapped version does
    // not bump and the downstream length subscription stays cached.
    source = { items: [1, 2] };
    root.markDirty();
    await waitForMicrotasks();

    expect(mappedRuns).toBe(2);
    expect(lengthRuns).toBe(1);
    expect(callback).not.toHaveBeenCalled();
    expect(length.getSnapshot()).toBe(2);

    length.unwatch(callback);
  });

  it('caches computed undefined results as real values', () => {
    let source = { selected: undefined as string | undefined };
    let selectedRuns = 0;

    const root = Reaction.create(() => source);
    const selected = Reaction.create((value) => {
      selectedRuns++;
      return value.selected;
    }, [root]);

    expect(selected.computeValue()).toBeUndefined();
    expect(selectedRuns).toBe(1);

    // `undefined` is a valid cached result, not a sentinel for "never
    // computed". With unchanged dep versions, the computed node must stay
    // cached instead of re-running on every read.
    expect(selected.computeValue()).toBeUndefined();
    expect(selectedRuns).toBe(1);
  });

  it('notifies when a computed value changes to and from undefined', async () => {
    let source = { selected: undefined as string | undefined };

    const root = Reaction.create(() => source);
    const selected = Reaction.create((value) => value.selected, [root]);
    const callback = jest.fn();

    selected.watch(callback);
    expect(selected.computeValue()).toBeUndefined();

    source = { selected: 'a' };
    root.markDirty();
    await waitForMicrotasks();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith('a');
    expect(selected.getSnapshot()).toBe('a');

    source = { selected: undefined };
    root.markDirty();
    await waitForMicrotasks();

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(undefined);
    expect(selected.getSnapshot()).toBeUndefined();

    selected.unwatch(callback);
  });

  it('documents that same-reference mutable roots do not invalidate dependents', async () => {
    const source = { n: 1 };
    let childRuns = 0;

    const root = Reaction.create(() => source);
    const child = Reaction.create((value) => {
      childRuns++;
      return value.n;
    }, [root]);
    const callback = jest.fn();

    child.watch(callback);
    expect(child.computeValue()).toBe(1);
    expect(childRuns).toBe(1);

    // This is intentionally not a supported Reflex db update pattern. Db roots
    // are immutable snapshots from Immer; changed roots get new identities.
    source.n = 2;
    root.markDirty();
    await waitForMicrotasks();

    expect(childRuns).toBe(1);
    expect(callback).not.toHaveBeenCalled();
    expect(child.getSnapshot()).toBe(1);

    child.unwatch(callback);
  });
});
