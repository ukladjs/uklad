import type { CoEffects, EventRegistrationOptions, Interceptor, Context } from '../types';
import {
  clearInterceptors,
  dispatch,
  dispatchSync,
  getState,
  initState,
  regCoeffect,
  regEffect,
  regEvent,
  registerInterceptor,
  registerHandler,
} from './runtime-test-api';
import { waitForScheduled } from './test-utils';

interface EventTestState {
  counter: number;
  messages: string[];
  user: {
    id: number;
    name: string;
    isActive: boolean;
  };
  settings: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
}

describe('regEvent', () => {
  // Prevent expected handler failures from reaching the console.
  beforeAll(() => {
    registerHandler('error', 'event-handler', () => undefined);
  });

  describe('Initialize state', () => {
    it('should handle state initialized', () => {
      initState({ counter: 0, items: [] });
      expect(getState()).toEqual(expect.objectContaining({ counter: 0, items: [] }));
    });
  });

  describe('Event dispatch async and handling', () => {
    it('should handle async event dispatch with queue management', async () => {
      const initialState = getState();
      expect(initialState.counter).toBe(0);

      regEvent('incrementCounter', ({ draftState }) => {
        draftState.counter += 1;
      });

      dispatch(['incrementCounter']);

      // dispatch queues work; it must not commit synchronously.
      expect(getState().counter).toBe(0);

      await waitForScheduled();

      expect(getState().counter).toBe(1);
    });
  });

  describe('Event dispatch async and handling with Immer', () => {
    it('should handle async event dispatch with Immer stateUpdate effect', async () => {
      const initialState = getState();
      const initialCounter = initialState.counter;

      const originalStateReference = initialState;

      regEvent('incrementCounterImmer', ({ draftState }) => {
        draftState.counter += 1;
        draftState.lastUpdated = Date.now();
      });

      dispatch(['incrementCounterImmer']);

      // The queued handler must not mutate the current snapshot.
      expect(getState().counter).toBe(initialCounter);

      await waitForScheduled();

      const updatedState = getState();

      expect(updatedState.counter).toBe(initialCounter + 1);
      expect(updatedState.lastUpdated).toBeDefined();

      expect(originalStateReference.counter).toBe(initialCounter);
      expect(originalStateReference.lastUpdated).toBeUndefined();

      expect(updatedState).not.toBe(originalStateReference);
    });

    it('should handle async event dispatch with complex Immer mutations', async () => {
      const initialState = getState();

      regEvent('complexImmerUpdate', ({ draftState }) => {
        draftState.counter += 5;

        if (!draftState.todos) draftState.todos = [];
        draftState.todos.push({ id: 1, text: 'Async todo 1', completed: false });
        draftState.todos.push({ id: 2, text: 'Async todo 2', completed: true });

        if (!draftState.user) draftState.user = {};
        draftState.user.lastAction = 'complex-update';
        draftState.user.actionCount = (draftState.user.actionCount || 0) + 1;
      });

      dispatch(['complexImmerUpdate']);

      expect(getState().counter).toBe(initialState.counter);

      await waitForScheduled();

      const updatedState = getState();

      expect(updatedState.counter).toBe(initialState.counter + 5);
      expect(updatedState.todos).toHaveLength(2);
      expect(updatedState.todos[0]).toEqual({ id: 1, text: 'Async todo 1', completed: false });
      expect(updatedState.todos[1]).toEqual({ id: 2, text: 'Async todo 2', completed: true });
      expect(updatedState.user.lastAction).toBe('complex-update');
      expect(updatedState.user.actionCount).toBe(1);

      expect(updatedState).not.toBe(initialState);
    });

    it('should allow effects through fx properly', async () => {
      const capturedEvents: string[] = [];
      regEvent('captureTestEvent', () => {
        capturedEvents.push('captured');
      });

      regEvent('effectsTest', ({ draftState }) => {
        draftState.fxTestValue = 'updated-via-fx';
        return [['dispatch', ['captureTestEvent']]];
      });

      dispatch(['effectsTest']);

      // The dispatched effect runs in a later queue cycle, so wait for both events.
      await new Promise<void>((resolve) => {
        let resolved = false;
        const timeouts: ReturnType<typeof setTimeout>[] = [];

        const checkForCompletion = () => {
          if (resolved) return;
          if (capturedEvents.length > 0 && getState().fxTestValue === 'updated-via-fx') {
            resolved = true;
            timeouts.forEach(clearTimeout);
            resolve();
          } else {
            timeouts.push(setTimeout(checkForCompletion, 10));
          }
        };

        timeouts.push(setTimeout(checkForCompletion, 0));
        // Bound the poll so a failure cannot leave Jest waiting indefinitely.
        timeouts.push(
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              timeouts.forEach(clearTimeout);
              resolve();
            }
          }, 1000),
        );
      });

      const updatedState = getState();

      expect(updatedState.fxTestValue).toBe('updated-via-fx');

      expect(capturedEvents).toContain('captured');
    });
  });
});

