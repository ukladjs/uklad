import {
  createSubscription,
  getSubscriptionSnapshot,
  publishSubscriptions,
  readSubscription,
  subscribeToSubscription,
  type SubscriptionNode,
} from '../subscription-runtime';

let nextKey = 0;

interface LifecycleHooks {
  onActive?: () => void;
  onUnused?: () => void;
}

function root<T>(compute: () => T, hooks: LifecycleHooks = {}): SubscriptionNode<T> {
  const key = `contract-root-${++nextKey}`;
  return createSubscription({
    key,
    query: [key],
    kind: 'root',
    compute,
    dependencies: [],
    equalityCheck: Object.is,
    onActive: hooks.onActive ?? (() => {}),
    onUnused: hooks.onUnused ?? (() => {}),
  });
}

function computed<T>(
  dependencies: SubscriptionNode<any>[],
  compute: (...values: any[]) => T,
  equalityCheck: (left: T, right: T) => boolean = Object.is,
  hooks: LifecycleHooks = {},
): SubscriptionNode<T> {
  const key = `contract-computed-${++nextKey}`;
  return createSubscription({
    key,
    query: [key],
    kind: 'computed',
    compute,
    dependencies,
    equalityCheck,
    onActive: hooks.onActive ?? (() => {}),
    onUnused: hooks.onUnused ?? (() => {}),
  });
}

