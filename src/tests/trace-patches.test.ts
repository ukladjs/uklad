/**
 * Patch generation is conditional on tracing: produceWithPatches only runs
 * for the trace pipeline (devtools). With tracing off, events go through
 * plain produce and no patch tags exist anywhere.
 */
import {
  enableTracing,
  disableTracing,
  registerTraceCallback,
  removeTraceCallback,
} from '../trace';
import { regEvent } from '../events';
import { dispatch } from '../router';
import { initAppDb, getAppDb } from '../db';
import { waitForScheduled } from './test-utils';

// Trace batches are flushed on a 50ms debounce (src/trace.ts)
const waitForTraceFlush = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('Conditional patch generation', () => {
  let collected: any[] = [];

  regEvent('tp-set-value', ({ draftDb }, value) => {
    draftDb.value = value;
  });

  beforeEach(() => {
    collected = [];
    initAppDb({ value: 0 });
  });

  afterEach(() => {
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

    expect(getAppDb().value).toBe(42);

    const trace = collected.find((t) => t.operation === 'tp-set-value' && t.opType === 'event');
    expect(trace).toBeDefined();
    expect(trace.tags.patches).toEqual([{ op: 'replace', path: ['value'], value: 42 }]);
    expect(trace.tags.reversePatches).toEqual([{ op: 'replace', path: ['value'], value: 0 }]);
    expect(trace.tags.effects).toEqual([]);
  });

  it('should still commit db updates with tracing disabled (plain produce path)', async () => {
    dispatch(['tp-set-value', 7]);
    await waitForScheduled();

    expect(getAppDb().value).toBe(7);
  });
});
