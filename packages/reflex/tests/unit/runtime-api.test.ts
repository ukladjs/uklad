import type { ReflexContracts } from '../../src/contracts';
import {
  clearRuntimeSubsForHotReload,
  createReflexRuntime as createProductionRuntime,
  createReflexRuntimeForTests as createReflexRuntime,
  getRuntimeClient,
  getRuntimeAdminForTests,
  getRuntimeCoreForTests,
  type ReflexRuntime,
  type RuntimeEventHandler,
} from '../../src/runtime/runtime';
import { createReflexInspector } from '../../src/devtools';
import { waitForScheduled } from './test-utils';

import type { Interceptor } from '../../src/types';

interface CounterContracts extends ReflexContracts {
  state: { count: number; label: string };
  events: {
    increment: [amount: number];
    cascade: [amount: number];
    fail: [];
    'module-increment': [amount: number];
  };
  subscriptions: {
    count: { params: []; result: number };
  };
}

function createCounterRuntime(runtimeId: string, count: number) {
  const runtime = createReflexRuntime<CounterContracts>({
    initialState: { count, label: runtimeId },
    runtimeId,
    name: `Runtime ${runtimeId}`,
  });
  runtime.regRootSub('count', 'count');
  runtime.regEvent('increment', ({ draftState }, amount) => {
    draftState.count += amount;
  });
  runtime.regEvent('cascade', (_coeffects, amount) => [['dispatch', ['increment', amount]]]);
  return runtime;
}

function admin<TContracts extends ReflexContracts>(runtime: ReflexRuntime<TContracts>) {
  return getRuntimeAdminForTests(runtime);
}

