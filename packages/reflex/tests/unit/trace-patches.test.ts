/**
 * Patch generation is conditional on tracing: produceWithPatches only runs
 * for the trace pipeline (devtools). With tracing off, events go through
 * plain produce and no patch tags exist anywhere.
 */
import { waitForScheduled } from './test-utils';
import {
  createReflexRuntimeForTests as createReflexRuntime,
  getRuntimeCoreForTests,
} from '../../src/runtime/runtime';
import {
  clearInterceptors,
  disableTracing,
  dispatch,
  enableTracing,
  getState,
  initState,
  regEffect,
  regEvent,
  registerInterceptor,
  registerTraceCallback,
  removeTraceCallback,
} from './runtime-test-api';

// Trace callbacks run after the 50 ms batching window.
const waitForTraceFlush = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('Conditional patch generation', () => {
  let collected: any[] = [];

  regEvent('tp-set-value', ({ draftState }, value) => {
    draftState.value = value;
  });

  beforeEach(() => {
    collected = [];
    initState({ value: 0 });
  });

  afterEach(() => {
    clearInterceptors();
    removeTraceCallback('trace-patches-test');
    disableTracing();
  });

  it('should attach patches, reversePatches and effects to event traces while tracing', async () => {
    enableTracing();
    registerTraceCallback('trace-patches-test', (traces) => {
      collected.push(...traces);
    });

    dispatch(['tp-set-value', 42]);
    await waitForScheduled();
    await waitForTraceFlush();

    expect(getState().value).toBe(42);

    const trace = collected.find((t) => t.operation === 'tp-set-value' && t.opType === 'event');
    expect(trace).toBeDefined();
    expect(trace.tags.patches).toEqual([{ op: 'replace', path: ['value'], value: 42 }]);
    expect(trace.tags.reversePatches).toEqual([{ op: 'replace', path: ['value'], value: 0 }]);
    expect(trace.tags.effects).toEqual([]);
  });

  it('should still commit state updates with tracing disabled (plain produce path)', async () => {
    dispatch(['tp-set-value', 7]);
    await waitForScheduled();

    expect(getState().value).toBe(7);
  });

  it('does not allocate trace state while no trace consumer is attached', async () => {
    const runtime = createReflexRuntime({
      runtimeId: 'trace-free-hot-path',
      initialState: { value: 0 },
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('set-value', ({ draftState }, value) => {
        draftState.value = value;
      });
    });

    runtime.dispatch(['set-value', 3]);
    await runtime.flush();

    expect(runtime.getState().value).toBe(3);
    expect(getRuntimeCoreForTests(runtime).probe).toBeUndefined();
    runtime.dispose();
  });

  it('should trace effects contributed by after interceptors', async () => {
    enableTracing();
    registerTraceCallback('trace-patches-test', (traces) => {
      collected.push(...traces);
    });
    regEffect('trace-after-effect', () => {});
    registerInterceptor({
      id: 'trace-after-interceptor',
      after: (context) => {
        context.effects.push(['trace-after-effect', { key: 'value' }]);
        return context;
      },
    });

    dispatch(['tp-set-value', 9]);
    await waitForScheduled();
    await waitForTraceFlush();

    const trace = collected.find((t) => t.operation === 'tp-set-value' && t.opType === 'event');
    expect(trace.tags.effects).toEqual([['trace-after-effect', { key: 'value' }]]);
  });
});
