/**
 * @jest-environment jsdom
 */
import { act } from '@testing-library/react';
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { ReflexProvider } from '../react/context';
import { useSubscription } from '../react/use-subscription';
import { createReflexRuntime, type ReflexRuntime } from '../runtime/runtime';

function ValueView() {
  return createElement('span', null, String(useSubscription<number>(['value'])));
}

function installValueFeature(runtime: ReflexRuntime<any>) {
  runtime.regSub('value');
  runtime.regEvent('set', ({ draftState }, value: number) => {
    draftState.value = value;
  });
}

describe('runtime hydration', () => {
  it('hydrates a fresh client runtime without retaining the request runtime', async () => {
    const serverRuntime = createReflexRuntime({
      initialState: { value: 7 },
      runtimeId: 'hydration-server',
    });
    installValueFeature(serverRuntime);
    const html = renderToString(
      createElement(ReflexProvider, { runtime: serverRuntime }, createElement(ValueView)),
    );
    const serializedState = JSON.parse(JSON.stringify(serverRuntime.getState())) as {
      value: number;
    };

    const clientRuntime = createReflexRuntime({
      initialState: serializedState,
      runtimeId: 'hydration-client',
    });
    installValueFeature(clientRuntime);

    const container = document.createElement('div');
    container.innerHTML = html;
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(
        container,
        createElement(ReflexProvider, { runtime: clientRuntime }, createElement(ValueView)),
      );
    });

    expect(container.textContent).toBe('7');
    expect(consoleError).not.toHaveBeenCalled();

    act(() => clientRuntime.dispatchSync(['set', 9]));
    expect(container.textContent).toBe('9');
    expect(serverRuntime.getState()).toEqual({ value: 7 });

    await act(async () => root!.unmount());
    consoleError.mockRestore();
    serverRuntime.dispose();
    clientRuntime.dispose();
  });
});
