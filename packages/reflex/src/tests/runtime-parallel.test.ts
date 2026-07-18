import { createReflexRuntime } from '../runtime/runtime';

describe('parallel runtime isolation', () => {
  it.concurrent.each([
    ['alpha', 1, 2],
    ['beta', 10, 5],
    ['gamma', -4, 9],
    ['delta', 100, -25],
  ])('keeps test worker %s independent', async (runtimeId, initial, amount) => {
    const runtime = createReflexRuntime({
      initialDb: { value: initial },
      runtimeId: `parallel-${runtimeId}`,
    });
    runtime.regSub('value');
    runtime.regEvent('increment', ({ draftDb }, delta: number) => {
      draftDb.value += delta;
    });

    const observed: number[] = [];
    const unwatch = runtime.watchSubscription(['value'], (value) => observed.push(value));
    runtime.dispatch(['increment', amount]);
    await runtime.flush();

    expect(runtime.getAppDb()).toEqual({ value: initial + amount });
    expect(observed).toEqual([initial, initial + amount]);

    unwatch();
    runtime.dispose();
  });
});