describe('Type-safe Event Handlers', () => {
  beforeEach(() => {
    const initialState: EventTestState = {
      counter: 0,
      messages: [],
      user: {
        id: 1,
        name: 'Test User',
        isActive: true,
      },
      settings: {
        theme: 'light',
        notifications: true,
      },
    };
    initState<EventTestState>(initialState);
  });

  describe('Type-safe event registration and handling', () => {
    it('should handle type-safe counter increment', async () => {
      regEvent<EventTestState>('increment-counter', ({ draftState }) => {
        const currentCounter = draftState.counter;
        expect(typeof currentCounter).toBe('number');
        draftState.counter += 1;
      });

      dispatch(['increment-counter']);

      await waitForScheduled();

      const state = getState<EventTestState>();
      expect(state.counter).toBe(1);
    });

    it('should handle type-safe array operations', async () => {
      regEvent<EventTestState>('add-message', ({ draftState }, ...params) => {
        const [message] = params as [string];
        draftState.messages.push(message);
      });

      dispatch(['add-message', 'Hello World']);
      await waitForScheduled();

      const state = getState<EventTestState>();
      expect(state.messages).toContain('Hello World');
      expect(state.messages).toHaveLength(1);
    });

    it('should handle type-safe nested object updates', async () => {
      regEvent<EventTestState>('update-user', ({ draftState }, ...params) => {
        const [name, isActive] = params as [string, boolean];
        draftState.user.name = name;
        draftState.user.isActive = isActive;
      });

      dispatch(['update-user', 'John Doe', false]);
      await waitForScheduled();

      const state = getState<EventTestState>();
      expect(state.user.name).toBe('John Doe');
      expect(state.user.isActive).toBe(false);
      expect(state.user.id).toBe(1);
    });

    it('should handle type-safe union type fields', async () => {
      regEvent<EventTestState>('toggle-theme', ({ draftState }) => {
        draftState.settings.theme = draftState.settings.theme === 'light' ? 'dark' : 'light';
      });

      dispatch(['toggle-theme']);
      await waitForScheduled();

      let state = getState<EventTestState>();
      expect(state.settings.theme).toBe('dark');

      dispatch(['toggle-theme']);
      await waitForScheduled();

      state = getState<EventTestState>();
      expect(state.settings.theme).toBe('light');
    });

    it('should handle complex type-safe updates', async () => {
      regEvent<EventTestState>('complex-update', ({ draftState }, ...params) => {
        const [userId, userName, messages] = params as [number, string, string[]];
        draftState.user.id = userId;
        draftState.user.name = userName;
        draftState.messages = [...draftState.messages, ...messages];
        draftState.counter += messages.length;
        draftState.settings.notifications = !draftState.settings.notifications;
      });

      dispatch(['complex-update', 42, 'Complex User', ['msg1', 'msg2', 'msg3']]);
      await waitForScheduled();

      const state = getState<EventTestState>();
      expect(state.user.id).toBe(42);
      expect(state.user.name).toBe('Complex User');
      expect(state.messages).toEqual(['msg1', 'msg2', 'msg3']);
      expect(state.counter).toBe(3);
      expect(state.settings.notifications).toBe(false);
    });

    it('should maintain type safety with multiple event handlers', async () => {
      regEvent<EventTestState>('multi-test-1', ({ draftState }) => {
        draftState.counter += 10;
      });

      regEvent<EventTestState>('multi-test-2', ({ draftState }) => {
        draftState.messages.push('From handler 2');
      });

      regEvent<EventTestState>('multi-test-3', ({ draftState }) => {
        draftState.user.isActive = !draftState.user.isActive;
      });

      dispatch(['multi-test-1']);
      dispatch(['multi-test-2']);
      dispatch(['multi-test-3']);

      // All three queued events must drain before reading the state.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = getState<EventTestState>();
      expect(state.counter).toBe(10);
      expect(state.messages).toContain('From handler 2');
      expect(state.user.isActive).toBe(false);
    });
  });

  describe('Type-safe event handling with fx effects', () => {
    it('should handle type-safe events with fx effects', async () => {
      let fxExecuted = false;

      regEvent<EventTestState>('fx-helper', ({ draftState }) => {
        fxExecuted = true;
        draftState.messages.push('FX executed');
      });

      regEvent<EventTestState>('main-with-effects', ({ draftState }) => {
        draftState.counter += 5;
        return [['dispatch', ['fx-helper']]];
      });

      dispatch(['main-with-effects']);

      // The dispatch effect requires another queue cycle.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const state = getState<EventTestState>();
      expect(state.counter).toBe(5);
      expect(state.messages).toContain('FX executed');
      expect(fxExecuted).toBe(true);
    });
  });

  describe('Type-safe backward compatibility', () => {
    it('should allow mixing typed and untyped event handlers', async () => {
      regEvent<EventTestState>('typed-handler', ({ draftState }) => {
        draftState.counter += 1;
      });

      regEvent('untyped-handler', ({ draftState }) => {
        (draftState as any).counter += 10;
        (draftState as any).untypedField = 'added';
      });

      dispatch(['typed-handler']);
      dispatch(['untyped-handler']);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = getState<EventTestState>();
      expect(state.counter).toBe(11);
      expect((state as any).untypedField).toBe('added');
    });
  });
});

