import { waitForScheduled } from './test-utils';
import {
  clearHandlers,
  createReflexInspector,
  disableTracing,
  enableTracing,
  getState,
  initState,
  isTraceEnabled,
  regCoeffect,
  regEffect,
  regEvent,
  regRootSub,
  regSub,
  withTrace,
} from './runtime-test-api';

import type { Trace } from '../core/tracing';

const waitForTraceFlush = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('Reflex inspector', () => {
  beforeEach(() => {
    disableTracing();
    clearHandlers();
    initState({});
  });

  afterEach(() => {
    disableTracing();
  });

  it('returns a frozen versioned adapter and protocol-ready snapshot', () => {
    const state = { count: 1 };
    initState(state);
    regEvent('inspector-event', () => undefined);
    regEffect('inspector-effect', () => {});
    regCoeffect('inspector-coeffect', (coeffects) => coeffects);
    regRootSub('count', 'count');

    const inspector = createReflexInspector();
    const snapshot = inspector.getSnapshot();

    expect(inspector.apiVersion).toBe(2);
    expect(inspector.runtimeId).toBe('reflex-unit-test-runtime');
    expect(inspector.runtimeName).toBe('Reflex unit-test runtime');
    expect(Object.isFrozen(inspector)).toBe(true);
    expect(snapshot.state).toBe(state);
    expect(snapshot.handlerKeys).toEqual({
      event: ['inspector-event'],
      fx: ['inspector-effect'],
      cofx: ['inspector-coeffect'],
      sub: ['count'],
    });
    expect(snapshot.handlerKeys.fx).not.toEqual(
      expect.arrayContaining(['dispatch', 'dispatch-later']),
    );
    expect(snapshot.handlerKeys.cofx).not.toEqual(expect.arrayContaining(['now', 'random']));
    expect(snapshot.subscriptions).toEqual([]);
  });

  it('evaluates subscriptions on demand without evaluating during snapshot reads', () => {
    let computedRuns = 0;
    initState({ count: 2 });
    regRootSub('count', 'count');
    regSub(
      'double-count',
      (count: number) => {
        computedRuns++;
        return count * 2;
      },
      () => [['count']],
    );

    const inspector = createReflexInspector();

    expect(inspector.getSnapshot().subscriptions).toEqual([]);
    expect(computedRuns).toBe(0);
    expect(inspector.evaluateSubscription(['double-count'])).toBe(4);
    expect(computedRuns).toBe(1);
    expect(inspector.getSnapshot().subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: JSON.stringify(['double-count']),
          status: 'value',
          value: 4,
        }),
      ]),
    );
    expect(computedRuns).toBe(1);
  });

  it('dispatches through the bound event router', async () => {
    initState({ count: 0 });
    regEvent<{ count: number }>('inspector-increment', ({ draftState }, amount: number) => {
      draftState.count += amount;
    });

    createReflexInspector().dispatch(['inspector-increment', 3]);
    await waitForScheduled();

    expect(getState<{ count: number }>().count).toBe(3);
  });

  it('supports independent trace subscriptions with idempotent cleanup', async () => {
    initState({ count: 0 });
    regEvent<{ count: number }>('inspector-trace', ({ draftState }) => {
      draftState.count++;
    });

    const inspector = createReflexInspector();
    const first: Trace[] = [];
    const second: Trace[] = [];
    const removeFirst = inspector.subscribeTraces((traces) => first.push(...traces));
    const removeSecond = inspector.subscribeTraces((traces) => second.push(...traces));
    expect(isTraceEnabled()).toBe(true);

    inspector.dispatch(['inspector-trace']);
    await waitForScheduled();
    await waitForTraceFlush();

    expect(first.filter((trace) => trace.operation === 'inspector-trace')).toHaveLength(1);
    expect(second.filter((trace) => trace.operation === 'inspector-trace')).toHaveLength(1);

    removeFirst();
    removeFirst();
    expect(isTraceEnabled()).toBe(true);
    inspector.dispatch(['inspector-trace']);
    await waitForScheduled();
    await waitForTraceFlush();

    expect(first.filter((trace) => trace.operation === 'inspector-trace')).toHaveLength(1);
    expect(second.filter((trace) => trace.operation === 'inspector-trace')).toHaveLength(2);
    removeSecond();
    expect(isTraceEnabled()).toBe(false);
  });

  it('keeps trace ids monotonic while discarding pending traces across lease cycles', async () => {
    const inspector = createReflexInspector();
    const firstCycle: Trace[] = [];
    const removeFirst = inspector.subscribeTraces((traces) => firstCycle.push(...traces));

    withTrace({ operation: 'first-cycle' }, () => {});
    await waitForTraceFlush();

    const firstTrace = firstCycle.find((trace) => trace.operation === 'first-cycle');
    expect(firstTrace).toBeDefined();

    withTrace({ operation: 'discarded-between-cycles' }, () => {});
    removeFirst();
    expect(isTraceEnabled()).toBe(false);

    const secondCycle: Trace[] = [];
    const removeSecond = inspector.subscribeTraces((traces) => secondCycle.push(...traces));
    await waitForTraceFlush();
    expect(secondCycle).toEqual([]);

    withTrace({ operation: 'second-cycle' }, () => {});
    await waitForTraceFlush();

    const secondTrace = secondCycle.find((trace) => trace.operation === 'second-cycle');
    expect(secondTrace).toBeDefined();
    expect(secondTrace!.id).toBe(firstTrace!.id + 2);

    removeSecond();
  });

  it('keeps inspector tracing active when the manual owner is released', () => {
    enableTracing();
    const removeTraceListener = createReflexInspector().subscribeTraces(() => {});

    disableTracing();
    expect(isTraceEnabled()).toBe(true);

    removeTraceListener();
    expect(isTraceEnabled()).toBe(false);
  });
});
