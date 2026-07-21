import type { ReflexContracts } from '../contracts';
import { createReflexRuntime, type RuntimeEventHandler } from '../runtime/runtime';
import { waitForScheduled } from './test-utils';

interface CounterContracts extends ReflexContracts {
  db: { count: number; label: string };
  events: {
    increment: [amount: number];
    cascade: [amount: number];
  };
  subscriptions: {
    count: { params: []; result: number };
  };
}

function createCounterRuntime(runtimeId: string, count: number) {
  const runtime = createReflexRuntime<CounterContracts>({
    initialDb: { count, label: runtimeId },
    runtimeId,
    name: `Runtime ${runtimeId}`,
  });
  runtime.regSub('count');
  runtime.regEvent('increment', ({ draftDb }, amount) => {
    draftDb.count += amount;
  });
  runtime.regEvent('cascade', (_coeffects, amount) => [['dispatch', ['increment', amount]]]);
  return runtime;
}

describe('instance-scoped runtime', () => {
  it('does not expose its kernel or direct kernel state on the runtime object', () => {
    const runtime = createCounterRuntime('private-kernel', 0);

    const publicRuntime = runtime as unknown as Record<string, unknown>;
    expect(Object.hasOwn(publicRuntime, 'kernel')).toBe(false);
    expect(publicRuntime.kernel).toBeUndefined();
    expect(publicRuntime.appDb).toBeUndefined();
    expect(publicRuntime.handlers).toBeUndefined();
    expect(publicRuntime.extensions).toBeUndefined();

    runtime.dispose();
  });

  it('isolates db heads, handlers, queues, subscriptions, and inspectors', async () => {
    const first = createCounterRuntime('first', 1);
    const second = createCounterRuntime('second', 10);

    const firstValues: number[] = [];
    const secondValues: number[] = [];
    const unwatchFirst = first.watchSubscription(['count'], (value) => firstValues.push(value));
    const unwatchSecond = second.watchSubscription(['count'], (value) => secondValues.push(value));

    first.dispatch(['increment', 2]);
    second.dispatch(['increment', 5]);
    await Promise.all([first.flush(), second.flush()]);

    expect(first.getAppDb()).toEqual({ count: 3, label: 'first' });
    expect(second.getAppDb()).toEqual({ count: 15, label: 'second' });
    expect(firstValues).toEqual([1, 3]);
    expect(secondValues).toEqual([10, 15]);

    const firstInspector = first.createInspector();
    const secondInspector = second.createInspector();
    expect(firstInspector).toMatchObject({
      apiVersion: 2,
      runtimeId: 'first',
      runtimeName: 'Runtime first',
    });
    expect(secondInspector).toMatchObject({
      apiVersion: 2,
      runtimeId: 'second',
      runtimeName: 'Runtime second',
    });
    expect(firstInspector.getSnapshot().appDb).toBe(first.getAppDb());
    expect(secondInspector.getSnapshot().appDb).toBe(second.getAppDb());

    first.clearHandlers('event');
    expect(first.getHandlers().event.increment).toBeUndefined();
    expect(second.getHandlers().event.increment).toBeDefined();

    unwatchFirst();
    unwatchSecond();
    first.dispose();
    second.dispose();
  });

  it('flushes effect-dispatched events through the first quiescent boundary', async () => {
    const runtime = createCounterRuntime('flush-cascade', 0);

    runtime.dispatch(['cascade', 4]);
    await runtime.flush();

    expect(runtime.getAppDb().count).toBe(4);
    runtime.dispose();
  });

  it('rejects flush on queue failure and remains usable afterward', async () => {
    const runtime = createCounterRuntime('flush-error', 0);
    runtime.regEvent('increment', () => {
      throw new Error('queue failed');
    });

    runtime.dispatch(['increment', 1]);
    await expect(runtime.flush()).rejects.toThrow('queue failed');

    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });
    runtime.dispatch(['increment', 2]);
    await expect(runtime.flush()).resolves.toBeUndefined();
    expect(runtime.getAppDb().count).toBe(2);
    runtime.dispose();
  });

  it('reports an unobserved queue failure to the next flush, not a later one', async () => {
    const runtime = createCounterRuntime('flush-pending-error', 0);
    runtime.regEvent('increment', () => {
      throw new Error('unobserved queue failure');
    });

    runtime.dispatch(['increment', 1]);
    await waitForScheduled();

    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });
    runtime.dispatch(['increment', 2]);

    await expect(runtime.flush()).rejects.toThrow('unobserved queue failure');
    await expect(runtime.flush()).resolves.toBeUndefined();
    expect(runtime.getAppDb().count).toBe(2);
    runtime.dispose();
  });

  it('restores synchronously when idle and rejects restore with pending work', async () => {
    const runtime = createCounterRuntime('restore', 0);

    runtime.dispatch(['increment', 1]);
    expect(() => runtime.restoreAppDb({ count: 20, label: 'bad-order' })).toThrow(
      'while an event is pending',
    );
    await runtime.flush();

    const values: number[] = [];
    const unwatch = runtime.watchSubscription(['count'], (value) => values.push(value));
    runtime.restoreAppDb({ count: 20, label: 'restored' });

    expect(runtime.getAppDb()).toEqual({ count: 20, label: 'restored' });
    expect(values).toEqual([1, 20]);
    unwatch();
    runtime.dispose();
  });

  it('subscribes before the initial watch callback can synchronously update state', () => {
    const runtime = createCounterRuntime('watch-reentrant-initial', 0);
    const values: Array<[number, number | undefined]> = [];

    const unwatch = runtime.watchSubscription(['count'], (value, previousValue) => {
      values.push([value, previousValue]);
      if (value === 0 && previousValue === undefined) runtime.dispatchSync(['increment', 1]);
    });

    expect(runtime.getAppDb().count).toBe(1);
    expect(values).toEqual([
      [0, undefined],
      [1, 0],
    ]);

    runtime.dispatchSync(['increment', 1]);
    expect(values.at(-1)).toEqual([2, 1]);
    unwatch();
    runtime.dispose();
  });

  it('releases the subscription when an initial watch callback throws', () => {
    const runtime = createCounterRuntime('watch-initial-error', 0);

    expect(() =>
      runtime.watchSubscription(['count'], () => {
        throw new Error('initial listener failed');
      }),
    ).toThrow('initial listener failed');
    expect(() => runtime.clearSubs()).not.toThrow();
    runtime.dispose();
  });

  it('rejects invalid runtime database values at creation and restore boundaries', () => {
    expect(() =>
      createReflexRuntime({ initialDb: null, runtimeId: 'invalid-null-db' } as any),
    ).toThrow('initialDb must be a non-null, non-array object');
    expect(() =>
      createReflexRuntime({ initialDb: [], runtimeId: 'invalid-array-db' } as any),
    ).toThrow('initialDb must be a non-null, non-array object');
    expect(() =>
      createReflexRuntime({ initialDb: 1, runtimeId: 'invalid-primitive-db' } as any),
    ).toThrow('initialDb must be a non-null, non-array object');

    const runtime = createCounterRuntime('restore-validation', 3);
    expect(() => (runtime.restoreAppDb as (value: unknown) => void)(null)).toThrow(
      'restoreAppDb nextDb must be a non-null, non-array object',
    );
    expect(() => (runtime.restoreAppDb as (value: unknown) => void)([])).toThrow(
      'restoreAppDb nextDb must be a non-null, non-array object',
    );
    expect(() => (runtime.restoreAppDb as (value: unknown) => void)(1)).toThrow(
      'restoreAppDb nextDb must be a non-null, non-array object',
    );
    expect(runtime.getAppDb()).toEqual({ count: 3, label: 'restore-validation' });
    runtime.dispose();
  });

  it('fails loudly on unknown ids through the instance API', () => {
    const runtime = createCounterRuntime('fail-loud', 0);

    expect(() => runtime.dispatch(['missing-event'] as never)).toThrow(
      "No event handler registered for 'missing-event' in runtime 'fail-loud'",
    );
    expect(() => runtime.dispatchSync(['missing-event'] as never)).toThrow(
      "No event handler registered for 'missing-event' in runtime 'fail-loud'",
    );
    expect(() => runtime.dispatch([1] as never)).toThrow(
      'dispatch expects a non-empty event vector',
    );
    expect(() => runtime.getSubscriptionValue(['missing-sub'] as never)).toThrow(
      "No subscription registered for 'missing-sub' in runtime 'fail-loud'",
    );
    expect(() => runtime.watchSubscription(['missing-sub'] as never, () => {})).toThrow(
      "No subscription registered for 'missing-sub' in runtime 'fail-loud'",
    );
    expect(runtime.getAppDb().count).toBe(0);
    runtime.dispose();
  });

  it('rejects non-string runtime identities at the JavaScript boundary', () => {
    expect(() => createReflexRuntime({ initialDb: {}, runtimeId: 1 } as any)).toThrow(
      'runtimeId must be 1-128 characters',
    );
    expect(() =>
      createReflexRuntime({ initialDb: {}, runtimeId: 'valid-id', name: 1 } as any),
    ).toThrow('runtime name must be between 1 and 128 characters');
  });

  it('installs and disposes feature registrations idempotently by generation', () => {
    const runtime = createCounterRuntime('modules', 0);
    const builtInDispatchEffect = runtime.getHandlers().fx.dispatch;
    const sharedHandler: RuntimeEventHandler<CounterContracts, 'increment'> = ({ draftDb }) => {
      draftDb.count += 1;
    };

    const disposeFirst = runtime.registerModule((scope) => {
      scope.regEvent('increment', sharedHandler);
    });
    const disposeSecond = runtime.registerModule((scope) => {
      scope.regEvent('increment', sharedHandler);
    });
    const disposeBuiltInOverride = runtime.registerModule((scope) => {
      scope.regEffect('dispatch', () => {});
    });

    disposeFirst();
    runtime.dispatchSync(['increment', 999]);
    expect(runtime.getAppDb().count).toBe(1);

    disposeSecond();
    disposeSecond();
    expect(runtime.getHandlers().event.increment).toBeUndefined();
    disposeBuiltInOverride();
    expect(runtime.getHandlers().fx.dispatch).toBe(builtInDispatchEffect);
    runtime.dispose();
  });

  it('refuses to dispose a feature while its subscription graph is active', () => {
    const runtime = createReflexRuntime({
      initialDb: { value: 1 },
      runtimeId: 'active-module',
    });
    let cleanedUp = false;
    const disposeFeature = runtime.registerModule((scope) => {
      scope.regSub('value');
      return () => {
        cleanedUp = true;
      };
    });
    const unwatch = runtime.watchSubscription(['value'], () => {});

    expect(() => disposeFeature()).toThrow('subscription graph is active');
    expect(cleanedUp).toBe(false);
    unwatch();
    expect(() => disposeFeature()).not.toThrow();
    expect(cleanedUp).toBe(true);
    expect(runtime.getHandlers().sub.value).toBeUndefined();
    runtime.dispose();
  });

  it('disposes an inactive feature while an unrelated subscription remains active', () => {
    const runtime = createReflexRuntime({
      initialDb: { feature: 1, shell: 2 },
      runtimeId: 'unrelated-active-module',
    });
    runtime.regSub('shell');
    const disposeFeature = runtime.registerModule((scope) => scope.regSub('feature'));
    const unwatchShell = runtime.watchSubscription(['shell'], () => {});

    expect(() => disposeFeature()).not.toThrow();
    expect(runtime.getHandlers().sub.feature).toBeUndefined();
    expect(runtime.getHandlers().sub.shell).toBeDefined();
    expect(runtime.getSubscriptionValue(['shell'])).toBe(2);

    unwatchShell();
    runtime.dispose();
  });

  it('keeps trace callbacks and trace ids scoped to their runtime', async () => {
    const first = createCounterRuntime('trace-first', 0);
    const second = createCounterRuntime('trace-second', 0);
    const firstTraces: Array<{ id: number; tags?: Record<string, unknown> }> = [];
    const secondTraces: Array<{ id: number; tags?: Record<string, unknown> }> = [];
    const removeFirst = first.createInspector().subscribeTraces((traces) => {
      firstTraces.push(...traces);
    });
    const removeSecond = second.createInspector().subscribeTraces((traces) => {
      secondTraces.push(...traces);
    });

    first.dispatchSync(['increment', 1]);
    second.dispatchSync(['increment', 2]);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(
      firstTraces.some((trace) => JSON.stringify(trace.tags).includes('["increment",1]')),
    ).toBe(true);
    expect(
      firstTraces.some((trace) => JSON.stringify(trace.tags).includes('["increment",2]')),
    ).toBe(false);
    expect(
      secondTraces.some((trace) => JSON.stringify(trace.tags).includes('["increment",2]')),
    ).toBe(true);
    expect(Math.min(...firstTraces.map((trace) => trace.id))).toBe(1);
    expect(Math.min(...secondTraces.map((trace) => trace.id))).toBe(1);

    removeFirst();
    removeSecond();
    first.dispose();
    second.dispose();
  });

  it('terminally disposes an explicit runtime', () => {
    const runtime = createCounterRuntime('disposed', 0);
    const inspector = runtime.createInspector();
    const removeTraceListener = inspector.subscribeTraces(() => {});
    runtime.dispose();
    runtime.dispose();
    removeTraceListener();
    removeTraceListener();

    expect(() => runtime.getAppDb()).toThrow("Runtime 'disposed' has been disposed");
    expect(() => runtime.dispatch(['increment', 1])).toThrow(
      "Runtime 'disposed' has been disposed",
    );
    expect(() => inspector.getSnapshot()).toThrow("Runtime 'disposed' has been disposed");
    expect(() => inspector.dispatch(['increment', 1])).toThrow(
      "Runtime 'disposed' has been disposed",
    );
  });

  it('disposing one runtime leaves other runtime state and inspectors usable', () => {
    const disposed = createCounterRuntime('dispose-first', 1);
    const surviving = createCounterRuntime('dispose-second', 10);
    const survivingInspector = surviving.createInspector();

    disposed.dispose();

    expect(() => disposed.getAppDb()).toThrow("Runtime 'dispose-first' has been disposed");
    surviving.dispatchSync(['increment', 5]);
    expect(surviving.getAppDb()).toEqual({ count: 15, label: 'dispose-second' });
    expect(survivingInspector.getSnapshot().appDb).toEqual({ count: 15, label: 'dispose-second' });

    surviving.dispose();
  });
});
