import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { ReflexProvider } from '../../src/react/context';
import { useSubscription } from '../../src/react/use-subscription';
import { createReflexRuntimeForTests as createReflexRuntime } from '../../src/runtime/runtime';

async function renderRequest(requestId: string, initialValue: number, increment: number) {
  const runtime = createReflexRuntime({
    initialState: { requestId, value: initialValue },
    runtimeId: `request-${requestId}`,
  });
  runtime.regRootSub('value', 'value');
  runtime.regEvent('increment', ({ draftState }, amount: number) => {
    draftState.value += amount;
  });
  runtime.dispatch(['increment', increment]);
  await runtime.flush();

  function RequestView() {
    const value = useSubscription<number>(['value']);
    return createElement('span', null, `${requestId}:${value}`);
  }

  const html = renderToString(
    createElement(ReflexProvider, { runtime }, createElement(RequestView)),
  );
  const snapshot = runtime.getState();
  runtime.dispose();
  return { html, snapshot };
}

describe('SSR request isolation', () => {
  it('renders concurrent requests with identical handler and subscription ids independently', async () => {
    const [first, second] = await Promise.all([
      renderRequest('a', 1, 2),
      renderRequest('b', 10, 5),
    ]);

    expect(first.html).toContain('a:3');
    expect(first.html).not.toContain('b:15');
    expect(second.html).toContain('b:15');
    expect(second.html).not.toContain('a:3');
    expect(first.snapshot).toEqual({ requestId: 'a', value: 3 });
    expect(second.snapshot).toEqual({ requestId: 'b', value: 15 });
  });
});
