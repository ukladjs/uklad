import { createUkladHeadlessScenario } from '../../src/testing';
import { createUkladRuntimeForTests as createUkladRuntime } from '../../src/runtime/runtime';

describe('headless scenario', () => {
  it('drives the normal event queue and observes published view values', async () => {
    const runtime = createUkladRuntime({
      initialState: { count: 0 },
      runtimeId: 'headless-scenario-cascade',
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('start', () => [['complete']]);
      registrar.regEvent('complete', ({ draftState }) => {
        draftState.count += 1;
      });
      registrar.regEffect('complete', (_value, client) => {
        client.dispatch(['complete']);
      });
      registrar.regRootSub('count', 'count');
    });

    const scenario = createUkladHeadlessScenario(runtime);
    const view = scenario.mountView('Counter', { count: ['count'] });

    expect(view.current()).toEqual({ count: 0 });
    expect(view.history('count')).toEqual([{ value: 0, previousValue: undefined }]);

    scenario.dispatch(['start']);
    await scenario.settle();

    expect(view.value('count')).toBe(1);
    expect(view.history('count')).toEqual([
      { value: 0, previousValue: undefined },
      { value: 1, previousValue: 0 },
    ]);

    await scenario.dispose();
  });

  it('activates subscriptions while mounted and releases them on unmount', async () => {
    const activated = jest.fn();
    const released = jest.fn();
    const runtime = createUkladRuntime({
      initialState: { value: 1 },
      runtimeId: 'headless-scenario-lifecycle',
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('set', ({ draftState }, value: number) => {
        draftState.value = value;
      });
      registrar.regRootSub('value', 'value');
      registrar.regSubExt(
        'value',
        () => [],
        () => ({ sync: activated, dispose: released }),
      );
    });

    const scenario = createUkladHeadlessScenario(runtime);
    const view = scenario.mountView('Value', { value: ['value'] });

    expect(activated).toHaveBeenCalledTimes(1);
    expect(view.mounted).toBe(true);

    view.unmount();
    expect(view.mounted).toBe(false);
    expect(released).toHaveBeenCalledTimes(1);

    scenario.dispatch(['set', 2]);
    await scenario.settle();

    expect(view.history('value')).toEqual([{ value: 1, previousValue: undefined }]);
    expect(() => view.value('value')).toThrow("Headless view 'Value' is unmounted");

    await scenario.dispose();
  });

  it('cleans up mounted views and rejects further scenario actions after disposal', async () => {
    const runtime = createUkladRuntime({
      initialState: { value: 1 },
      runtimeId: 'headless-scenario-dispose',
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('set', ({ draftState }, value: number) => {
        draftState.value = value;
      });
      registrar.regRootSub('value', 'value');
    });

    const scenario = createUkladHeadlessScenario(runtime);
    const view = scenario.mountView('Value', { value: ['value'] });

    await scenario.dispose();

    expect(view.mounted).toBe(false);
    expect(() => scenario.dispatch(['set', 2])).toThrow('Headless scenario is disposed');
    await expect(scenario.settle()).rejects.toThrow('Headless scenario is disposed');
  });
});
