/**
 * Patch generation is conditional on tracing: produceWithPatches only runs
 * for the trace pipeline (devtools). With tracing off, events go through
 * plain produce and no patch tags exist anywhere.
 */
import { waitForScheduled } from './test-utils';
import {
  createUkladRuntimeForTests as createUkladRuntime,
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
  addInterceptor,
  registerTraceCallback,
  removeTraceCallback,
  testRuntime,
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

    const revisionsBeforeDispatch = testRuntime.getStateRevisions();
    dispatch(['tp-set-value', 42]);
    await waitForScheduled();
    await waitForTraceFlush();

    expect(getState().value).toBe(42);

    const trace = collected.find((t) => t.operation === 'tp-set-value' && t.opType === 'event');
    expect(trace).toBeDefined();
    expect(trace.tags.patches).toEqual([{ op: 'replace', path: ['value'], value: 42 }]);
    expect(trace.tags.reversePatches).toEqual([{ op: 'replace', path: ['value'], value: 0 }]);
    expect(trace.tags.effects).toEqual([]);
    expect(trace.acceptedRevision).toBe(revisionsBeforeDispatch.committedRevision);
    expect(trace.startedRevision).toBe(revisionsBeforeDispatch.committedRevision);
    expect(trace.committedRevision).toBe(revisionsBeforeDispatch.committedRevision + 1);
    expect(trace.stateStatus).toBe('committed');
  });

  it('should still commit state updates with tracing disabled (plain produce path)', async () => {
    dispatch(['tp-set-value', 7]);
    await waitForScheduled();

    expect(getState().value).toBe(7);
  });

  it('does not allocate trace state while no trace consumer is attached', async () => {
    const runtime = createUkladRuntime({
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

  it('adds shared runtime event metadata to parent and child event traces', async () => {
    enableTracing();
    registerTraceCallback('trace-patches-test', (traces) => {
      collected.push(...traces);
    });
    regEvent('tp-correlation-root', () => [['dispatch', ['tp-correlation-child']]]);
    regEvent('tp-correlation-child', ({ draftState }) => {
      draftState.value = 13;
    });

    dispatch(['tp-correlation-root']);
    await waitForScheduled();
    await waitForTraceFlush();

    const root = collected.find(
      (trace) => trace.operation === 'tp-correlation-root' && trace.opType === 'event',
    );
    const child = collected.find(
      (trace) => trace.operation === 'tp-correlation-child' && trace.opType === 'event',
    );

    expect(root).toEqual(
      expect.objectContaining({
        runtimeInstanceId: testRuntime.runtimeInstanceId,
        eventInstanceId: expect.any(String),
      }),
    );
    expect(root.parentEventInstanceId).toBeUndefined();
    expect(child).toEqual(
      expect.objectContaining({
        runtimeInstanceId: testRuntime.runtimeInstanceId,
        eventInstanceId: expect.any(String),
        parentEventInstanceId: root.eventInstanceId,
      }),
    );
    expect(child.eventInstanceId).not.toBe(root.eventInstanceId);
  });

  it('should trace effects contributed by after interceptors', async () => {
    enableTracing();
    registerTraceCallback('trace-patches-test', (traces) => {
      collected.push(...traces);
    });
    regEffect('trace-after-effect', () => {});
    addInterceptor({
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
