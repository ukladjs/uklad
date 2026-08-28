import {
  clearSubscriptionCache,
  disableTracing,
  enableTracing,
  getOrCreateSubscription,
  getSubscriptionDiagnostics,
  getSubscriptionSnapshot,
  getSubscriptionValue,
  initState,
  regExternalSub,
  regRootSub,
  regSub,
  registerTraceCallback,
  removeTraceCallback,
  subscribeToSubscription,
  sweepProvisionalSubscriptions,
} from './runtime-test-api';
import type {
  ExternalSubscriptionContext,
  ExternalSubscriptionDriver,
} from '../../src/runtime/subscriptions/types';

interface TestDriver<TResult = any> extends ExternalSubscriptionDriver<
  readonly unknown[],
  TResult
> {
  readonly read: jest.Mock<TResult, [readonly unknown[]]>;
  readonly activate: jest.Mock<void, [readonly unknown[], ExternalSubscriptionContext]>;
  readonly sync: jest.Mock<void, [readonly unknown[]]>;
  readonly dispose: jest.Mock<void, []>;
}

let currentValue = 1;
let createdDrivers: TestDriver<any>[] = [];
let invalidateCurrent: (() => void) | undefined;
let invalidateEquality: (() => void) | undefined;
let invalidateReadError: (() => void) | undefined;
let invalidateBatchSource: (() => void) | undefined;
let invalidateBatchDependent: (() => void) | undefined;
let batchSourceValue = 1;
let externalInvalidationDerivedRuns = 0;
let failNextActivation = true;
let failNextSync = true;
let failExternalRead = true;
let syncOrder: string[] = [];
const EXTERNAL_TRACE_CALLBACK = 'external-subscription-trace-test';

regRootSub('external-lifecycle-source', 'external-lifecycle-source');
regExternalSub(
  'external-lifecycle-dormant',
  () => [['external-lifecycle-source']],
  () => createDriver((inputs) => Number(inputs[0]) + currentValue),
);
regExternalSub(
  'external-lifecycle-shared',
  () => [],
  () => createDriver(() => currentValue),
);
regExternalSub(
  'external-invalidation-source',
  () => [],
  () =>
    createDriver(
      () => currentValue,
      (_inputs, context) => {
        invalidateCurrent = context.invalidate;
      },
    ),
);
regSub(
  'external-invalidation-derived',
  () => [['external-invalidation-source']],
  ([value]) => {
    externalInvalidationDerivedRuns++;
    return Number(value);
  },
);
regExternalSub(
  'external-batch-source',
  () => [],
  () =>
    createDriver(
      () => batchSourceValue,
      (_inputs, context) => {
        invalidateBatchSource = context.invalidate;
      },
    ),
);
regSub(
  'external-batch-intermediate',
  () => [['external-batch-source']],
  ([value]) => value,
);
regExternalSub(
  'external-batch-dependent',
  () => [['external-batch-intermediate']],
  () => {
    const driver = createDriver(
      (inputs) => inputs[0],
      (_inputs, context) => {
        invalidateBatchDependent = context.invalidate;
      },
    );
    driver.sync.mockImplementation(() => {
      throw new Error('expected batched external sync failure');
    });
    return driver;
  },
);
regExternalSub(
  'external-dependency-sync',
  () => [['external-lifecycle-source']],
  () => createDriver(() => 7),
);
regExternalSub(
  'external-sync-error',
  () => [['external-lifecycle-source']],
  () => {
    const driver = createDriver(() => 8);
    driver.sync.mockImplementation(() => {
      if (failNextSync) throw new Error('expected external sync failure');
    });
    return driver;
  },
);
regExternalSub(
  'external-read-error',
  () => [['external-lifecycle-source']],
  () =>
    createDriver(
      (inputs) => {
        if (failExternalRead && inputs[0] === 20) {
          throw new Error('expected external read failure');
        }
        return Number(inputs[0]);
      },
      (_inputs, context) => {
        invalidateReadError = context.invalidate;
      },
    ),
);
regSub(
  'external-sync-error-derived',
  () => [['external-sync-error']],
  ([value]) => value,
);
regExternalSub(
  'external-sync-order',
  () => [['external-lifecycle-source']],
  () => {
    const driver = createDriver((inputs) => Number(inputs[0]));
    driver.read.mockImplementation((inputs) => {
      syncOrder.push('read');
      return Number(inputs[0]);
    });
    driver.sync.mockImplementation(() => {
      syncOrder.push('sync');
    });
    return driver;
  },
);
regSub(
  'external-sync-order-derived',
  () => [['external-sync-order']],
  ([value]) => {
    syncOrder.push('compute');
    return Number(value) * 2;
  },
);
regExternalSub(
  'external-equality-source',
  () => [],
  () =>
    createDriver(
      () => ({ stable: 1, source: currentValue }),
      (_inputs, context) => {
        invalidateEquality = context.invalidate;
      },
    ),
  { equalityCheck: (next, previous) => next.stable === previous?.stable },
);

