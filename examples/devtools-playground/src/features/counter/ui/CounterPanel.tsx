import { useCallback } from 'react';

import { useRuntime, useSubscription } from '../../../app/uklad/bindings';
import { appIds } from '../../../app/uklad/catalog';

function CounterPanel() {
  const runtime = useRuntime();
  const counter = useSubscription([appIds.subscriptions.counterValue], 'CounterPanel');
  const effectDispatches = useSubscription(
    [appIds.subscriptions.counterEffectDispatches],
    'CounterPanel',
  );

  const handleIncrement = useCallback(
    () => runtime.dispatch([appIds.events.counterIncrement]),
    [runtime],
  );

  return (
    <div>
      <section className="counter-section">
        <h2>Counter</h2>
        <p className="sub-info">
          Subscriptions: <code>{appIds.subscriptions.counterValue}</code>,{' '}
          <code>{appIds.subscriptions.counterEffectDispatches}</code>
        </p>
        <div className="counter">
          <button onClick={handleIncrement} className="counter-button">
            Count: {counter}
          </button>
        </div>
        <p>
          Events dispatched from an effect: <strong>{effectDispatches}</strong>
        </p>
      </section>

      <section className="actions-section">
        <h2>Persistence</h2>
        <p className="sub-info">
          The same effect and coeffect ids reach <code>window.localStorage</code> here and an
          in-memory map in the headless runtime — the handlers below never know which.
        </p>
        <div className="action-buttons">
          <button
            onClick={() => runtime.dispatch([appIds.events.counterPersist])}
            className="api-button"
          >
            Persist counter
          </button>
          <button
            onClick={() => runtime.dispatch([appIds.events.counterLoad])}
            className="test-button"
          >
            Load counter
          </button>
        </div>
      </section>
    </div>
  );
}

export default CounterPanel;