describe('instance-scoped runtime', () => {
  it('eagerly owns one stable set of typed core services', () => {
    const runtime = createCounterRuntime('stable-core', 0);
    const core = getRuntimeCoreForTests(runtime);

    expect(Object.keys(core).sort()).toEqual([
      'events',
      'identity',
      'probe',
      'registry',
      'state',
      'subscriptions',
    ]);
    expect(core.state).toBeDefined();
    expect(core.registry).toBeDefined();
    expect(core.events).toBeDefined();
    expect(core.subscriptions).toBeDefined();
    expect(core.probe).toBeUndefined();

    const eventDefinition = core.events.getEvent('increment');
    expect(eventDefinition).toBe(core.events.getEvent('increment'));
    expect(Object.isFrozen(eventDefinition)).toBe(true);
    expect(Object.isFrozen(eventDefinition?.interceptors)).toBe(true);

    runtime.dispose();
  });

  it('exposes a frozen production facade without admin or diagnostic controls', () => {
    const runtime = createProductionRuntime({
      initialState: { count: 0, label: 'production-facade' },
      runtimeId: 'production-facade',
    });
    const exposed = runtime as unknown as Record<string, unknown>;

    expect(Object.isFrozen(runtime)).toBe(true);
    for (const adminMethod of [
      'getHandlers',
      'clearHandlers',
      'restoreState',
      'dispatchSync',
      'createInspector',
      'enableTracing',
      'getSubscriptionDiagnostics',
    ]) {
      expect(exposed[adminMethod]).toBeUndefined();
    }

    runtime.dispose();
  });

  it('rejects owner-only operations when given the app client facade', () => {
    const runtime = createCounterRuntime('owner-capability', 0);
    const client = getRuntimeClient(runtime);

    expect(() => clearRuntimeSubsForHotReload(client as never)).toThrow(
      'setupSubsHotReload requires a runtime created by createReflexRuntime()',
    );

    runtime.dispose();
  });

  it('owns global interceptors in the event runtime', () => {
    const runtime = createCounterRuntime('runtime-interceptors', 0);
    const core = getRuntimeCoreForTests(runtime);
    const interceptor: Interceptor<CounterContracts['state']> = {
      id: 'runtime-interceptor',
      before: jest.fn((context) => context),
    };

    runtime.registerInterceptor(interceptor);

    expect(admin(runtime).getInterceptors()).toEqual([interceptor]);
    expect(core.events.getInterceptors()).toEqual([interceptor]);
    expect(Object.hasOwn(core.registry, 'globalInterceptors')).toBe(false);
    expect('registerGlobalInterceptor' in core.registry).toBe(false);
    expect(Object.hasOwn(core.registry, 'eventDefinitions')).toBe(false);

    runtime.dispatchSync(['increment', 1]);
    expect(interceptor.before).toHaveBeenCalledTimes(1);

    runtime.dispose();
  });

  it('does not allocate development effect lineage state without an observer', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'effect-hot-path',
    });
    runtime.regEvent('warm-up', () => {});
    runtime.regEffect('save', () => {});
    runtime.regEvent('save', ({ draftState }) => {
      draftState.count += 1;
      return [['save', { source: 'test' }]];
    });

    try {
      runtime.dispatch(['warm-up']);
      await runtime.flush();
      expect(getRuntimeCoreForTests(runtime).probe).toBeUndefined();

      runtime.dispatch(['save']);
      await runtime.flush();

      expect(runtime.getState().count).toBe(1);
      expect(getRuntimeCoreForTests(runtime).probe).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });

  it('isolates development observer notification failures from event execution', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'observer-isolation',
    });
    runtime.regEvent('increment', ({ draftState }) => {
      draftState.count += 1;
    });
    const detach = createReflexInspector(runtime)
      .getOperationRuntime()
      .observeExecution({
        accept: () => ({ operationId: 'test-operation', value: {} }),
        queued: () => {
          throw new Error('expected observer failure');
        },
        started: () => {},
        transition: () => {},
        committed: () => {},
        finished: () => {},
        dropped: () => {},
        published: () => {},
        disposed: () => {},
      });

    try {
      runtime.dispatch(['increment']);
      await runtime.flush();
      expect(runtime.getState().count).toBe(1);
    } finally {
      detach();
      runtime.dispose();
    }
  });

  it('continues ordinary dispatch when a development observer rejects acceptance', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'observer-acceptance',
    });
    runtime.regEvent('increment', ({ draftState }) => {
      draftState.count += 1;
    });
    const detach = createReflexInspector(runtime)
      .getOperationRuntime()
      .observeExecution({
        accept: () => {
          throw new Error('expected acceptance failure');
        },
        queued: () => {},
        started: () => {},
        transition: () => {},
        committed: () => {},
        finished: () => {},
        dropped: () => {},
        published: () => {},
        disposed: () => {},
      });

    try {
      runtime.dispatch(['increment']);
      await runtime.flush();
      expect(runtime.getState().count).toBe(1);
      expect(() =>
        createReflexInspector(runtime)
          .getOperationRuntime()
          .dispatch(['increment'] as never),
      ).toThrow('operation dispatch could not be accepted');
      await runtime.flush();
      expect(runtime.getState().count).toBe(1);
    } finally {
      detach();
      runtime.dispose();
    }
  });

  it('does not expose its core or direct core state on the runtime object', () => {
    const runtime = createCounterRuntime('private-core', 0);

    const publicRuntime = runtime as unknown as Record<string, unknown>;
    expect(Object.hasOwn(publicRuntime, 'core')).toBe(false);
    expect(publicRuntime.core).toBeUndefined();
    expect(Object.hasOwn(publicRuntime, 'kernel')).toBe(false);
    expect(publicRuntime.kernel).toBeUndefined();
    expect(publicRuntime.state).toBeUndefined();
    expect(publicRuntime.handlers).toBeUndefined();
    expect(publicRuntime.extensions).toBeUndefined();

    runtime.dispose();
  });

  it('isolates state heads, handlers, queues, subscriptions, and inspectors', async () => {
    const first = createCounterRuntime('first', 1);
    const second = createCounterRuntime('second', 10);

    const firstValues: number[] = [];
    const secondValues: number[] = [];
    const unwatchFirst = first.watchSubscription(['count'], (value) => firstValues.push(value));
    const unwatchSecond = second.watchSubscription(['count'], (value) => secondValues.push(value));

    first.dispatch(['increment', 2]);
    second.dispatch(['increment', 5]);
    await Promise.all([first.flush(), second.flush()]);

    expect(first.getState()).toEqual({ count: 3, label: 'first' });
    expect(second.getState()).toEqual({ count: 15, label: 'second' });
    expect(firstValues).toEqual([1, 3]);
    expect(secondValues).toEqual([10, 15]);

    const firstInspector = createReflexInspector(first);
    const secondInspector = createReflexInspector(second);
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
    expect(firstInspector.getSnapshot().state).toBe(first.getState());
    expect(secondInspector.getSnapshot().state).toBe(second.getState());

    unwatchFirst();
    admin(first).clearHandlers();
    expect(admin(first).getHandlers().event.increment).toBeUndefined();
    expect(admin(second).getHandlers().event.increment).toBeDefined();

    unwatchSecond();
    first.dispose();
    second.dispose();
  });

  it('flushes effect-dispatched events through the first quiescent boundary', async () => {
    const runtime = createCounterRuntime('flush-cascade', 0);

    runtime.dispatch(['cascade', 4]);
    await runtime.flush();

    expect(runtime.getState().count).toBe(4);
    runtime.dispose();
  });

  it('rejects flush on queue failure and remains usable afterward', async () => {
    const runtime = createCounterRuntime('flush-error', 0);
    runtime.regEvent('fail', () => {
      throw new Error('queue failed');
    });

    runtime.dispatch(['fail']);
    await expect(runtime.flush()).rejects.toThrow('queue failed');

    runtime.dispatch(['increment', 2]);
    await expect(runtime.flush()).resolves.toBeUndefined();
    expect(runtime.getState().count).toBe(2);
    runtime.dispose();
  });

  it('reports an unobserved queue failure to the next flush, not a later one', async () => {
    const runtime = createCounterRuntime('flush-pending-error', 0);
    runtime.regEvent('fail', () => {
      throw new Error('unobserved queue failure');
    });

    runtime.dispatch(['fail']);
    await waitForScheduled();

    runtime.dispatch(['increment', 2]);

    await expect(runtime.flush()).rejects.toThrow('unobserved queue failure');
    await expect(runtime.flush()).resolves.toBeUndefined();
    expect(runtime.getState().count).toBe(2);
    runtime.dispose();
  });

  it('restores synchronously when idle and rejects restore with pending work', async () => {
    const runtime = createCounterRuntime('restore', 0);

    runtime.dispatch(['increment', 1]);
    expect(() => admin(runtime).restoreState({ count: 20, label: 'bad-order' })).toThrow(
      'while an event is pending',
    );
    await runtime.flush();

    const values: number[] = [];
    const unwatch = runtime.watchSubscription(['count'], (value) => values.push(value));
    admin(runtime).restoreState({ count: 20, label: 'restored' });

    expect(runtime.getState()).toEqual({ count: 20, label: 'restored' });
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

    expect(runtime.getState().count).toBe(1);
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
    expect(() => admin(runtime).clearSubs()).not.toThrow();
    runtime.dispose();
  });

  it('rejects invalid runtime state values at creation and restore boundaries', () => {
    expect(() =>
      createReflexRuntime({ initialState: null, runtimeId: 'invalid-null-state' } as any),
    ).toThrow('initialState must be a non-null, non-array object');
    expect(() =>
      createReflexRuntime({ initialState: [], runtimeId: 'invalid-array-state' } as any),
    ).toThrow('initialState must be a non-null, non-array object');
    expect(() =>
      createReflexRuntime({ initialState: 1, runtimeId: 'invalid-primitive-state' } as any),
    ).toThrow('initialState must be a non-null, non-array object');

    const runtime = createCounterRuntime('restore-validation', 3);
    expect(() => (admin(runtime).restoreState as (value: unknown) => void)(null)).toThrow(
      'restoreState nextState must be a non-null, non-array object',
    );
    expect(() => (admin(runtime).restoreState as (value: unknown) => void)([])).toThrow(
      'restoreState nextState must be a non-null, non-array object',
    );
    expect(() => (admin(runtime).restoreState as (value: unknown) => void)(1)).toThrow(
      'restoreState nextState must be a non-null, non-array object',
    );
    expect(runtime.getState()).toEqual({ count: 3, label: 'restore-validation' });
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
    expect(runtime.getState().count).toBe(0);
    runtime.dispose();
  });

  it('rejects non-string runtime identities at the JavaScript boundary', () => {
    expect(() => createReflexRuntime({ initialState: {}, runtimeId: 1 } as any)).toThrow(
      'runtimeId must be 1-128 characters',
    );
    expect(() =>
      createReflexRuntime({ initialState: {}, runtimeId: 'valid-id', name: 1 } as any),
    ).toThrow('runtime name must be between 1 and 128 characters');
  });

  it('rejects duplicate registrations and supports dispose-then-register HMR', () => {
    const runtime = createCounterRuntime('modules', 0);
    const builtInDispatchEffect = admin(runtime).getHandlers().fx.dispatch;
    const sharedHandler: RuntimeEventHandler<CounterContracts, 'module-increment'> = ({
      draftState,
    }) => {
      draftState.count += 1;
    };

    const disposeFirst = runtime.registerModule((scope) => {
      scope.regEvent('module-increment', sharedHandler);
    });
    expect(() =>
      runtime.registerModule((scope) => {
        scope.regEvent('module-increment', sharedHandler);
      }),
    ).toThrow("Registration 'module-increment' is already registered");
    expect(() =>
      runtime.registerModule((scope) => {
        scope.regEffect('dispatch', () => {});
      }),
    ).toThrow("Registration 'dispatch' is already registered");
    expect(admin(runtime).getHandlers().fx.dispatch).toBe(builtInDispatchEffect);

    runtime.dispatchSync(['module-increment', 999]);
    expect(runtime.getState().count).toBe(1);
    disposeFirst();
    expect(admin(runtime).getHandlers().event['module-increment']).toBeUndefined();

    const disposeReplacement = runtime.registerModule((scope) => {
      scope.regEvent('module-increment', sharedHandler);
    });
    runtime.dispatchSync(['module-increment', 999]);
    expect(runtime.getState().count).toBe(2);
    disposeReplacement();
    disposeReplacement();
    expect(admin(runtime).getHandlers().event['module-increment']).toBeUndefined();
    expect(admin(runtime).getHandlers().fx.dispatch).toBe(builtInDispatchEffect);
    runtime.dispose();
  });

  it('refuses to dispose a feature while its subscription graph is active', () => {
    const runtime = createReflexRuntime({
      initialState: { value: 1 },
      runtimeId: 'active-module',
    });
    let cleanedUp = false;
    const disposeFeature = runtime.registerModule((scope) => {
      scope.regRootSub('value', 'value');
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
    expect(admin(runtime).getHandlers().sub.value).toBeUndefined();
    runtime.dispose();
  });

  it('disposes an inactive feature while an unrelated subscription remains active', () => {
    const runtime = createReflexRuntime({
      initialState: { feature: 1, shell: 2 },
      runtimeId: 'unrelated-active-module',
    });
    runtime.regRootSub('shell', 'shell');
    const disposeFeature = runtime.registerModule((scope) =>
      scope.regRootSub('feature', 'feature'),
    );
    const unwatchShell = runtime.watchSubscription(['shell'], () => {});

    expect(() => disposeFeature()).not.toThrow();
    expect(admin(runtime).getHandlers().sub.feature).toBeUndefined();
    expect(admin(runtime).getHandlers().sub.shell).toBeDefined();
    expect(runtime.getSubscriptionValue(['shell'])).toBe(2);

    unwatchShell();
    runtime.dispose();
  });

  it('keeps trace callbacks and trace ids scoped to their runtime', async () => {
    const first = createCounterRuntime('trace-first', 0);
    const second = createCounterRuntime('trace-second', 0);
    const firstTraces: Array<{ id: number; tags?: Record<string, unknown> }> = [];
    const secondTraces: Array<{ id: number; tags?: Record<string, unknown> }> = [];
    const removeFirst = createReflexInspector(first).subscribeTraces((traces) => {
      firstTraces.push(...traces);
    });
    const removeSecond = createReflexInspector(second).subscribeTraces((traces) => {
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
    const inspector = createReflexInspector(runtime);
    const removeTraceListener = inspector.subscribeTraces(() => {});
    runtime.dispose();
    runtime.dispose();
    removeTraceListener();
    removeTraceListener();

    expect(() => runtime.getState()).toThrow("Runtime 'disposed' has been disposed");
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
    const survivingInspector = createReflexInspector(surviving);

    disposed.dispose();

    expect(() => disposed.getState()).toThrow("Runtime 'dispose-first' has been disposed");
    surviving.dispatchSync(['increment', 5]);
    expect(surviving.getState()).toEqual({ count: 15, label: 'dispose-second' });
    expect(survivingInspector.getSnapshot().state).toEqual({
      count: 15,
      label: 'dispose-second',
    });

    surviving.dispose();
  });
});