regExternalSub(
  'external-lifecycle-rollback',
  () => [['external-lifecycle-source']],
  () =>
    createDriver(
      (inputs) => Number(inputs[0]),
      () => {
        if (failNextActivation) {
          failNextActivation = false;
          throw new Error('expected external activation failure');
        }
      },
    ),
);
regExternalSub(
  'external-rapid-parameter',
  () => [],
  (id: number) => createDriver(() => id),
);

beforeEach(() => {
  clearSubscriptionCache();
  initState({ 'external-lifecycle-source': 10 });
  currentValue = 1;
  invalidateCurrent = undefined;
  invalidateEquality = undefined;
  invalidateReadError = undefined;
  invalidateBatchSource = undefined;
  invalidateBatchDependent = undefined;
  batchSourceValue = 1;
  externalInvalidationDerivedRuns = 0;
  failNextActivation = true;
  failNextSync = true;
  failExternalRead = true;
  syncOrder = [];
  createdDrivers = [];
});

describe('external subscription lifecycle', () => {
  it('reads dormant values synchronously and disposes a swept driver', () => {
    const value = getSubscriptionValue<number>(['external-lifecycle-dormant']);
    const driver = createdDrivers[0]!;

    expect(value).toBe(11);
    expect(getSubscriptionValue<number>(['external-lifecycle-dormant'])).toBe(11);
    expect(driver.read).toHaveBeenCalledWith([10]);
    expect(driver.read).toHaveBeenCalledTimes(1);
    expect(driver.activate).not.toHaveBeenCalled();
    expect(driver.sync).not.toHaveBeenCalled();
    expect(getSubscriptionDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: JSON.stringify(['external-lifecycle-dormant']),
          kind: 'external',
          active: false,
          status: 'value',
          value: 11,
        }),
      ]),
    );

    sweepProvisionalSubscriptions();
    expect(driver.dispose).not.toHaveBeenCalled();
    sweepProvisionalSubscriptions();

    expect(driver.dispose).toHaveBeenCalledTimes(1);
    expect(getSubscriptionDiagnostics()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: JSON.stringify(['external-lifecycle-dormant']) }),
      ]),
    );
  });

  it('activates once for shared consumers and disposes after the final release', () => {
    const node = getOrCreateSubscription(['external-lifecycle-shared'])!;
    const driver = createdDrivers[0]!;
    const firstListener = jest.fn();
    const secondListener = jest.fn();

    const unsubscribeFirst = subscribeToSubscription(node, firstListener);
    const unsubscribeSecond = subscribeToSubscription(node, secondListener);

    expect(driver.activate).toHaveBeenCalledTimes(1);
    expect(driver.activate).toHaveBeenCalledWith([], expect.any(Object));
    expect(Object.isFrozen(driver.activate.mock.calls[0]![1])).toBe(true);
    expect(driver.read).toHaveBeenCalledTimes(2);
    expect(getSubscriptionDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: JSON.stringify(['external-lifecycle-shared']),
          kind: 'external',
          active: true,
        }),
      ]),
    );

    unsubscribeFirst();
    expect(driver.dispose).not.toHaveBeenCalled();

    unsubscribeSecond();
    expect(driver.dispose).toHaveBeenCalledTimes(1);
    expect(getSubscriptionDiagnostics()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: JSON.stringify(['external-lifecycle-shared']) }),
      ]),
    );
  });

  it('rolls dependency activation back and disposes a driver that fails to activate', () => {
    const node = getOrCreateSubscription(['external-lifecycle-rollback'])!;
    const listener = jest.fn();

    expect(() => subscribeToSubscription(node, listener)).toThrow(
      'expected external activation failure',
    );
    const failedDriver = createdDrivers[0]!;
    expect(failedDriver.dispose).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    expect(getSubscriptionDiagnostics()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: JSON.stringify(['external-lifecycle-rollback']) }),
      ]),
    );

    const retryNode = getOrCreateSubscription(['external-lifecycle-rollback'])!;
    const unsubscribe = subscribeToSubscription(retryNode, listener);
    const recoveredDriver = createdDrivers[1]!;
    expect(recoveredDriver.activate).toHaveBeenCalledTimes(1);
    expect(getSubscriptionValue<number>(['external-lifecycle-rollback'])).toBe(10);

    unsubscribe();
    expect(recoveredDriver.dispose).toHaveBeenCalledTimes(1);
  });

  it('revalidates a dormant snapshot after activation before consumers observe it', () => {
    const node = getOrCreateSubscription(['external-invalidation-source'])!;
    expect(getSubscriptionSnapshot(node)).toBe(1);
    const driver = createdDrivers[0]!;
    currentValue = 2;

    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(node, listener);

    expect(driver.read).toHaveBeenCalledTimes(2);
    expect(getSubscriptionSnapshot(node)).toBe(2);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('revalidates computed dependents after activating an external graph', () => {
    const node = getOrCreateSubscription(['external-invalidation-derived'])!;
    expect(getSubscriptionSnapshot(node)).toBe(1);
    const driver = createdDrivers[0]!;
    currentValue = 2;

    const unsubscribe = subscribeToSubscription(node, () => {});

    expect(driver.read).toHaveBeenCalledTimes(2);
    expect(getSubscriptionSnapshot(node)).toBe(2);
    expect(externalInvalidationDerivedRuns).toBe(2);
    unsubscribe();
  });

  it('does not recompute a dependent when activation catch-up reads an equal snapshot', () => {
    const node = getOrCreateSubscription(['external-invalidation-derived'])!;
    expect(getSubscriptionSnapshot(node)).toBe(1);
    const driver = createdDrivers[0]!;

    const unsubscribe = subscribeToSubscription(node, () => {});

    expect(driver.read).toHaveBeenCalledTimes(2);
    expect(externalInvalidationDerivedRuns).toBe(1);
    expect(getSubscriptionSnapshot(node)).toBe(1);
    unsubscribe();
  });

  it('publishes invalidation bursts in waves and deduplicates reentrant callbacks', () => {
    const node = getOrCreateSubscription(['external-invalidation-source'])!;
    const listener = jest.fn(() => {
      if (currentValue === 2) {
        for (let value = 3; value <= 32; value++) {
          currentValue = value;
          invalidateCurrent?.();
        }
      }
    });
    const unsubscribe = subscribeToSubscription(node, listener);
    const driver = createdDrivers[0]!;

    currentValue = 2;
    invalidateCurrent!();

    expect(driver.read).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getSubscriptionSnapshot(node)).toBe(32);
    unsubscribe();
  });

  it('settles computed intermediates before related batched external roots', () => {
    const dependent = getOrCreateSubscription(['external-batch-dependent'])!;
    const unsubscribeDependent = subscribeToSubscription(dependent, () => {});
    const dependentDriver = createdDrivers[1]!;
    const trigger = getOrCreateSubscription(['external-lifecycle-source'])!;
    const unsubscribeTrigger = subscribeToSubscription(trigger, () => {
      invalidateBatchSource!();
      invalidateBatchDependent!();
    });

    batchSourceValue = 2;
    initState({ 'external-lifecycle-source': 20 });

    expect(dependentDriver.sync).toHaveBeenCalledTimes(1);
    expect(dependentDriver.read).toHaveBeenLastCalledWith([2]);
    unsubscribeTrigger();
    unsubscribeDependent();
  });

  it('releases rapidly churned parameter vectors without retaining external nodes', () => {
    for (let id = 0; id < 32; id++) {
      const node = getOrCreateSubscription(['external-rapid-parameter', id])!;
      const unsubscribe = subscribeToSubscription(node, () => {});

      expect(getSubscriptionSnapshot(node)).toBe(id);
      unsubscribe();
    }

    expect(createdDrivers).toHaveLength(32);
    for (const driver of createdDrivers) {
      expect(driver.activate).toHaveBeenCalledTimes(1);
      expect(driver.dispose).toHaveBeenCalledTimes(1);
    }
    expect(
      getSubscriptionDiagnostics().some(
        (diagnostic) => diagnostic.query[0] === 'external-rapid-parameter',
      ),
    ).toBe(false);

    const rebuilt = getOrCreateSubscription(['external-rapid-parameter', 7])!;
    expect(rebuilt).not.toBeNull();
    expect(getSubscriptionValue<number>(['external-rapid-parameter', 7])).toBe(7);
    expect(createdDrivers).toHaveLength(33);
  });

  it('rejects clearing an active graph and disposes a dormant source when cleared', () => {
    const active = getOrCreateSubscription(['external-invalidation-source'])!;
    const unsubscribe = subscribeToSubscription(active, () => {});

    expect(() => clearSubscriptionCache(JSON.stringify(['external-invalidation-source']))).toThrow(
      'Cannot clear subscriptions while a subscription graph is active',
    );
    unsubscribe();

    const dormant = getOrCreateSubscription(['external-lifecycle-dormant'])!;
    const dormantDriver = createdDrivers.at(-1)!;
    expect(getSubscriptionSnapshot(dormant)).toBe(11);
    clearSubscriptionCache(JSON.stringify(['external-lifecycle-dormant']));

    expect(dormantDriver.dispose).toHaveBeenCalledTimes(1);
    expect(
      getSubscriptionDiagnostics().some(
        (diagnostic) => diagnostic.query[0] === 'external-lifecycle-dormant',
      ),
    ).toBe(false);
  });

  it('reconciles external dependency inputs even when the mapped value is equal', () => {
    const node = getOrCreateSubscription(['external-dependency-sync'])!;
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(node, listener);
    const driver = createdDrivers[0]!;

    expect(driver.activate).toHaveBeenCalledWith([10], expect.any(Object));
    initState({ 'external-lifecycle-source': 20 });

    expect(driver.read).toHaveBeenCalledTimes(3);
    expect(driver.sync).toHaveBeenCalledTimes(1);
    expect(driver.sync).toHaveBeenCalledWith([20]);
    expect(listener).not.toHaveBeenCalled();
    expect(getSubscriptionSnapshot(node)).toBe(7);
    unsubscribe();
  });

  it('retains sync debt and recovers without another dependency update', () => {
    const node = getOrCreateSubscription(['external-sync-error-derived'])!;
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(node, listener);
    const driver = createdDrivers[0]!;

    initState({ 'external-lifecycle-source': 20 });

    expect(driver.sync).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSubscriptionDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: JSON.stringify(['external-sync-error']),
          status: 'error',
          error: 'expected external sync failure',
        }),
        expect.objectContaining({
          key: JSON.stringify(['external-sync-error-derived']),
          status: 'error',
          error: 'expected external sync failure',
        }),
      ]),
    );

    failNextSync = false;
    expect(getSubscriptionSnapshot(node)).toBe(8);

    expect(driver.sync).toHaveBeenCalledTimes(2);
    expect(driver.sync).toHaveBeenLastCalledWith([20]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('reconciles changed inputs even when reading their snapshot fails', () => {
    const node = getOrCreateSubscription(['external-read-error'])!;
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(node, listener);
    const driver = createdDrivers[0]!;

    initState({ 'external-lifecycle-source': 20 });

    expect(driver.sync).toHaveBeenCalledTimes(1);
    expect(driver.sync).toHaveBeenCalledWith([20]);
    expect(getSubscriptionDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: JSON.stringify(['external-read-error']),
          status: 'error',
          error: 'expected external read failure',
        }),
      ]),
    );

    failExternalRead = false;
    invalidateReadError!();

    expect(getSubscriptionSnapshot(node)).toBe(20);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(driver.sync).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('runs driver synchronization after graph computation and before listeners', () => {
    const node = getOrCreateSubscription(['external-sync-order-derived'])!;
    const listener = jest.fn(() => syncOrder.push('listener'));
    const unsubscribe = subscribeToSubscription(node, listener);
    syncOrder = [];

    initState({ 'external-lifecycle-source': 20 });

    expect(syncOrder).toEqual(['read', 'compute', 'sync', 'listener']);
    expect(getSubscriptionSnapshot(node)).toBe(40);
    unsubscribe();
  });

  it('applies external equality before notifying dependents', () => {
    const node = getOrCreateSubscription(['external-equality-source'])!;
    const listener = jest.fn();
    const unsubscribe = subscribeToSubscription(node, listener);

    const driver = createdDrivers[0]!;
    currentValue = 2;
    invalidateEquality!();

    expect(driver.read).toHaveBeenCalledTimes(3);
    expect(listener).not.toHaveBeenCalled();
    expect(getSubscriptionSnapshot(node)).toEqual({ stable: 1, source: 1 });
    unsubscribe();
  });

  it('ignores invalidation callbacks retained from a disposed activation', () => {
    const firstNode = getOrCreateSubscription(['external-invalidation-source'])!;
    const firstUnsubscribe = subscribeToSubscription(firstNode, () => {});
    const oldInvalidate = invalidateCurrent!;
    firstUnsubscribe();

    const secondNode = getOrCreateSubscription(['external-invalidation-source'])!;
    const secondUnsubscribe = subscribeToSubscription(secondNode, () => {});
    const secondDriver = createdDrivers[1]!;
    oldInvalidate();

    expect(secondDriver.read).toHaveBeenCalledTimes(2);
    currentValue = 2;
    invalidateCurrent!();
    expect(secondDriver.read).toHaveBeenCalledTimes(3);
    secondUnsubscribe();
  });

  it('traces source invalidation separately from state-driven publication', async () => {
    const traces: Array<{ opType?: string; operation?: string; tags?: Record<string, unknown> }> =
      [];
    enableTracing();
    registerTraceCallback(EXTERNAL_TRACE_CALLBACK, (batch) => traces.push(...batch));
    try {
      const node = getOrCreateSubscription(['external-invalidation-source'])!;
      const unsubscribe = subscribeToSubscription(node, () => {});
      currentValue = 2;
      invalidateCurrent!();

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(traces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            opType: 'sub/ext',
            operation: 'external-invalidation-source',
          }),
        ]),
      );
      unsubscribe();
    } finally {
      removeTraceCallback(EXTERNAL_TRACE_CALLBACK);
      disableTracing();
    }
  });

  it('traces state dependency recomputation with subscription keys', async () => {
    const traces: Array<{ opType?: string; operation?: string; tags?: Record<string, unknown> }> =
      [];
    enableTracing();
    registerTraceCallback(EXTERNAL_TRACE_CALLBACK, (batch) => traces.push(...batch));
    try {
      const node = getOrCreateSubscription(['external-sync-order-derived'])!;
      const unsubscribe = subscribeToSubscription(node, () => {});
      initState({ 'external-lifecycle-source': 30 });

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(traces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            opType: 'sub/run',
            operation: 'external-sync-order',
            tags: expect.objectContaining({
              subscriptionKey: JSON.stringify(['external-sync-order']),
            }),
          }),
          expect.objectContaining({
            opType: 'sub/run',
            operation: 'external-sync-order-derived',
            tags: expect.objectContaining({
              subscriptionKey: JSON.stringify(['external-sync-order-derived']),
            }),
          }),
        ]),
      );
      unsubscribe();
    } finally {
      removeTraceCallback(EXTERNAL_TRACE_CALLBACK);
      disableTracing();
    }
  });
});

function createDriver<TResult>(
  read: (inputs: readonly unknown[]) => TResult,
  activate: (inputs: readonly unknown[], context: ExternalSubscriptionContext) => void = () => {},
): TestDriver<TResult> {
  const driver: TestDriver<TResult> = {
    read: jest.fn(read),
    activate: jest.fn((inputs, context) => {
      return activate(inputs, context);
    }),
    sync: jest.fn(),
    dispose: jest.fn(),
  };
  createdDrivers.push(driver);
  return driver;
}
