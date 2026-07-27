import { createReflexTestHarness } from '../../src/testing';
import {
  createReflexRuntimeForTests as createReflexRuntime,
  getRuntimeClient,
} from '../../src/runtime/runtime';

describe('testing adapter', () => {
  it('exposes focused test operations without the live registry', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'testing-adapter',
    });
    runtime.regEvent('increment', ({ draftState }, amount: number) => {
      draftState.count += amount;
    });
    runtime.regRootSub('count', 'count');

    const harness = createReflexTestHarness(runtime);
    const eventHandler = harness.getEventHandler('increment');
    const subscriptionHandler = harness.getSubscriptionHandler('count');

    expect(Object.isFrozen(harness)).toBe(true);
    expect(eventHandler).toBeInstanceOf(Function);
    expect(subscriptionHandler).toBeInstanceOf(Function);
    expect(harness).not.toHaveProperty('getHandlers');
    expect(harness.getState()).toEqual({ count: 0 });
    await harness.flush();

    harness.restoreState({ count: 4 });
    expect(subscriptionHandler?.()).toBe(4);
    expect(harness.getSubscriptionValue(['count'])).toBe(4);

    runtime.dispose();
  });

  it('injects the production client capability into effects', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'effect-client',
    });
    const harness = createReflexTestHarness(runtime);
    let effectRuntime: unknown;

    runtime.regEvent('start', () => [['complete']]);
    runtime.regEvent('complete', ({ draftState }) => {
      draftState.count += 1;
    });
    runtime.regEffect('complete', (_value, client) => {
      effectRuntime = client;
      client.dispatch(['complete']);
    });

    runtime.dispatch(['start']);
    await harness.flush();

    expect(effectRuntime).toBe(getRuntimeClient(runtime));
    expect(harness.getState()).toEqual({ count: 1 });
    expect((effectRuntime as Record<string, unknown>).dispatchSync).toBeUndefined();
    expect((effectRuntime as Record<string, unknown>).getState).toBeUndefined();
    expect((effectRuntime as Record<string, unknown>).debounceAndDispatch).toBeInstanceOf(Function);
    expect((effectRuntime as Record<string, unknown>).throttleAndDispatch).toBeInstanceOf(Function);
    runtime.dispose();
  });
});
