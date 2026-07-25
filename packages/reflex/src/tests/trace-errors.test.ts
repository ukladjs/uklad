import { defaultErrorHandler } from '../events/runner';
import { waitForScheduled } from './test-utils';
import {
  clearHandlers,
  disableTracing,
  dispatch,
  enableTracing,
  getHandlers,
  initState,
  regEffect,
  regEvent,
  regEventErrorHandler,
  registerTraceCallback,
  removeTraceCallback,
} from './runtime-test-api';

// Trace callbacks run after the 50 ms batching window.
const waitForTraceFlush = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('Error tracing', () => {
  let collected: any[] = [];

  beforeAll(() => {
    initState({});
    enableTracing();
    registerTraceCallback('trace-errors-test', (traces) => {
      collected.push(...traces);
    });
  });

  afterAll(() => {
    removeTraceCallback('trace-errors-test');
    disableTracing();
    regEventErrorHandler(defaultErrorHandler);
  });

  beforeEach(() => {
    collected = [];
  });

  it('attaches handler exceptions to the event trace', async () => {
    regEventErrorHandler(() => {}); // silent: keep the queue alive for other assertions

    regEvent('trace-boom', () => {
      throw new Error('boom!');
    });

    dispatch(['trace-boom', 1, 2]);
    await waitForScheduled();
    await waitForTraceFlush();

    const trace = collected.find((t) => t.operation === 'trace-boom' && t.opType === 'event');
    expect(trace).toBeDefined();
    expect(trace.tags.error).toMatchObject({
      phase: 'handler',
      message: 'boom!',
      interceptor: 'fx-handler',
      direction: 'before',
    });
    expect(trace.tags.error.eventV).toEqual(['trace-boom', 1, 2]);
    expect(typeof trace.tags.error.stack).toBe('string');
    // The error tag must survive JSON serialization for devtools/MCP transport
    expect(() => JSON.stringify(trace.tags.error)).not.toThrow();
  });

  it('attaches interceptor exceptions with the failing interceptor id', async () => {
    regEventErrorHandler(() => {});

    regEvent('trace-interceptor-boom', () => {}, {
      interceptors: [
        {
          id: 'exploding-interceptor',
          after: () => {
            throw new Error('interceptor failed');
          },
        },
      ],
    });

    dispatch(['trace-interceptor-boom']);
    await waitForScheduled();
    await waitForTraceFlush();

    const trace = collected.find((t) => t.operation === 'trace-interceptor-boom');
    expect(trace.tags.error).toMatchObject({
      phase: 'handler',
      message: 'interceptor failed',
      interceptor: 'exploding-interceptor',
      direction: 'after',
    });
  });

  it('traces dispatches of unregistered event ids', async () => {
    dispatch(['no-such-event', 'param']);
    await waitForScheduled();
    await waitForTraceFlush();

    const trace = collected.find((t) => t.operation === 'no-such-event');
    expect(trace).toBeDefined();
    expect(trace.opType).toBe('event');
    expect(trace.tags.event).toEqual(['no-such-event', 'param']);
    expect(trace.tags.error.phase).toBe('missing-handler');
    expect(trace.tags.error.message).toContain('no event handler registered');
  });

  it('attaches failed effects to the event trace', async () => {
    regEventErrorHandler(() => {});

    regEffect('exploding-effect', () => {
      throw new Error('effect failed');
    });
    regEvent('with-bad-effect', () => [['exploding-effect', 1]]);

    dispatch(['with-bad-effect']);
    await waitForScheduled();
    await waitForTraceFlush();

    const trace = collected.find((t) => t.operation === 'with-bad-effect');
    expect(trace.tags.effectErrors).toEqual([
      expect.objectContaining({
        phase: 'effect',
        effect: 'exploding-effect',
        message: 'effect failed',
      }),
    ]);
    // The event itself did not throw, so there is no handler error tag
    expect(trace.tags.error).toBeUndefined();
  });

  it('still traces the error if the framework error handler is unexpectedly absent', async () => {
    delete getHandlers().error['event-handler'];
    try {
      regEvent('trace-unhandled-boom', () => {
        throw new Error('unhandled');
      });

      dispatch(['trace-unhandled-boom']);
      await waitForScheduled();
      await waitForTraceFlush();

      const trace = collected.find((t) => t.operation === 'trace-unhandled-boom');
      expect(trace).toBeDefined();
      expect(trace.tags.error.message).toBe('unhandled');
      expect(trace.tags.error.eventV).toEqual(['trace-unhandled-boom']);
    } finally {
      clearHandlers('error');
    }
  });
});

describe('Queue failure isolation', () => {
  beforeAll(() => {
    initState({});
    // Default handler rethrows, so the exception reaches the router.
    regEventErrorHandler(defaultErrorHandler);
  });

  it('loudly reports the exception without dropping later accepted events', async () => {
    const processed: number[] = [];
    regEvent('isolated-boom', () => {
      throw new Error('kaboom');
    });
    regEvent('innocent', (_coeffects, value: number) => {
      processed.push(value);
    });

    dispatch(['isolated-boom']);
    dispatch(['innocent', 1]);
    dispatch(['innocent', 2]);
    await waitForScheduled();

    expect(processed).toEqual([1, 2]);
    expect(
      getTestLogCalls().error.some((call) => call[0] === '[reflex] event processing exception:'),
    ).toBe(true);
    expect(
      getTestLogCalls().error.some(
        (call) => typeof call[0] === 'string' && call[0].includes('event queue purged'),
      ),
    ).toBe(false);

    // The queue recovers: subsequent dispatches are processed normally
    let recovered = false;
    regEvent('after-failure', () => {
      recovered = true;
    });
    dispatch(['after-failure']);
    await waitForScheduled();
    expect(recovered).toBe(true);
  });
});
