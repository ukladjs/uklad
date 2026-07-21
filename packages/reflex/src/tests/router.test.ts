import { EventQueue } from '../events/router';
import type { EventVector } from '../types';
import { waitForScheduled, waitForAnimationFrame, createEventWithMeta } from './test-utils';
import { dispatch } from './runtime-test-api';

describe('EventQueue', () => {
  let calls: EventVector[];
  let queue: EventQueue;

  beforeEach(() => {
    calls = [];
    queue = new EventQueue((event: EventVector) => {
      calls.push(event);
    });
    clearTestLogCalls();
  });

  describe('Basic Event Processing', () => {
    test('processes events asynchronously in order', async () => {
      queue.push(['first']);
      queue.push(['second']);
      queue.push(['third']);

      expect(calls).toEqual([]);
      expect(queue.getState()).toBe('scheduled');
      expect(queue.getQueueLength()).toBe(3);

      await waitForScheduled();

      expect(calls).toEqual([['first'], ['second'], ['third']]);
      expect(queue.getState()).toBe('idle');
      expect(queue.getQueueLength()).toBe(0);
    });

    test('handles single event correctly', async () => {
      queue.push(['single-event', 'param1', 'param2']);

      expect(queue.getState()).toBe('scheduled');
      expect(queue.getQueueLength()).toBe(1);

      await waitForScheduled();

      expect(calls).toEqual([['single-event', 'param1', 'param2']]);
      expect(queue.getState()).toBe('idle');
    });

    test('can add events while processing', async () => {
      const processingQueue = new EventQueue((event: EventVector) => {
        calls.push(event);
        if (event[0] === 'first') {
          processingQueue.push(['added-during-processing']);
        }
      });

      processingQueue.push(['first']);
      processingQueue.push(['second']);

      await waitForScheduled();

      expect(calls).toEqual([['first'], ['second']]);

      // Events queued during a run move to the next scheduled snapshot.
      await waitForScheduled();

      expect(calls).toEqual([['first'], ['second'], ['added-during-processing']]);
      expect(processingQueue.getState()).toBe('idle');
    });
  });

  describe('FSM State Transitions', () => {
    test('transitions from idle to scheduled on first event', () => {
      expect(queue.getState()).toBe('idle');

      queue.push(['event']);

      expect(queue.getState()).toBe('scheduled');
    });

    test('stays scheduled when adding multiple events before processing', () => {
      queue.push(['first']);
      expect(queue.getState()).toBe('scheduled');

      queue.push(['second']);
      expect(queue.getState()).toBe('scheduled');

      queue.push(['third']);
      expect(queue.getState()).toBe('scheduled');
    });

    test('transitions from scheduled to running when processing starts', async () => {
      let processingStarted = false;
      const testQueue = new EventQueue((event: EventVector) => {
        if (!processingStarted) {
          processingStarted = true;
          expect(testQueue.getState()).toBe('running');
        }
        calls.push(event);
      });

      testQueue.push(['event']);
      await waitForScheduled();

      expect(processingStarted).toBe(true);
    });

    test('transitions to idle after processing all events', async () => {
      queue.push(['event']);

      expect(queue.getState()).toBe('scheduled');
      await waitForScheduled();
      expect(queue.getState()).toBe('idle');
    });

    test('transitions to scheduled after processing when more events exist', async () => {
      const testQueue = new EventQueue((event: EventVector) => {
        calls.push(event);
        if (event[0] === 'first') {
          testQueue.push(['added-later']);
        }
      });

      testQueue.push(['first']);
      testQueue.push(['second']);
      expect(testQueue.getState()).toBe('scheduled');
      await waitForScheduled();
      expect(calls.length).toBe(2);
      expect(testQueue.getState()).toBe('scheduled');
      await waitForScheduled();
      expect(calls.length).toBe(3);
      expect(testQueue.getState()).toBe('idle');
    });
  });

  describe('Meta-based Scheduling', () => {
    test('handles flush meta correctly', async () => {
      const flushEvent = createEventWithMeta('flush-event', { flush: true });
      const normalEvent: EventVector = ['normal-event'];

      queue.push(normalEvent);
      queue.push(flushEvent);
      queue.push(['after-flush']);

      await waitForScheduled();

      expect(calls[0]).toEqual(normalEvent);
      expect(queue.getState()).toBe('paused');

      // A flush pauses until the render scheduler resumes the queue.
      await waitForAnimationFrame();

      expect(calls).toEqual([normalEvent, flushEvent, ['after-flush']]);
      expect(queue.getState()).toBe('idle');
    });

    test('handles yield meta correctly', async () => {
      const yieldEvent = createEventWithMeta('yield-event', { yield: true });

      queue.push(yieldEvent);
      queue.push(['after-yield']);

      await waitForScheduled();

      expect(calls.length).toBe(0);
      expect(queue.getState()).toBe('paused');

      await waitForScheduled();
      expect(calls.length).toBe(2);
      expect(calls).toEqual([yieldEvent, ['after-yield']]);
      expect(queue.getState()).toBe('idle');
    });

    test('prioritizes first meta key when multiple exist', async () => {
      const multiMetaEvent = createEventWithMeta('multi-meta', {
        flush: true,
        yield: true,
      });

      queue.push(['before']);
      queue.push(multiMetaEvent);
      queue.push(['after']);

      await waitForScheduled();

      expect(calls[0]).toEqual(['before']);
      expect(queue.getState()).toBe('paused');

      await waitForScheduled();
      // The first metadata key wins, so a next-tick wait cannot resume this flush.
      expect(queue.getState()).toBe('paused');

      await waitForAnimationFrame();

      expect(calls).toEqual([['before'], multiMetaEvent, ['after']]);
    });
  });

  describe('Error Handling', () => {
    test('handles exceptions during event processing', async () => {
      const errorQueue = new EventQueue((event: EventVector) => {
        if (event[0] === 'error-event') {
          throw new Error('Test error');
        }
        calls.push(event);
      });

      errorQueue.push(['error-event']);

      await waitForScheduled();

      expect(calls).toEqual([]);
      expect(errorQueue.getState()).toBe('idle');
      expect(errorQueue.getQueueLength()).toBe(0);

      expect(getTestLogCalls().error).toHaveLength(1);
      expect(
        getTestLogCalls().error.some((call) => call[0] === '[reflex] event processing exception:'),
      ).toBe(true);
      expect(
        getTestLogCalls().error.some((call) =>
          String(call[0]).includes('router state transition not found'),
        ),
      ).toBe(false);
    });

    test('handles exceptions with meta events', async () => {
      const errorQueue = new EventQueue((event: EventVector) => {
        if (event[0] === 'error-event') {
          throw new Error('Meta error');
        }
        calls.push(event);
      });

      const errorEvent = createEventWithMeta('error-event', { flush: true });

      errorQueue.push(['before-error']);
      errorQueue.push(errorEvent);
      errorQueue.push(['after-error']);

      await waitForScheduled();

      expect(calls).toEqual([['before-error']]);
      expect(errorQueue.getState()).toBe('paused');

      // The failing meta event does not execute until the render boundary resumes.
      await waitForAnimationFrame();

      expect(errorQueue.getState()).toBe('idle');
      expect(errorQueue.getQueueLength()).toBe(0);
      expect(calls).toEqual([['before-error'], ['after-error']]);
      expect(getTestLogCalls().error.length).toBeGreaterThanOrEqual(1);
    });

    test('logs error for invalid state transitions', () => {
      const testQueue = new EventQueue(() => {});

      // Invalid transitions are unreachable through the public queue API.
      (testQueue as any).fsmTrigger('invalid-trigger' as any);

      expect(getTestLogCalls().error.length).toBe(1);
      expect(getTestLogCalls().error[0]![0]).toContain(
        '[reflex] router state transition not found',
      );
    });

    test('handles exception mid-queue without crashing on subsequent events', async () => {
      const calls: EventVector[] = [];
      const errorQueue = new EventQueue((event: EventVector) => {
        calls.push(event);
        if (event[0] === 'error-event') {
          throw new Error('Mid-queue error');
        }
      });

      errorQueue.push(['before1']);
      errorQueue.push(['before2']);
      errorQueue.push(['error-event']);
      errorQueue.push(['after1']);
      errorQueue.push(['after2']);

      await waitForScheduled();

      // The failing event is isolated; later accepted events still run in FIFO order.
      expect(calls).toEqual([['before1'], ['before2'], ['error-event'], ['after1'], ['after2']]);
      expect(errorQueue.getState()).toBe('idle');
      expect(errorQueue.getQueueLength()).toBe(0);
      expect(getTestLogCalls().error.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Pause and Resume', () => {
    test('pauses and resumes correctly with flush events', async () => {
      const flushEvent = createEventWithMeta('flush-event', { flush: true });

      queue.push(['before-flush']);
      queue.push(flushEvent);
      queue.push(['check-pause']);

      await waitForScheduled();
      expect(queue.getState()).toBe('paused');

      await waitForAnimationFrame();
      expect(queue.getState()).toBe('idle');
      expect(calls.length).toBe(3);
    });

    test('can add events while paused', async () => {
      const flushEvent = createEventWithMeta('flush-event', { flush: true });

      queue.push(['before-pause']);
      queue.push(flushEvent);

      await waitForScheduled();
      expect(queue.getState()).toBe('paused');

      queue.push(['added-while-paused']);
      expect(queue.getState()).toBe('paused');

      await waitForAnimationFrame();

      expect(calls).toEqual([['before-pause'], flushEvent, ['added-while-paused']]);
      expect(queue.getState()).toBe('idle');
    });
  });

  describe('Purge Functionality', () => {
    test('purge clears pending events', async () => {
      queue.push(['first']);
      queue.push(['second']);

      expect(queue.getQueueLength()).toBe(2);
      queue.purge();
      expect(queue.getQueueLength()).toBe(0);

      await waitForScheduled();
      expect(calls).toEqual([]);
    });

    test('purge clears queue and stops processing remaining events', async () => {
      const testQueue = new EventQueue((event: EventVector) => {
        calls.push(event);
      });

      testQueue.push(['first']);
      testQueue.push(['second']);
      testQueue.push(['third']);

      testQueue.purge();

      await waitForScheduled();

      expect(calls).toEqual([]);
      expect(testQueue.getQueueLength()).toBe(0);
      expect(testQueue.getState()).toBe('idle');
    });
  });

  describe('Debugging Methods', () => {
    test('getState returns correct FSM state', async () => {
      expect(queue.getState()).toBe('idle');

      queue.push(['event']);
      expect(queue.getState()).toBe('scheduled');

      await waitForScheduled();
      expect(queue.getState()).toBe('idle');
    });

    test('getQueueLength returns correct queue length', () => {
      expect(queue.getQueueLength()).toBe(0);

      queue.push(['first']);
      expect(queue.getQueueLength()).toBe(1);

      queue.push(['second']);
      expect(queue.getQueueLength()).toBe(2);

      queue.purge();
      expect(queue.getQueueLength()).toBe(0);
    });
  });
});

describe('Global dispatch function', () => {
  beforeEach(() => {
    clearTestLogCalls();
  });

  test('dispatches valid events', async () => {
    dispatch(['valid-event', 'param']);

    expect(getTestLogCalls().error.length).toBe(0);
  });

  test('rejects invalid event vectors', () => {
    dispatch(null as any);
    dispatch(undefined as any);
    dispatch('not-an-array' as any);
    dispatch([] as any);
    dispatch({} as any);
    dispatch([123] as any);
    dispatch([null] as any);

    expect(getTestLogCalls().error.length).toBe(7);
    getTestLogCalls().error.forEach((errorCall) => {
      expect(errorCall[0]).toBe('[reflex] invalid dispatch event vector.');
    });
  });

  test('accepts various valid event vector formats', () => {
    dispatch(['simple']);
    dispatch(['with-param', 'value']);
    dispatch(['with-multiple', 'param1', 'param2', { complex: 'object' }]);

    expect(getTestLogCalls().error.length).toBe(0);
  });
});

describe('Environment Specific Scheduling', () => {
  describe('scheduleAfterRender', () => {
    test('uses requestAnimationFrame when available', async () => {
      const originalRAF = (globalThis as any).requestAnimationFrame;
      (globalThis as any).requestAnimationFrame = jest.fn((cb: any) => setTimeout(cb, 16));

      try {
        expect(typeof requestAnimationFrame).toBe('function');

        const flushEvent = createEventWithMeta('flush-test', { flush: true });
        const testQueue = new EventQueue((event) => {
          if (event[0] === 'flush-test') {
            expect(typeof requestAnimationFrame).toBe('function');
          }
        });

        testQueue.push(flushEvent);
        await waitForScheduled();
        await waitForAnimationFrame();
      } finally {
        if (originalRAF) {
          (globalThis as any).requestAnimationFrame = originalRAF;
        } else {
          delete (globalThis as any).requestAnimationFrame;
        }
      }
    });
  });

  describe('scheduleNextTick', () => {
    test('uses MessageChannel when available', async () => {
      expect(typeof MessageChannel).toBe('function');

      const yieldEvent = createEventWithMeta('yield-test', { yield: true });
      const testQueue = new EventQueue((event) => {
        if (event[0] === 'yield-test') {
          expect(typeof MessageChannel).toBe('function');
        }
      });

      testQueue.push(yieldEvent);
      // The first tick pauses at yield; the second resumes the queue.
      await waitForScheduled();
      await waitForScheduled();
    });
  });
});

describe('Complex Scenarios', () => {
  test('handles rapid event addition during processing', async () => {
    const calls: EventVector[] = [];
    let addMoreEvents = true;

    const rapidQueue = new EventQueue((event: EventVector) => {
      calls.push(event);

      if (addMoreEvents && calls.length < 5) {
        rapidQueue.push([`rapid-${calls.length}`]);
      } else {
        addMoreEvents = false;
      }
    });

    rapidQueue.push(['initial']);

    await waitForScheduled();

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['initial']);
    await waitForScheduled();
    expect(calls[1]![0]).toBe('rapid-1');
    await waitForScheduled();
    expect(calls[2]![0]).toBe('rapid-2');
    await waitForScheduled();
    expect(calls[3]![0]).toBe('rapid-3');
    await waitForScheduled();
    expect(calls[4]![0]).toBe('rapid-4');
    expect(calls.length).toBe(5);
    await waitForScheduled();
    expect(calls.length).toBe(5);
  });

  test('handles mixed meta events correctly', async () => {
    const calls: EventVector[] = [];
    const mixedQueue = new EventQueue((event) => calls.push(event));

    const flushEvent = createEventWithMeta('flush', { flush: true });
    const yieldEvent = createEventWithMeta('yield', { yield: true });

    mixedQueue.push(['normal1']);
    mixedQueue.push(flushEvent);
    mixedQueue.push(['normal2']);
    mixedQueue.push(yieldEvent);
    mixedQueue.push(['normal3']);

    // Each metadata marker pauses at its own scheduler boundary.
    await waitForScheduled();
    expect(calls[0]).toEqual(['normal1']);

    expect(mixedQueue.getState()).toBe('paused');
    await waitForAnimationFrame();

    expect(calls[1]).toEqual(flushEvent);
    expect(calls[2]).toEqual(['normal2']);

    await waitForScheduled();
    expect(calls[3]).toEqual(yieldEvent);
    expect(calls[4]).toEqual(['normal3']);
    expect(mixedQueue.getState()).toBe('idle');

    expect(calls).toEqual([['normal1'], flushEvent, ['normal2'], yieldEvent, ['normal3']]);
  });

  test('handles exception during meta event processing', async () => {
    const calls: EventVector[] = [];
    const errorQueue = new EventQueue((event: EventVector) => {
      calls.push(event);
      if (event[0] === 'flush-error') {
        throw new Error('Flush processing error');
      }
    });

    const errorFlushEvent = createEventWithMeta('flush-error', { flush: true });

    errorQueue.push(['before-error']);
    errorQueue.push(errorFlushEvent);
    errorQueue.push(['after-error']);

    await waitForScheduled();
    expect(calls).toEqual([['before-error']]);
    expect(errorQueue.getState()).toBe('paused');

    await waitForAnimationFrame();

    expect(getTestLogCalls().error.length).toBeGreaterThanOrEqual(1);
    expect(errorQueue.getState()).toBe('idle');
    expect(errorQueue.getQueueLength()).toBe(0);
    expect(calls).toEqual([['before-error'], errorFlushEvent, ['after-error']]);
  });
});