describe('regEvent with cofx', () => {
  beforeEach(() => {
    initState({ counter: 0, messages: [], timestamp: 0, randomValue: 0 });
    regCoeffect('now', (coeffects) => ({
      ...coeffects,
      now: Date.now(),
    }));
    regCoeffect('random', (coeffects) => ({
      ...coeffects,
      random: Math.random(),
    }));
  });

  describe('Basic cofx functionality', () => {
    it('should inject an application-defined clock cofx', async () => {
      regEvent(
        'test-now-cofx',
        ({ draftState, now }) => {
          expect(now).toBeDefined();
          expect(typeof now).toBe('number');
          expect(now).toBeGreaterThan(0);

          (draftState as any).timestamp = now;
        },
        { coeffects: [['now']] },
      );

      dispatch(['test-now-cofx']);
      await waitForScheduled();

      const state = getState();
      expect(state.timestamp).toBeGreaterThan(0);
    });

    it('should inject an application-defined random cofx', async () => {
      regEvent(
        'test-random-cofx',
        ({ draftState, random }) => {
          expect(random).toBeDefined();
          expect(typeof random).toBe('number');
          expect(random).toBeGreaterThanOrEqual(0);
          expect(random).toBeLessThan(1);

          (draftState as any).randomValue = random;
        },
        { coeffects: [['random']] },
      );

      dispatch(['test-random-cofx']);
      await waitForScheduled();

      const state = getState();
      expect(state.randomValue).toBeGreaterThanOrEqual(0);
      expect(state.randomValue).toBeLessThan(1);
    });

    it('should inject state cofx', async () => {
      const initialState = getState();

      regEvent('test-state-cofx', ({ draftState }) => {
        expect(draftState).toBeDefined();
        expect(draftState).toEqual(initialState);

        (draftState as any).counter = draftState.counter + 5;
      });

      dispatch(['test-state-cofx']);
      await waitForScheduled();

      const state = getState();
      expect(state.counter).toBe(5);
    });
  });

  describe('Multiple cofx', () => {
    it('should inject multiple cofx in a single registration', async () => {
      regEvent(
        'test-multiple-cofx',
        ({ draftState, now, random }) => {
          expect(now).toBeDefined();
          expect(random).toBeDefined();
          expect(draftState).toBeDefined();

          (draftState as any).timestamp = now;
          (draftState as any).randomValue = random;
          (draftState as any).counter = draftState.counter + 1;
        },
        { coeffects: [['now'], ['random']] },
      );

      dispatch(['test-multiple-cofx']);
      await waitForScheduled();

      const state = getState();
      expect(state.timestamp).toBeGreaterThan(0);
      expect(state.randomValue).toBeGreaterThanOrEqual(0);
      expect(state.counter).toBe(1);
    });
  });

  describe('Cofx with custom interceptors', () => {
    it('should support explicit registration options', async () => {
      const executionOrder: string[] = [];
      const options: EventRegistrationOptions = {
        coeffects: [['now']],
        interceptors: [
          {
            id: 'options-interceptor',
            before: (context) => {
              executionOrder.push('before');
              return context;
            },
            after: (context) => {
              executionOrder.push('after');
              return context;
            },
          },
        ],
      };

      regEvent(
        'test-registration-options',
        ({ draftState, now }) => {
          executionOrder.push('handler');
          draftState.timestamp = now;
        },
        options,
      );

      dispatch(['test-registration-options']);
      await waitForScheduled();

      expect(getState().timestamp).toBeGreaterThan(0);
      expect(executionOrder).toEqual(['before', 'handler', 'after']);
    });

    it('should combine cofx with custom interceptors', async () => {
      let beforeCalled = false;
      let afterCalled = false;

      const beforeInterceptor = {
        id: 'before-test',
        before: (ctx: any) => {
          beforeCalled = true;
          return ctx;
        },
      };

      const afterInterceptor = {
        id: 'after-test',
        after: (ctx: any) => {
          afterCalled = true;
          return ctx;
        },
      };

      regEvent(
        'test-cofx-with-interceptors',
        ({ draftState, now }) => {
          expect(now).toBeDefined();
          expect(draftState).toBeDefined();

          (draftState as any).timestamp = now;
          (draftState as any).counter = draftState.counter + 10;
        },
        {
          coeffects: [['now']],
          interceptors: [beforeInterceptor, afterInterceptor],
        },
      );

      dispatch(['test-cofx-with-interceptors']);
      await waitForScheduled();

      const state = getState();
      expect(state.timestamp).toBeGreaterThan(0);
      expect(state.counter).toBe(10);
      expect(beforeCalled).toBe(true);
      expect(afterCalled).toBe(true);
    });
  });

  describe('Registration metadata', () => {
    it('should commit STATE changes when an untyped interceptor omits effects', () => {
      initState({ counter: 0 });
      const legacyInterceptor: Interceptor = {
        id: 'legacy-context-without-effects',
        before: (context) => {
          delete (context as unknown as { effects?: Context['effects'] }).effects;
          return context;
        },
      };

      regEvent(
        'test-context-without-effects',
        ({ draftState }) => {
          draftState.counter += 1;
        },
        { interceptors: [legacyInterceptor] },
      );

      dispatchSync(['test-context-without-effects']);

      expect(getState().counter).toBe(1);
    });

    it('should register interceptors without coeffects', () => {
      const interceptorCall = jest.fn();
      const testInterceptor: Interceptor = {
        id: 'empty-cofx-interceptor',
        before: (context) => {
          interceptorCall();
          return context;
        },
      };

      regEvent(
        'test-empty-cofx-with-interceptors',
        ({ draftState }) => {
          draftState.counter += 1;
        },
        { interceptors: [testInterceptor] },
      );

      dispatchSync(['test-empty-cofx-with-interceptors']);

      expect(getState().counter).toBe(1);
      expect(interceptorCall).toHaveBeenCalledTimes(1);
    });

    it('should replace and clear event interceptors when re-registering an id', () => {
      const staleCall = jest.fn();
      const replacementCall = jest.fn();
      const handler = ({ draftState }: CoEffects) => {
        draftState.counter += 1;
      };

      regEvent('test-reregister-interceptors', handler, {
        interceptors: [
          {
            id: 'stale-interceptor',
            before: (context) => {
              staleCall();
              return context;
            },
          },
        ],
      });
      regEvent('test-reregister-interceptors', handler, {
        interceptors: [
          {
            id: 'replacement-interceptor',
            before: (context) => {
              replacementCall();
              return context;
            },
          },
        ],
      });

      dispatchSync(['test-reregister-interceptors']);

      expect(staleCall).not.toHaveBeenCalled();
      expect(replacementCall).toHaveBeenCalledTimes(1);

      regEvent('test-reregister-interceptors', handler);
      dispatchSync(['test-reregister-interceptors']);

      expect(staleCall).not.toHaveBeenCalled();
      expect(replacementCall).toHaveBeenCalledTimes(1);
      expect(getState().counter).toBe(2);
    });

    it('should support interceptor-only options', async () => {
      let interceptorCalled = false;

      const testInterceptor = {
        id: 'backward-compat-test',
        before: (ctx: any) => {
          interceptorCalled = true;
          return ctx;
        },
      };

      regEvent(
        'test-backward-compat',
        ({ draftState }) => {
          (draftState as any).counter += 1;
        },
        { interceptors: [testInterceptor] },
      );

      dispatch(['test-backward-compat']);
      await waitForScheduled();

      const state = getState();
      expect(state.counter).toBe(1);
      expect(interceptorCalled).toBe(true);
    });

    it('should support handler-only registration', async () => {
      regEvent('test-handler-only', ({ draftState }) => {
        (draftState as any).counter += 2;
      });

      dispatch(['test-handler-only']);
      await waitForScheduled();

      const state = getState();
      expect(state.counter).toBe(2);
    });
  });

  describe('Error handling', () => {
    it('should warn about invalid cofx specifications', async () => {
      regEvent(
        'test-invalid-cofx',
        ({ draftState }) => {
          (draftState as any).counter += 1;
        },
        { coeffects: [['now', 'extra', 'invalid'] as any] },
      );

      dispatch(['test-invalid-cofx']);
      await waitForScheduled();

      expectLogCall('warn', '[reflex] invalid cofx specification:', ['now', 'extra', 'invalid']);
    });
  });

  describe('Custom cofx', () => {
    it('should work with custom registered cofx', async () => {
      regCoeffect('custom-test', (coeffects: any, value: any) => ({
        ...coeffects,
        customValue: value || 'default-custom-value',
      }));

      regEvent(
        'test-custom-cofx',
        ({ draftState, customValue }) => {
          expect(customValue).toBe('default-custom-value');

          (draftState as any).messages.push(customValue);
        },
        { coeffects: [['custom-test']] },
      );

      dispatch(['test-custom-cofx']);
      await waitForScheduled();

      const state = getState();
      expect(state.messages).toContain('default-custom-value');
    });

    it('should work with custom cofx with values', async () => {
      regCoeffect('custom-with-value', (coeffects: any, value: any) => ({
        ...coeffects,
        customValue: `processed-${value}`,
      }));

      regEvent(
        'test-custom-cofx-with-value',
        ({ draftState, customValue }) => {
          expect(customValue).toBe('processed-test-input');

          (draftState as any).messages.push(customValue);
        },
        { coeffects: [['custom-with-value', 'test-input']] },
      );

      dispatch(['test-custom-cofx-with-value']);
      await waitForScheduled();

      const state = getState();
      expect(state.messages).toContain('processed-test-input');
    });
  });

  describe('Global Interceptors', () => {
    beforeEach(() => {
      clearInterceptors();
    });

    afterEach(() => {
      clearInterceptors();
    });

    it('should inject global interceptors into event processing', async () => {
      let globalInterceptorCalled = false;

      const globalInterceptor: Interceptor = {
        id: 'test-global',
        before: (context: Context) => {
          globalInterceptorCalled = true;
          context.coeffects.globalData = 'injected-by-global';
          return context;
        },
      };

      registerInterceptor(globalInterceptor);

      regEvent('test-global-injection', ({ draftState, globalData }) => {
        expect(globalData).toBe('injected-by-global');
        (draftState as any).processedByGlobal = true;
      });

      dispatch(['test-global-injection']);
      await waitForScheduled();

      expect(globalInterceptorCalled).toBe(true);
      const state = getState();
      expect(state.processedByGlobal).toBe(true);
    });

    it('should execute multiple global interceptors in order', async () => {
      const executionOrder: string[] = [];

      const globalInterceptor1: Interceptor = {
        id: 'global-1',
        before: (context: Context) => {
          executionOrder.push('global-1-before');
          context.coeffects.order = ['global-1'];
          return context;
        },
        after: (context: Context) => {
          executionOrder.push('global-1-after');
          return context;
        },
      };

      const globalInterceptor2: Interceptor = {
        id: 'global-2',
        before: (context: Context) => {
          executionOrder.push('global-2-before');
          context.coeffects.order.push('global-2');
          return context;
        },
        after: (context: Context) => {
          executionOrder.push('global-2-after');
          return context;
        },
      };

      registerInterceptor(globalInterceptor1);
      registerInterceptor(globalInterceptor2);

      regEvent('test-multiple-globals', ({ draftState, order }) => {
        executionOrder.push('handler');
        expect(order).toEqual(['global-1', 'global-2']);
        (draftState as any).executionOrder = [...executionOrder];
      });

      dispatch(['test-multiple-globals']);
      await waitForScheduled();

      // The after hooks unwind in reverse interceptor order.
      expect(executionOrder).toEqual([
        'global-1-before',
        'global-2-before',
        'handler',
        'global-2-after',
        'global-1-after',
      ]);
    });

    it('should execute global interceptors before custom event interceptors', async () => {
      const executionOrder: string[] = [];

      const globalInterceptor: Interceptor = {
        id: 'global-first',
        before: (context: Context) => {
          executionOrder.push('global-before');
          return context;
        },
        after: (context: Context) => {
          executionOrder.push('global-after');
          return context;
        },
      };

      const customInterceptor: Interceptor = {
        id: 'custom-second',
        before: (context: Context) => {
          executionOrder.push('custom-before');
          return context;
        },
        after: (context: Context) => {
          executionOrder.push('custom-after');
          return context;
        },
      };

      registerInterceptor(globalInterceptor);

      regEvent(
        'test-execution-order',
        ({ draftState }) => {
          executionOrder.push('handler');
          (draftState as any).counter += 1;
        },
        { interceptors: [customInterceptor] },
      );

      dispatch(['test-execution-order']);
      await waitForScheduled();

      // Event interceptors nest inside the global interceptor chain.
      expect(executionOrder).toEqual([
        'global-before',
        'custom-before',
        'handler',
        'custom-after',
        'global-after',
      ]);
    });

    it('should allow global interceptors to modify effects', async () => {
      const globalInterceptor: Interceptor = {
        id: 'global-fx-modifier',
        after: (context: Context) => {
          context.effects.push(['dispatch', ['secondary-event']]);
          return context;
        },
      };

      let secondaryEventCalled = false;
      regEvent('secondary-event', ({ draftState }) => {
        secondaryEventCalled = true;
        (draftState as any).secondaryProcessed = true;
      });

      registerInterceptor(globalInterceptor);

      regEvent('test-fx-modification', ({ draftState }) => {
        (draftState as any).primaryProcessed = true;
        return [['dispatch', ['primary-effect']]];
      });

      regEvent('primary-effect', ({ draftState }) => {
        (draftState as any).primaryEffectProcessed = true;
      });

      dispatch(['test-fx-modification']);
      await waitForScheduled();
      // Both dispatch effects enqueue another event cycle.
      await waitForScheduled();

      const state = getState();
      expect(state.primaryProcessed).toBe(true);
      expect(state.primaryEffectProcessed).toBe(true);
      expect(state.secondaryProcessed).toBe(true);
      expect(secondaryEventCalled).toBe(true);
    });

    it('should expose the final state to global after hooks and commit before appended effects', async () => {
      let committedCounter: number | undefined;

      regEffect('observe-committed-counter', () => {
        committedCounter = getState().counter;
      });
      registerInterceptor({
        id: 'append-post-commit-effect',
        after: (context: Context) => {
          expect(context.previousState.counter).toBe(0);
          expect(context.newState?.counter).toBe(1);
          context.effects.push(['observe-committed-counter']);
          return context;
        },
      });
      regEvent('test-post-commit-effect', ({ draftState }) => {
        (draftState as any).counter += 1;
      });

      dispatch(['test-post-commit-effect']);
      await waitForScheduled();

      expect(committedCounter).toBe(1);
    });

    it('should work with cofx and global interceptors together', async () => {
      const globalInterceptor: Interceptor = {
        id: 'global-with-cofx',
        before: (context: Context) => {
          context.coeffects.globalValue = 'from-global';
          return context;
        },
      };

      registerInterceptor(globalInterceptor);

      regEvent(
        'test-global-with-cofx',
        ({ draftState, now, globalValue }) => {
          expect(now).toBeDefined();
          expect(globalValue).toBe('from-global');

          (draftState as any).timestamp = now;
          (draftState as any).globalValue = globalValue;
          (draftState as any).counter += 1;
        },
        { coeffects: [['now']] },
      );

      dispatch(['test-global-with-cofx']);
      await waitForScheduled();

      const state = getState();
      expect(state.timestamp).toBeGreaterThan(0);
      expect(state.globalValue).toBe('from-global');
      expect(state.counter).toBe(1);
    });

    it('should not execute cleared global interceptors', async () => {
      let globalInterceptorCalled = false;

      const globalInterceptor: Interceptor = {
        id: 'to-be-cleared',
        before: (context: Context) => {
          globalInterceptorCalled = true;
          return context;
        },
      };

      registerInterceptor(globalInterceptor);
      clearInterceptors();

      regEvent('test-cleared-global', ({ draftState }) => {
        (draftState as any).counter += 1;
      });

      dispatch(['test-cleared-global']);
      await waitForScheduled();

      expect(globalInterceptorCalled).toBe(false);
      const state = getState();
      expect(state.counter).toBe(1);
    });

    it('should clear specific global interceptor by ID', async () => {
      let interceptor1Called = false;
      let interceptor2Called = false;

      const globalInterceptor1: Interceptor = {
        id: 'keep-this-one',
        before: (context: Context) => {
          interceptor1Called = true;
          context.coeffects.from1 = 'interceptor1';
          return context;
        },
      };

      const globalInterceptor2: Interceptor = {
        id: 'clear-this-one',
        before: (context: Context) => {
          interceptor2Called = true;
          context.coeffects.from2 = 'interceptor2';
          return context;
        },
      };

      registerInterceptor(globalInterceptor1);
      registerInterceptor(globalInterceptor2);
      clearInterceptors('clear-this-one');

      regEvent('test-selective-clear', ({ draftState, from1, from2 }) => {
        expect(from1).toBe('interceptor1');
        expect(from2).toBeUndefined();
        (draftState as any).counter += 1;
      });

      dispatch(['test-selective-clear']);
      await waitForScheduled();

      expect(interceptor1Called).toBe(true);
      expect(interceptor2Called).toBe(false);
      const state = getState();
      expect(state.counter).toBe(1);
    });

    it('should handle errors in global interceptors gracefully', async () => {
      const errorHandler = jest.fn();
      registerHandler('error', 'event-handler', errorHandler);

      const faultyGlobalInterceptor: Interceptor = {
        id: 'faulty-global',
        before: () => {
          throw new Error('Global interceptor error');
        },
      };

      registerInterceptor(faultyGlobalInterceptor);

      regEvent('test-global-error', ({ draftState }) => {
        (draftState as any).counter += 1;
      });

      dispatch(['test-global-error']);
      await waitForScheduled();

      expect(errorHandler).toHaveBeenCalled();
      const [originalError, reflexError] = errorHandler.mock.calls[0];
      expect(originalError.message).toBe('Global interceptor error');
      expect(reflexError.data.interceptor).toBe('faulty-global');
    });
  });
});
