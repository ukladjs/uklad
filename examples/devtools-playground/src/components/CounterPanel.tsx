import { useCallback } from 'react';
import { dispatch, useSubscription } from '@flexsurfer/reflex';

function CounterPanel() {
  const counter = useSubscription<number>(['counter'], 'CounterPanel');
  const isLoading = useSubscription<boolean>(['isLoading'], 'CounterPanel');

  const handleIncrement = useCallback(() => dispatch(['increment-counter']), []);

  const simulateApiCall = async () => {
    dispatch(['set-loading', true]);
    dispatch(['fake-event', 2, { name: 'John Doe' }]);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      dispatch(['add-user', { id: Date.now(), name: `User ${Date.now()}`, active: true }]);
    } finally {
      dispatch(['set-loading', false]);
    }
  };

  const simulateError = () => {
    try {
      dispatch(['simulate-error']);
    } catch {}
  };

  const dispatchBadParams = () => {
    const proxy = new Proxy({ original: 'value' }, { get: (t, p) => t[p as keyof typeof t] });
    dispatch(['test-event-with-bad-params', {
      function: () => {},
      symbol: Symbol('test'),
      undefined: undefined,
      bigint: 123n,
      map: new Map([['k', 'v']]),
      set: new Set([1, 2]),
      proxy,
    }]);
  };

  return (
    <div>
      <section className="counter-section">
        <h2>Counter</h2>
        <p className="sub-info">Subscriptions: <code>counter</code>, <code>isLoading</code></p>
        <div className="counter">
          <button onClick={handleIncrement} className="counter-button">
            Count: {counter}
          </button>
        </div>
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
          <button onClick={() => dispatch(['test-event-with-immer-proxy'])} className="test-button">
            Test Immer Proxy
          </button>
        </div>
      </section>
    </div>
  );
}

export default CounterPanel;
