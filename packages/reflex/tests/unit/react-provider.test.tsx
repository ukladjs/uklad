/**
 * @jest-environment jsdom
 */
import { cleanup, render, renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { ReflexProvider, useReflexRuntime } from '../../src/react/context';
import { useSubscription } from '../../src/react/use-subscription';
import { createReflexRuntimeForTests, type ReflexRuntime } from '../../src/runtime/runtime';

function createValueRuntime(runtimeId: string, value: number) {
  const runtime = createReflexRuntimeForTests({ initialState: { value }, runtimeId });
  runtime.regRootSub('value', 'value');
  runtime.regEvent('set', ({ draftState }, nextValue: number) => {
    draftState.value = nextValue;
  });
  return runtime;
}

function provider(runtime: ReflexRuntime<any>) {
  return function RuntimeWrapper({ children }: { children: ReactNode }) {
    return createElement(ReflexProvider, { runtime }, children);
  };
}

describe('ReflexProvider', () => {
  afterEach(() => cleanup());

  it('selects independent sibling runtimes', () => {
    const first = createValueRuntime('provider-first', 1);
    const second = createValueRuntime('provider-second', 2);

    const firstHook = renderHook(() => useSubscription<number>(['value']), {
      wrapper: provider(first),
    });
    const secondHook = renderHook(() => useSubscription<number>(['value']), {
      wrapper: provider(second),
    });

    expect(firstHook.result.current).toBe(1);
    expect(secondHook.result.current).toBe(2);

    act(() => first.dispatchSync(['set', 10]));
    expect(firstHook.result.current).toBe(10);
    expect(secondHook.result.current).toBe(2);

    firstHook.unmount();
    secondHook.unmount();
    first.dispose();
    second.dispose();
  });

  it('provides a distinct runtime-enforced client facade', () => {
    const runtime = createReflexRuntimeForTests({
      initialState: { value: 1 },
      runtimeId: 'provider-client-facade',
    });
    runtime.regRootSub('value', 'value');
    const hook = renderHook(() => useReflexRuntime(), {
      wrapper: provider(runtime),
    });
    const client = hook.result.current as unknown as Record<string, unknown>;

    expect(hook.result.current).not.toBe(runtime);
    expect(Object.isFrozen(hook.result.current)).toBe(true);
    expect(client.dispatch).toBeInstanceOf(Function);
    expect(client.dispatchSync).toBeUndefined();
    expect(client.debounceAndDispatch).toBeInstanceOf(Function);
    expect(client.throttleAndDispatch).toBeInstanceOf(Function);
    expect(client.getSubscriptionValue).toBeUndefined();
    for (const ownerMethod of [
      'getState',
      'flush',
      'watchSubscription',
      'regEvent',
      'registerModule',
      'dispose',
    ]) {
      expect(client[ownerMethod]).toBeUndefined();
    }

    hook.unmount();
    runtime.dispose();
  });

  it('uses the nearest nested provider and rebinds when the provider changes', () => {
    const outer = createValueRuntime('provider-outer', 3);
    const inner = createValueRuntime('provider-inner', 4);

    function Value() {
      return createElement('span', null, String(useSubscription<number>(['value'])));
    }

    const view = render(
      createElement(
        ReflexProvider,
        { runtime: outer },
        createElement(ReflexProvider, { runtime: inner }, createElement(Value)),
      ),
    );
    expect(view.container.textContent).toBe('4');

    view.rerender(createElement(ReflexProvider, { runtime: outer }, createElement(Value)));
    expect(view.container.textContent).toBe('3');

    view.unmount();
    outer.dispose();
    inner.dispose();
  });
});
