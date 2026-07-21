import {
  createSubscription,
  disableTracing,
  enableTracing,
  publishSubscriptions,
  registerTraceCallback,
  removeTraceCallback,
  subscribeToSubscription,
} from './runtime-test-api';

const TRACE_CALLBACK_KEY = 'subscription-trace-tags-test';
const waitForTraceFlush = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('subscription trace tags', () => {
  let collected: any[] = [];
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    collected = [];
    enableTracing();
    registerTraceCallback(TRACE_CALLBACK_KEY, (traces) => {
      collected.push(...traces);
    });
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    removeTraceCallback(TRACE_CALLBACK_KEY);
    disableTracing();
  });

  it('identifies subscription runs and renders with subscriptionKey', async () => {
    const key = JSON.stringify(['trace-subscription-source']);
    let value = 1;
    const source = createSubscription({
      key,
      query: ['trace-subscription-source'],
      kind: 'root',
      compute: () => value,
      dependencies: [],
      equalityCheck: Object.is,
      onActive: () => {},
      onUnused: () => {},
    });

    unsubscribe = subscribeToSubscription(source, () => {}, 'TraceSubscriber');
    value = 2;
    publishSubscriptions([source]);
    await waitForTraceFlush();

    const subscriptionRuns = collected.filter((trace) => trace.opType === 'sub/run');
    const renders = collected.filter((trace) => trace.opType === 'render');

    expect(subscriptionRuns.length).toBeGreaterThan(0);
    expect(renders).toHaveLength(1);
    for (const trace of [...subscriptionRuns, ...renders]) {
      expect(trace.tags.subscriptionKey).toBe(key);
      expect(trace.tags).not.toHaveProperty('reaction');
    }
  });
});
