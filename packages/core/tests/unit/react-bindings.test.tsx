/**
 * @jest-environment jsdom
 */
import { cleanup, render, renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { createReflexHooks } from '../../src/react/bindings';
import { ReflexProvider } from '../../src/react/context';
import { HotReloadWrapper, triggerHotReload } from '../../src/react/hot-reload';
import { useSubscription } from '../../src/react/use-subscription';
import { createReflexRuntimeForTests, type ReflexRuntime } from '../../src/runtime/runtime';

function createValueRuntime(runtimeId: string, value: number) {
  const runtime = createReflexRuntimeForTests({ initialState: { value }, runtimeId });
  runtime.registerModule((registrar) => {
    registrar.regRootSub('value', 'value');
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('set', ({ draftState }, nextValue: number) => {
      draftState.value = nextValue;
    });
  });
  return runtime;
}

function boundProvider(
  bindings: ReturnType<typeof createReflexHooks>,
  runtime: ReflexRuntime<any>,
) {
  return function BoundWrapper({ children }: { children: ReactNode }) {
    return createElement(bindings.ReflexProvider, { runtime }, children);
  };
}

describe('createReflexHooks', () => {
  afterEach(() => cleanup());

  it('reads the runtime selected by its own provider', () => {
    const bindings = createReflexHooks();
    const runtime = createValueRuntime('bindings-own-provider', 1);

    const hook = renderHook(() => bindings.useSubscription(['value']), {
      wrapper: boundProvider(bindings, runtime),
    });
    expect(hook.result.current).toBe(1);

    act(() => runtime.dispatchSync(['set', 7]));
    expect(hook.result.current).toBe(7);

    hook.unmount();
    runtime.dispose();
  });

  it('rejects the package-level provider instead of reading it as its own contract', () => {
    const bindings = createReflexHooks();
    const runtime = createValueRuntime('bindings-foreign-provider', 1);

    // The package-level provider selects a runtime without selecting a
    // contract, so it cannot satisfy locally typed bindings. Failing loudly
    // here is the point: silently reading it would produce a value of one
    // contract under another contract's inferred type.
    expect(() =>
      renderHook(() => bindings.useSubscription(['value']), {
        wrapper: function Wrapper({ children }: { children: ReactNode }) {
          return createElement(ReflexProvider, { runtime }, children);
        },
      }),
    ).toThrow(/require the <ReflexProvider> returned by the same createReflexHooks\(\) call/);

    runtime.dispose();
  });

  it('does not satisfy bindings created by a different call for the same contract', () => {
    const first = createReflexHooks();
    const second = createReflexHooks();
    const runtime = createValueRuntime('bindings-distinct-calls', 1);

    expect(() =>
      renderHook(() => second.useSubscription(['value']), {
        wrapper: boundProvider(first, runtime),
      }),
    ).toThrow(/createReflexHooks\(\) call/);

    runtime.dispose();
  });

  it('throws without any provider', () => {
    const bindings = createReflexHooks();
    expect(() => renderHook(() => bindings.useSubscription(['value']))).toThrow(
      /createReflexHooks\(\) call/,
    );
  });

  it('exposes the bound runtime as a client facade', () => {
    const bindings = createReflexHooks();
    const runtime = createValueRuntime('bindings-client-facade', 1);

    const hook = renderHook(() => bindings.useRuntime(), {
      wrapper: boundProvider(bindings, runtime),
    });
    const client = hook.result.current as unknown as Record<string, unknown>;

    expect(hook.result.current).not.toBe(runtime);
    expect(client.dispatch).toBeInstanceOf(Function);
    expect(client.registerModule).toBeUndefined();
    expect(client.dispatchSync).toBeUndefined();

    hook.unmount();
    runtime.dispose();
  });

  it('also selects the runtime for the package-level context beneath it', () => {
    const bindings = createReflexHooks();
    const runtime = createValueRuntime('bindings-shared-context', 5);

    // Hot reload and the untyped hook both read the package-level context, so
    // the bound provider has to select the runtime there too or an app using
    // bindings would need two providers.
    function Value() {
      return createElement('span', null, String(useSubscription<number>(['value'])));
    }

    const view = render(
      createElement(
        bindings.ReflexProvider,
        { runtime },
        createElement(HotReloadWrapper, null, createElement(Value)),
      ),
    );
    expect(view.container.textContent).toBe('5');

    act(() => triggerHotReload(runtime));
    expect(view.container.textContent).toBe('5');

    view.unmount();
    runtime.dispose();
  });

  it('selects the nearest bound provider when nested', () => {
    const bindings = createReflexHooks();
    const outer = createValueRuntime('bindings-outer', 3);
    const inner = createValueRuntime('bindings-inner', 4);

    function Value() {
      return createElement('span', null, String(bindings.useSubscription(['value'])));
    }

    const view = render(
      createElement(
        bindings.ReflexProvider,
        { runtime: outer },
        createElement(bindings.ReflexProvider, { runtime: inner }, createElement(Value)),
      ),
    );
    expect(view.container.textContent).toBe('4');

    view.rerender(createElement(bindings.ReflexProvider, { runtime: outer }, createElement(Value)));
    expect(view.container.textContent).toBe('3');

    view.unmount();
    outer.dispose();
    inner.dispose();
  });

  it('keeps sibling runtimes isolated, as SSR request rendering relies on', () => {
    const bindings = createReflexHooks();
    const first = createValueRuntime('bindings-ssr-first', 1);
    const second = createValueRuntime('bindings-ssr-second', 2);

    const firstHook = renderHook(() => bindings.useSubscription(['value']), {
      wrapper: boundProvider(bindings, first),
    });
    const secondHook = renderHook(() => bindings.useSubscription(['value']), {
      wrapper: boundProvider(bindings, second),
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
});
