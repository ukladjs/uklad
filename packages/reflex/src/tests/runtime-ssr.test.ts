import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { ReflexProvider } from '../react/context';
import { useSubscription } from '../react/use-subscription';
import { createReflexRuntime } from '../runtime/runtime';

async function renderRequest(requestId: string, initialValue: number, increment: number) {
  const runtime = createReflexRuntime({
    initialDb: { requestId, value: initialValue },
    runtimeId: `request-${requestId}`,
  });
  runtime.regSub('value');
  runtime.regEvent('increment', ({ draftDb }, amount: number) => {
    draftDb.value += amount;
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
  const snapshot = runtime.getAppDb();
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
