import { useRuntime } from '../../../app/uklad/bindings';
import { appIds } from '../../../app/uklad/catalog';

/**
 * Buttons that deliberately misbehave, so the devtools has something to show:
 * a thrown handler, a non-serializable payload, an effect that dispatches back
 * into another feature, and a live Immer draft escaping into an effect.
 */
function DiagnosticsPanel() {
  const runtime = useRuntime();

  const simulateError = () => {
    try {
      runtime.dispatch([appIds.events.diagnosticsSimulateError]);
    } catch {
      // The runtime's error handling is what is under observation here.
    }
  };

  const dispatchBadParams = () => {
    const proxy = new Proxy({ original: 'value' }, { get: (t, p) => t[p as keyof typeof t] });
    runtime.dispatch([
      appIds.events.diagnosticsBadParams,
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
      <section className="actions-section">
        <h2>Diagnostics</h2>
        <p className="sub-info">
          No subscriptions — these events only write the <code>diagnostics*</code> state roots and
          emit <code>{appIds.effects.diagnosticsSink}</code>.
        </p>
        <div className="action-buttons">
          <button onClick={simulateError} className="error-button">
            Trigger Error
          </button>
          <button onClick={dispatchBadParams} className="test-button">
            Test Bad Params
          </button>
          <button
            onClick={() => runtime.dispatch([appIds.events.diagnosticsDispatchFromEffect])}
            className="test-button"
          >
            Dispatch from Effect
          </button>
          <button
            onClick={() => runtime.dispatch([appIds.events.diagnosticsImmerProxy])}
            className="test-button"
          >
            Test Immer Proxy
          </button>
          <button
            onClick={() => runtime.dispatch([appIds.events.diagnosticsEmitSink])}
            className="test-button"
          >
            Emit Sink Effect
          </button>
          <button
            onClick={() => runtime.dispatch([appIds.events.diagnosticsWriteNested])}
            className="test-button"
          >
            Write Nested State
          </button>
          <button
            onClick={() => runtime.dispatch([appIds.events.diagnosticsCreateComplex])}
            className="complex-button"
          >
            Create Complex Structure
          </button>
        </div>
      </section>
    </div>
  );
}

export default DiagnosticsPanel;
