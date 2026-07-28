import { useCallback } from 'react';
import { usePlaygroundRuntime, useSubscription } from '../hooks';

function CounterPanel() {
  const runtime = usePlaygroundRuntime();
  const counter = useSubscription(['counter'], 'CounterPanel');
  const effectDispatchCount = useSubscription(['effectDispatchCount'], 'CounterPanel');
  const isLoading = useSubscription(['isLoading'], 'CounterPanel');

  const handleIncrement = useCallback(() => runtime.dispatch(['increment-counter']), [runtime]);

  const simulateApiCall = async () => {
    runtime.dispatch(['set-loading', true]);
    runtime.dispatch(['fake-event', 2, { name: 'John Doe' }]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      runtime.dispatch(['add-user', { id: Date.now(), name: `User ${Date.now()}`, active: true }]);
    } finally {
      runtime.dispatch(['set-loading', false]);
    }
  };

  const simulateError = () => {
    try {
      runtime.dispatch(['simulate-error']);
    } catch {}
  };

  const dispatchBadParams = () => {
    const proxy = new Proxy({ original: 'value' }, { get: (t, p) => t[p as keyof typeof t] });
    runtime.dispatch([
      'test-event-with-bad-params',
      {
        function: () => {},
        symbol: Symbol('test'),
        undefined: undefined,
        bigint: 123n,
        map: new Map([['k', 'v']]),
        set: new Set([1, 2]),
        proxy,
      },
    ]);
  };

  return (
    <div>
      <section className="counter-section">
        <h2>Counter</h2>
        <p className="sub-info">
          Subscriptions: <code>counter</code>, <code>effectDispatchCount</code>, <code>isLoading</code>
        </p>
        <div className="counter">
          <button onClick={handleIncrement} className="counter-button">
            Count: {counter}
          </button>
        </div>
        <p>
          Event dispatched from effect: <strong>{effectDispatchCount}</strong>
        </p>
      </section>

      <section className="actions-section">
        <h2>Test Actions</h2>
        <div className="action-buttons">
          <button onClick={simulateApiCall} disabled={!!isLoading} className="api-button">
            {isLoading ? 'Loading...' : 'Simulate API Call'}
          </button>
          <button onClick={simulateError} className="error-button">
            Trigger Error
          </button>
          <button onClick={dispatchBadParams} className="test-button">
            Test Bad Params
          </button>
          <button
            onClick={() => runtime.dispatch(['dispatch-event-from-effect'])}
            className="test-button"
          >
            Test Dispatch from Effect
          </button>
          <button
            onClick={() => runtime.dispatch(['test-event-with-immer-proxy'])}
            className="test-button"
          >
            Test Immer Proxy
          </button>
        </div>
      </section>
    </div>
  );
}

export default CounterPanel;
