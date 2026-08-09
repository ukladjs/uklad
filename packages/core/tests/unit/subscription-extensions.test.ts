import {
  createUkladRuntimeForTests as createUkladRuntime,
  getRuntimeCoreForTests,
} from '../../src/runtime/runtime';

import { waitForScheduled } from './test-utils';

const SUBSCRIPTION_EXTENSION_EVENT_ID = '__ukladjs/sub-extension/update';

describe('subscription extensions', () => {
  it('keeps a root subscription ordinary while an extension switch-maps passive signals', async () => {
    const signals = jest.fn((): [string][] => [['selected-id']]);
    const sync = jest.fn();
    const dispose = jest.fn();
    const runtime = createUkladRuntime({
      initialState: { selectedId: 1, selectedDoubled: 0 },
      runtimeId: 'subscription-extension-lifecycle',
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('select', ({ draftState }, id: number) => {
        draftState.selectedId = id;
      });
      registrar.regEvent('overwrite-selected-doubled', ({ draftState }) => {
        draftState.selectedDoubled = 999;
      });
      registrar.regRootSub('selected-id', 'selectedId');
      registrar.regRootSub('selected/doubled', 'selectedDoubled');
      registrar.regSubExt('selected/doubled', signals, (context) => ({
        sync: ([id]) => {
          sync(id);
          context.updateRoot('selectedDoubled', () => id * 2);
        },
        dispose,
      }));
    });

    expect(runtime.getSubscriptionValue(['selected/doubled'])).toBe(0);
    expect(signals).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(
      runtime.getSubscriptionDiagnostics().some((item) => item.query[0] === 'selected-id'),
    ).toBe(false);

    const observed: number[] = [];
    const unsubscribe = runtime.watchSubscription(['selected/doubled'], (value) => {
      observed.push(value);
    });
    expect(signals).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenLastCalledWith(1);
    await runtime.flush();
    expect(sync).toHaveBeenLastCalledWith(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([0, 2]);
    expect(
      runtime.getSubscriptionDiagnostics().find((item) => item.query[0] === 'selected/doubled')
        ?.kind,
    ).toBe('root');

    runtime.dispatchSync(['select', 2]);
    await waitForScheduled();
    await runtime.flush();
    expect(sync).toHaveBeenLastCalledWith(2);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(signals).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([0, 2, 4]);

    expect(runtime.getSubscriptionValue(['selected/doubled'])).toBe(4);

    const beforeForgedPublish = runtime.getStateRevisions();
    runtime.dispatchSync([
      '__ukladjs/sub-extension/update',
      { stateKey: 'selectedDoubled', value: 999 },
    ]);
    expect(runtime.getStateRevisions()).toEqual(beforeForgedPublish);
    expect(runtime.getSubscriptionValue(['selected/doubled'])).toBe(4);

    unsubscribe();
    expect(dispose).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it('samples signals without activating or retaining the signal subscription', async () => {
    const targetSync = jest.fn();
    const targetDispose = jest.fn();
    const signalSync = jest.fn();
    const signalDispose = jest.fn();
    const runtime = createUkladRuntime({
      initialState: { source: 1, target: 0 },
      runtimeId: 'subscription-extension-passive-signal',
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('set-source', ({ draftState }, value: number) => {
        draftState.source = value;
      });
      registrar.regRootSub('source', 'source');
      registrar.regSub(
        'signal',
        () => [['source']],
        ([value]) => value * 2,
      );
      registrar.regSubExt(
        'signal',
        () => [],
        () => ({ sync: signalSync, dispose: signalDispose }),
      );
      registrar.regRootSub('target', 'target');
      registrar.regSubExt(
        'target',
        () => [['signal']],
        () => ({
          sync: ([value]) => targetSync(value),
          dispose: targetDispose,
        }),
      );
    });

    const unsubscribeTarget = runtime.watchSubscription(['target'], () => {});
    expect(targetSync).toHaveBeenLastCalledWith(2);
    expect(signalSync).not.toHaveBeenCalled();
    expect(
      runtime.getSubscriptionDiagnostics().find((item) => item.query[0] === 'signal')?.active,
    ).toBe(false);

    const unsubscribeSignal = runtime.watchSubscription(['signal'], () => {});
    expect(signalSync).toHaveBeenCalledTimes(1);
    expect(
      runtime.getSubscriptionDiagnostics().find((item) => item.query[0] === 'signal')?.active,
    ).toBe(true);

    unsubscribeSignal();
    expect(signalDispose).toHaveBeenCalledTimes(1);
    expect(runtime.getSubscriptionDiagnostics().some((item) => item.query[0] === 'signal')).toBe(
      false,
    );

    runtime.dispatchSync(['set-source', 2]);
    await waitForScheduled();
    expect(targetSync).toHaveBeenLastCalledWith(4);
    expect(signalSync).toHaveBeenCalledTimes(1);
    expect(
      runtime.getSubscriptionDiagnostics().find((item) => item.query[0] === 'signal')?.active,
    ).toBe(false);

    unsubscribeTarget();
    expect(targetDispose).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it('lets a parameterized derived extension update an explicit backing root', async () => {
    const runtime = createUkladRuntime({
      initialState: { items: {} as Record<number, string> },
      runtimeId: 'subscription-extension-explicit-root',
    });
    runtime.registerModule((registrar) => {
      registrar.regRootSub('items', 'items');
      registrar.regSub(
        'item/by-id',
        () => [['items']],
        ([items], id: number) => items[id],
      );
      registrar.regSubExt(
        'item/by-id',
        () => [],
        (context, id: number) => ({
          sync: () => {
            context.updateRoot('items', (items: Record<number, string>) => ({
              ...items,
              [id]: `Item ${id}`,
            }));
          },
          dispose: () => {},
        }),
      );
    });

    const stopFirst = runtime.watchSubscription(['item/by-id', 1], () => {});
    const stopSecond = runtime.watchSubscription(['item/by-id', 2], () => {});
    await runtime.flush();

    expect(runtime.getSubscriptionValue(['item/by-id', 1])).toBe('Item 1');
    expect(runtime.getSubscriptionValue(['item/by-id', 2])).toBe('Item 2');
    expect(runtime.getState()).toEqual({ items: { 1: 'Item 1', 2: 'Item 2' } });

    stopSecond();
    stopFirst();
    runtime.dispose();
  });

  it('keeps the ordinary runtime free of the extension bridge until first registration', () => {
    const runtime = createUkladRuntime({
      initialState: { value: 1, external: 0 },
      runtimeId: 'subscription-extension-lazy-bridge',
    });
    const core = getRuntimeCoreForTests(runtime);

    runtime.registerModule((registrar) => {
      registrar.regRootSub('value', 'value');
      registrar.regRootSub('external', 'external');
    });

    expect(runtime.getSubscriptionValue(['value'])).toBe(1);
    expect(core.registry.event.has(SUBSCRIPTION_EXTENSION_EVENT_ID)).toBe(false);
    expect(core.events.hasGlobalInterceptors).toBe(false);
    expect(runtime.getInterceptors()).toEqual([]);

    runtime.registerModule((registrar) => {
      registrar.regSubExt(
        'external',
        () => [['value']],
        () => ({ sync: () => {}, dispose: () => {} }),
      );
    });

    expect(core.registry.event.has(SUBSCRIPTION_EXTENSION_EVENT_ID)).toBe(true);

    runtime.clearHandlers();
    expect(core.registry.event.has(SUBSCRIPTION_EXTENSION_EVENT_ID)).toBe(false);
    runtime.registerModule((registrar) => {
      registrar.regRootSub('value', 'value');
      registrar.regRootSub('external', 'external');
      registrar.regSubExt(
        'external',
        () => [['value']],
        () => ({ sync: () => {}, dispose: () => {} }),
      );
    });
    expect(core.registry.event.has(SUBSCRIPTION_EXTENSION_EVENT_ID)).toBe(true);
    runtime.dispose();
  });

  it('does not let a scheduled sync from an old activation reach a new one', async () => {
    const syncedIds: number[] = [];
    const dispose = jest.fn();
    const runtime = createUkladRuntime({
      initialState: { selectedId: 1, external: 0 },
      runtimeId: 'subscription-extension-activation-generation',
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('select', ({ draftState }, id: number) => {
        draftState.selectedId = id;
      });
      registrar.regRootSub('selected-id', 'selectedId');
      registrar.regRootSub('external', 'external');
      registrar.regSubExt(
        'external',
        () => [['selected-id']],
        () => ({
          sync: ([id]) => syncedIds.push(id),
          dispose,
        }),
      );
    });

    const unsubscribeOld = runtime.watchSubscription(['external'], () => {});
    expect(syncedIds).toEqual([1]);

    runtime.dispatchSync(['select', 2]);
    unsubscribeOld();
    const unsubscribeNew = runtime.watchSubscription(['external'], () => {});
    expect(syncedIds).toEqual([1, 2]);

    await waitForScheduled();
    expect(syncedIds).toEqual([1, 2]);

    unsubscribeNew();
    expect(dispose).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });
});
