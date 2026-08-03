import { createUkladRuntimeForTests as createUkladRuntime } from '../../src/runtime/runtime';

describe('parallel runtime isolation', () => {
  it.concurrent.each([
    ['alpha', 1, 2],
    ['beta', 10, 5],
    ['gamma', -4, 9],
    ['delta', 100, -25],
  ])('keeps test worker %s independent', async (runtimeId, initial, amount) => {
    const runtime = createUkladRuntime({
      initialState: { value: initial },
      runtimeId: `parallel-${runtimeId}`,
    });
    runtime.registerModule((registrar) => {
      registrar.regRootSub('value', 'value');
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('increment', ({ draftState }, delta: number) => {
        draftState.value += delta;
      });
    });

    const observed: number[] = [];
    const unwatch = runtime.watchSubscription(['value'], (value) => observed.push(value));
    runtime.dispatch(['increment', amount]);
    await runtime.flush();

    expect(runtime.getState()).toEqual({ value: initial + amount });
    expect(observed).toEqual([initial, initial + amount]);

    unwatch();
    runtime.dispose();
  });
});