describe('subscription runtime contract', () => {
  it('memoizes expensive computed values across unchanged reads', () => {
    const source = 2;
    let computedRuns = 0;
    const sourceNode = root(() => source);
    const doubled = computed([sourceNode], (value: number) => {
      computedRuns++;
      return value * 2;
    });

    expect(readSubscription(doubled)).toBe(4);
    expect(readSubscription(doubled)).toBe(4);
    expect(getSubscriptionSnapshot(doubled)).toBe(4);
    expect(computedRuns).toBe(1);
  });

  it('uses a void uSES listener as an invalidation signal', async () => {
    let source = 1;
    const sourceNode = root(() => source);
    const doubled = computed([sourceNode], (value: number) => value * 2);
    const snapshots: number[] = [];
    const listener = jest.fn(() => {
      snapshots.push(getSubscriptionSnapshot(doubled));
    });
    const unsubscribe = subscribeToSubscription(doubled, listener, 'contract component');

    expect(getSubscriptionSnapshot(doubled)).toBe(2);
    source = 2;
    publishSubscriptions([sourceNode]);

    expect(listener.mock.calls).toEqual([[]]);
    expect(snapshots).toEqual([4]);
    unsubscribe();
  });

  it('catches up a dormant render snapshot before the first subscription', () => {
    let source = 1;
    const sourceNode = root(() => source);
    const child = computed([sourceNode], (value: number) => value + 1);

    expect(getSubscriptionSnapshot(child)).toBe(2);
    source = 2;
    publishSubscriptions([sourceNode]);

    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(child, listener);
    expect(listener).not.toHaveBeenCalled();
    expect(getSubscriptionSnapshot(child)).toBe(3);
    unsubscribe();
  });

  it('catches up a cached render error before the first subscription', () => {
    let shouldThrow = true;
    let source = 1;
    const sourceNode = root(() => {
      if (shouldThrow) throw new Error('render failure');
      return source;
    });
    const child = computed([sourceNode], (value: number) => value + 1);

    expect(() => getSubscriptionSnapshot(child)).toThrow('render failure');
    shouldThrow = false;
    source = 2;
    publishSubscriptions([sourceNode]);

    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(child, listener);
    expect(listener).not.toHaveBeenCalled();
    expect(getSubscriptionSnapshot(child)).toBe(3);
    unsubscribe();
  });

  it('settles multi-root fan-in once and emits one callback', async () => {
    let leftValue = 1;
    let rightValue = 10;
    let sumRuns = 0;
    const left = root(() => leftValue);
    const right = root(() => rightValue);
    const sum = computed([left, right], (a: number, b: number) => {
      sumRuns++;
      return a + b;
    });
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(sum, listener);

    expect(getSubscriptionSnapshot(sum)).toBe(11);
    sumRuns = 0;
    leftValue = 2;
    rightValue = 20;
    publishSubscriptions([left, right]);

    expect(sumRuns).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(sum)).toBe(22);
    unsubscribe();
  });

  it('lets equality stop downstream recomputation and notification', async () => {
    let source = { items: [1, 2] };
    let mappedRuns = 0;
    let lengthRuns = 0;
    const sourceNode = root(() => source);
    const mapped = computed(
      [sourceNode],
      (value: { items: number[] }) => {
        mappedRuns++;
        return [...value.items];
      },
      (left, right) =>
        left.length === right.length && left.every((value, index) => value === right[index]),
    );
    const length = computed([mapped], (items: number[]) => {
      lengthRuns++;
      return items.length;
    });
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(length, listener);

    expect(getSubscriptionSnapshot(length)).toBe(2);
    mappedRuns = 0;
    lengthRuns = 0;
    source = { items: [1, 2] };
    publishSubscriptions([sourceNode]);

    expect(mappedRuns).toBe(1);
    expect(lengthRuns).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('freezes the listener list for a publication wave', async () => {
    let source = 1;
    const sourceNode = root(() => source);
    const first = jest.fn();
    const second = jest.fn();
    const late = jest.fn();
    let unsubscribeSecond = () => {};
    let unsubscribeLate = () => {};

    first.mockImplementation(() => {
      unsubscribeSecond();
      unsubscribeLate = subscribeToSubscription(sourceNode, late);
    });
    const unsubscribeFirst = subscribeToSubscription(sourceNode, first);
    unsubscribeSecond = subscribeToSubscription(sourceNode, second);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    source = 2;
    publishSubscriptions([sourceNode]);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();

    source = 3;
    publishSubscriptions([sourceNode]);
    expect(late).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeLate();
  });

  it('isolates a throwing listener and continues delivery', () => {
    let source = 1;
    const sourceNode = root(() => source);
    const failing = jest.fn(() => {
      throw new Error('listener failure');
    });
    const healthy = jest.fn();
    const unsubscribeFailing = subscribeToSubscription(sourceNode, failing);
    const unsubscribeHealthy = subscribeToSubscription(sourceNode, healthy);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    source = 2;
    publishSubscriptions([sourceNode]);

    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    unsubscribeFailing();
    unsubscribeHealthy();
  });

  it('rolls activation back when a lifecycle hook throws', async () => {
    let source = 1;
    let failActivation = true;
    const onActive = jest.fn(() => {
      if (failActivation) throw new Error('expected activation failure');
    });
    const onUnused = jest.fn();
    const sourceNode = root(() => source, { onActive, onUnused });
    const listener = jest.fn();

    expect(() => subscribeToSubscription(sourceNode, listener)).toThrow(
      'expected activation failure',
    );
    source = 2;
    publishSubscriptions([sourceNode]);
    expect(listener).not.toHaveBeenCalled();

    failActivation = false;
    const unsubscribe = subscribeToSubscription(sourceNode, listener);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(2);
    unsubscribe();

    expect(onActive).toHaveBeenCalledTimes(2);
    expect(onUnused).toHaveBeenCalledTimes(2);
  });

  it('returns an idempotent cleanup and releases a dependency graph once', async () => {
    let source = 1;
    const rootActive = jest.fn();
    const rootUnused = jest.fn();
    const childActive = jest.fn();
    const childUnused = jest.fn();
    const sourceNode = root(() => source, { onActive: rootActive, onUnused: rootUnused });
    const child = computed([sourceNode], (value: number) => value + 1, Object.is, {
      onActive: childActive,
      onUnused: childUnused,
    });
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(child, listener);

    expect(getSubscriptionSnapshot(child)).toBe(2);
    unsubscribe();
    unsubscribe();
    source = 2;
    publishSubscriptions([sourceNode]);

    expect(listener).not.toHaveBeenCalled();
    expect(rootActive).toHaveBeenCalledTimes(1);
    expect(childActive).toHaveBeenCalledTimes(1);
    expect(rootUnused).toHaveBeenCalledTimes(1);
    expect(childUnused).toHaveBeenCalledTimes(1);
  });

  it('balances repeated registrations of the same listener independently', () => {
    let source = 1;
    const onUnused = jest.fn();
    const sourceNode = root(() => source, { onUnused });
    const listener = jest.fn();
    const unsubscribeFirst = subscribeToSubscription(sourceNode, listener, 'first registration');
    const unsubscribeSecond = subscribeToSubscription(sourceNode, listener, 'second registration');
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    source = 2;
    publishSubscriptions([sourceNode]);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
    expect(onUnused).not.toHaveBeenCalled();
    source = 3;
    publishSubscriptions([sourceNode]);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribeFirst();
    expect(onUnused).toHaveBeenCalledTimes(1);
    source = 4;
    publishSubscriptions([sourceNode]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('settles and notifies before publication returns', () => {
    let source = 1;
    const sourceNode = root(() => source);
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(sourceNode, listener);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    source = 2;
    publishSubscriptions([sourceNode]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(2);
    unsubscribe();
  });

  it('rejects a non-root publication before changing any root', () => {
    let source = 1;
    const sourceNode = root(() => source);
    const child = computed([sourceNode], (value: number) => value + 1);
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(sourceNode, listener);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    source = 2;
    expect(() => publishSubscriptions([sourceNode, child])).toThrow('Cannot publish non-root');

    expect(listener).not.toHaveBeenCalled();
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);
    unsubscribe();
  });
});

describe('subscription runtime budgets', () => {
  it('probes a shared root once across wide watched fan-out', () => {
    const width = 64;
    let source = 1;
    let rootRuns = 0;
    const sourceNode = root(() => {
      rootRuns++;
      return source;
    });
    const leafRuns = Array.from({ length: width }, () => 0);
    const leaves = leafRuns.map((_, index) =>
      computed([sourceNode], (value: number) => {
        leafRuns[index]!++;
        return value + index;
      }),
    );
    const listeners = leaves.map(() => jest.fn());
    const cleanups = leaves.map((leaf, index) => subscribeToSubscription(leaf, listeners[index]!));

    leaves.forEach((leaf) => getSubscriptionSnapshot(leaf));
    rootRuns = 0;
    leafRuns.fill(0);
    source = 2;
    publishSubscriptions([sourceNode]);

    expect(rootRuns).toBe(1);
    expect(leafRuns).toEqual(Array.from({ length: width }, () => 1));
    expect(listeners.every((listener) => listener.mock.calls.length === 1)).toBe(true);
    cleanups.forEach((cleanup) => cleanup());
  });

  it('settles every changed snapshot before delivering the first listener', () => {
    let leftValue = 1;
    let rightValue = 10;
    const left = root(() => leftValue);
    const right = root(() => rightValue);
    const total = computed([left, right], (a: number, b: number) => a + b);
    const observedTotals: number[] = [];
    const unsubscribeLeft = subscribeToSubscription(left, () => {
      observedTotals.push(getSubscriptionSnapshot(total));
    });
    const unsubscribeTotal = subscribeToSubscription(total, () => {});
    expect(getSubscriptionSnapshot(total)).toBe(11);

    leftValue = 2;
    rightValue = 20;
    publishSubscriptions([left, right]);

    expect(observedTotals).toEqual([22]);
    unsubscribeLeft();
    unsubscribeTotal();
  });

  it('rejects direct publication during listener delivery', () => {
    let source = 1;
    const sourceNode = root(() => source);
    const snapshots: number[] = [];
    let nestedError: unknown;
    const listener = jest.fn(() => {
      snapshots.push(getSubscriptionSnapshot(sourceNode));
      if (source === 2) {
        source = 3;
        try {
          publishSubscriptions([sourceNode]);
        } catch (error) {
          nestedError = error;
        }
      }
    });
    const unsubscribe = subscribeToSubscription(sourceNode, listener);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    source = 2;
    publishSubscriptions([sourceNode]);

    expect(listener.mock.calls).toEqual([[]]);
    expect(snapshots).toEqual([2]);
    expect((nestedError as Error).message).toContain('publication is not allowed');

    publishSubscriptions([sourceNode]);
    expect(snapshots).toEqual([2, 3]);
    unsubscribe();
  });

  it('publishes computation errors and a later recovery as observable changes', () => {
    let source = 1;
    let shouldThrow = false;
    const sourceNode = root(() => {
      if (shouldThrow) throw new Error('expected computation failure');
      return source;
    });
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(sourceNode, listener);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    shouldThrow = true;
    publishSubscriptions([sourceNode]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => getSubscriptionSnapshot(sourceNode)).toThrow('expected computation failure');

    shouldThrow = false;
    source = 2;
    publishSubscriptions([sourceNode]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(2);
    unsubscribe();
  });

  it('logs retained computation errors only when their identity changes', () => {
    const firstError = new Error('first retained failure');
    const secondError = new Error('second retained failure');
    let failure = firstError;
    const sourceNode = root(() => {
      throw failure;
    });
    const computationLogs = () =>
      getTestLogCalls().error.filter((call) =>
        String(call[0]).includes('Error in subscription computation'),
      );

    expect(() => getSubscriptionSnapshot(sourceNode)).toThrow(firstError);
    expect(() => getSubscriptionSnapshot(sourceNode)).toThrow(firstError);
    expect(computationLogs().map((call) => call[1])).toEqual([firstError]);

    failure = secondError;
    expect(() => getSubscriptionSnapshot(sourceNode)).toThrow(secondError);
    expect(computationLogs().map((call) => call[1])).toEqual([firstError, secondError]);
  });

  it('deduplicates repeated dependency edges for compute and lifecycle budgets', () => {
    let source = 2;
    let rootRuns = 0;
    let childRuns = 0;
    const rootUnused = jest.fn();
    const sourceNode = root(
      () => {
        rootRuns++;
        return source;
      },
      { onUnused: rootUnused },
    );
    const child = computed([sourceNode, sourceNode], (left: number, right: number) => {
      childRuns++;
      return left + right;
    });
    const unsubscribe = subscribeToSubscription(child, () => {});

    expect(getSubscriptionSnapshot(child)).toBe(4);
    rootRuns = 0;
    childRuns = 0;
    source = 3;
    publishSubscriptions([sourceNode]);

    expect(rootRuns).toBe(1);
    expect(childRuns).toBe(1);
    expect(getSubscriptionSnapshot(child)).toBe(6);
    unsubscribe();
    expect(rootUnused).toHaveBeenCalledTimes(1);
  });

  it('rolls back every activated dependency when a dependency hook throws', () => {
    let failActivation = true;
    const rootActive = jest.fn(() => {
      if (failActivation) throw new Error('dependency activation failed');
    });
    const rootUnused = jest.fn();
    const sourceNode = root(() => 1, { onActive: rootActive, onUnused: rootUnused });
    const child = computed([sourceNode], (value: number) => value + 1);

    expect(() => subscribeToSubscription(child, () => {})).toThrow('dependency activation failed');
    expect(rootActive).toHaveBeenCalledTimes(1);
    expect(rootUnused).toHaveBeenCalledTimes(1);

    failActivation = false;
    const unsubscribe = subscribeToSubscription(child, () => {});
    expect(getSubscriptionSnapshot(child)).toBe(2);
    unsubscribe();
    expect(rootActive).toHaveBeenCalledTimes(2);
    expect(rootUnused).toHaveBeenCalledTimes(2);
  });

  it('finishes structural teardown when an onUnused hook throws', () => {
    const rootUnused = jest.fn();
    const childUnused = jest.fn(() => {
      throw new Error('expected release failure');
    });
    const sourceNode = root(() => 1, { onUnused: rootUnused });
    const child = computed([sourceNode], (value: number) => value + 1, Object.is, {
      onUnused: childUnused,
    });
    const unsubscribe = subscribeToSubscription(child, () => {});

    unsubscribe();

    expect(childUnused).toHaveBeenCalledTimes(1);
    expect(rootUnused).toHaveBeenCalledTimes(1);
  });

  it('rejects reads and subscriptions through a terminal computed handle', () => {
    const sourceNode = root(() => 1);
    const child = computed([sourceNode], (value: number) => value + 1);
    const unsubscribe = subscribeToSubscription(child, () => {});
    expect(getSubscriptionSnapshot(child)).toBe(2);

    unsubscribe();

    expect(() => readSubscription(child)).toThrow('was disposed; reacquire it by key');
    expect(() => subscribeToSubscription(child, () => {})).toThrow(
      'was disposed; reacquire it by key',
    );
  });

  it('rejects reentrant synchronous publication before it can pretend to settle', () => {
    let source = 1;
    let nestedError: unknown;
    const sourceNode = root(() => source);
    const snapshots: number[] = [];
    const unsubscribe = subscribeToSubscription(sourceNode, () => {
      snapshots.push(getSubscriptionSnapshot(sourceNode));
      if (source === 2) {
        source = 3;
        try {
          publishSubscriptions([sourceNode]);
        } catch (error) {
          nestedError = error;
        }
      }
    });
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    source = 2;
    publishSubscriptions([sourceNode]);

    expect(nestedError).toBeInstanceOf(Error);
    expect((nestedError as Error).message).toContain('publication is not allowed');
    expect(snapshots).toEqual([2]);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(2);
    unsubscribe();
  });

  it('does not republish the same retained error object', () => {
    const retainedError = new Error('retained failure');
    let shouldThrow = false;
    const sourceNode = root(() => {
      if (shouldThrow) throw retainedError;
      return 1;
    });
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(sourceNode, listener);
    expect(getSubscriptionSnapshot(sourceNode)).toBe(1);

    shouldThrow = true;
    publishSubscriptions([sourceNode]);
    publishSubscriptions([sourceNode]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => getSubscriptionSnapshot(sourceNode)).toThrow(retainedError);
    unsubscribe();
  });

  it('recovers a first successful value without comparing against undefined', () => {
    let shouldThrow = true;
    let source = 1;
    let equalityRuns = 0;
    const sourceNode = root(() => {
      if (shouldThrow) throw new Error('initial failure');
      return source;
    });
    const child = computed(
      [sourceNode],
      (value: number) => [value],
      (left: number[], right: number[]) => {
        equalityRuns++;
        return left.length === right.length && left[0] === right[0];
      },
    );

    expect(() => getSubscriptionSnapshot(child)).toThrow('initial failure');
    shouldThrow = false;
    source = 2;
    publishSubscriptions([sourceNode]);

    expect(getSubscriptionSnapshot(child)).toEqual([2]);
    expect(equalityRuns).toBe(0);
  });

  it('retries a retained dormant error when its snapshot is requested again', () => {
    let attempts = 0;
    const sourceNode = root(() => {
      attempts++;
      if (attempts === 1) throw new Error('transient failure');
      return 4;
    });
    const child = computed([sourceNode], (value: number) => value * 2);

    expect(() => getSubscriptionSnapshot(child)).toThrow('transient failure');
    expect(getSubscriptionSnapshot(child)).toBe(8);
    expect(attempts).toBe(2);
  });

  it('settles unequal-depth fan-in once regardless of root order', () => {
    let shallowValue = 1;
    let deepValue = 10;
    const shallowRoot = root(() => shallowValue);
    const deepRoot = root(() => deepValue);
    let deepNode: SubscriptionNode<number> = deepRoot;
    for (let index = 0; index < 8; index++) {
      deepNode = computed([deepNode], (value: number) => value + 1);
    }
    let joinRuns = 0;
    const join = computed([shallowRoot, deepNode], (shallow: number, deep: number) => {
      joinRuns++;
      return shallow + deep;
    });
    const unsubscribe = subscribeToSubscription(join, () => {});
    expect(getSubscriptionSnapshot(join)).toBe(19);

    joinRuns = 0;
    shallowValue = 2;
    deepValue = 20;
    publishSubscriptions([shallowRoot, deepRoot]);

    expect(joinRuns).toBe(1);
    expect(getSubscriptionSnapshot(join)).toBe(30);
    unsubscribe();
  });

  it('treats an active dependency as a dormant-pull boundary', () => {
    let sourceRuns = 0;
    let liveRuns = 0;
    const sourceNode = root(() => {
      sourceRuns++;
      return 2;
    });
    const live = computed([sourceNode], (value: number) => {
      liveRuns++;
      return value * 2;
    });
    const unsubscribe = subscribeToSubscription(live, () => {});
    expect(getSubscriptionSnapshot(live)).toBe(4);

    sourceRuns = 0;
    liveRuns = 0;
    const dormant = computed([live], (value: number) => value + 1);
    expect(readSubscription(dormant)).toBe(5);

    expect(sourceRuns).toBe(0);
    expect(liveRuns).toBe(0);
    unsubscribe();
  });

  it('handles a deep chain without recursive activation, pull, publication, or release', () => {
    const depth = 3000;
    let source = 0;
    const sourceNode = root(() => source);
    let tail: SubscriptionNode<number> = sourceNode;
    for (let index = 0; index < depth; index++) {
      tail = computed([tail], (value: number) => value + 1);
    }

    expect(readSubscription(tail)).toBe(depth);
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(tail, listener);
    source = 1;
    publishSubscriptions([sourceNode]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(tail)).toBe(depth + 1);
    expect(() => unsubscribe()).not.toThrow();
  });
});
