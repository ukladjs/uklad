import { useState } from 'react';

import { useRuntime, useSubscription } from '../../../app/uklad/bindings';
import { appIds } from '../../../app/uklad/catalog';
import type { ServerQueryResult, ServerRegion, ServerRegionSummary } from '../state';

const ITEM_IDS = [1, 2, 3, 4] as const;
const REGIONS: readonly ServerRegion[] = ['eu', 'us', 'apac'];

function ServerPanel() {
  const runtime = useRuntime();
  const [itemId, setItemId] = useState<number>(1);
  const [showClock, setShowClock] = useState(true);
  const item = useSubscription(
    [appIds.subscriptions.serverItemById, itemId],
    'ServerParameterizedExample',
  );
  const region = useSubscription([appIds.subscriptions.serverRegion], 'ServerDependencyExample');
  const regionSummary = useSubscription(
    [appIds.subscriptions.serverRegionSummary],
    'ServerDependencyExample',
  );

  return (
    <section className="server-section">
      <div className="server-heading">
        <div>
          <h2>TanStack Query + Subscription Extensions</h2>
          <p>
            Every card is driven by a headless QueryObserver. Results cross an Uklad event and state
            root before the subscription updates.
          </p>
        </div>
        <div className="server-heading-actions">
          <span className="server-badge">Local API</span>
          <button
            className="server-toggle"
            aria-pressed={showClock}
            onClick={() => setShowClock((visible) => !visible)}
          >
            {showClock ? 'Hide timer subscription' : 'Show timer subscription'}
          </button>
        </div>
      </div>

      <div className="server-examples">
        {showClock ? <ServerClockCard /> : null}

        <article className="server-card">
          <div className="server-card-number">2</div>
          <h3>Subscription with a React parameter</h3>
          <p className="server-description">
            The selected id lives only in React. Changing it changes the subscription vector and
            starts the matching query-extension instance.
          </p>
          <code>
            [&apos;{appIds.subscriptions.serverItemById}&apos;, {itemId}]
          </code>
          <div className="server-choice-row" aria-label="Server item id">
            {ITEM_IDS.map((candidate) => (
              <button
                key={candidate}
                className={
                  candidate === itemId ? 'server-choice server-choice--active' : 'server-choice'
                }
                aria-pressed={candidate === itemId}
                onClick={() => setItemId(candidate)}
              >
                Item {candidate}
              </button>
            ))}
          </div>
          <QueryResult result={item}>
            {(value) => (
              <div className="server-result-grid">
                <span>Response</span>
                <strong data-testid="server-item-title">{value.title}</strong>
                <span>Requests for #{value.id}</span>
                <strong>{value.requestCount}</strong>
              </div>
            )}
          </QueryResult>
        </article>

        <article className="server-card">
          <div className="server-card-number">3</div>
          <h3>Query controlled by another subscription</h3>
          <p className="server-description">
            Region is an Uklad state root. The query extension observes that subscription and
            switch-maps its TanStack query key when the event changes it.
          </p>
          <code>
            [&apos;{appIds.subscriptions.serverRegionSummary}&apos;] ← [&apos;
            {appIds.subscriptions.serverRegion}&apos;]
          </code>
          <div className="server-choice-row" aria-label="Server region">
            {REGIONS.map((candidate) => (
              <button
                key={candidate}
                className={
                  candidate === region ? 'server-choice server-choice--active' : 'server-choice'
                }
                aria-pressed={candidate === region}
                onClick={() => runtime.dispatch([appIds.events.serverRegionSelected, candidate])}
              >
                {candidate.toUpperCase()}
              </button>
            ))}
          </div>
          <QueryResult result={regionSummary}>
            {(value) => <RegionResult value={value} />}
          </QueryResult>
        </article>
      </div>
    </section>
  );
}

function ServerClockCard() {
  const clock = useSubscription([appIds.subscriptions.serverClock], 'ServerClockExample');

  return (
    <article className="server-card">
      <div className="server-card-number">1</div>
      <h3>Subscription without parameters</h3>
      <p className="server-description">
        The server clock advances independently. TanStack refetches it every second while this
        subscription has a consumer.
      </p>
      <code>[&apos;{appIds.subscriptions.serverClock}&apos;]</code>
      <QueryResult result={clock}>
        {(value) => (
          <div className="server-result-grid">
            <span>Server tick</span>
            <strong data-testid="server-clock-tick">{value.tick}</strong>
            <span>Server time</span>
            <strong>{formatServerTime(value.serverTime)}</strong>
          </div>
        )}
      </QueryResult>
    </article>
  );
}

function QueryResult<TData>({
  result,
  children,
}: {
  result: ServerQueryResult<TData>;
  children: (value: TData) => React.ReactNode;
}) {
  if (result.kind === 'loading') {
    return <div className="server-result server-result--loading">Loading from the local API…</div>;
  }
  if (result.kind === 'error') {
    return <div className="server-result server-result--error">{result.message}</div>;
  }
  return <div className="server-result server-result--ready">{children(result.data)}</div>;
}

function RegionResult({ value }: { value: ServerRegionSummary }) {
  return (
    <div className="server-result-grid">
      <span>Selected endpoint</span>
      <strong data-testid="server-region-city">
        {value.region.toUpperCase()} · {value.city}
      </strong>
      <span>Temperature</span>
      <strong>{value.temperatureC} °C</strong>
      <span>Requests</span>
      <strong>{value.requestCount}</strong>
    </div>
  );
}

function formatServerTime(value: string): string {
  return new Date(value).toLocaleTimeString();
}

export default ServerPanel;
