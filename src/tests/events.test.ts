import { regEvent } from '../events';
import { regCoeffect } from '../cofx';
import { dispatch, dispatchSync } from '../router';
import { initAppDb, getAppDb } from '../db';
import { registerHandler } from '../registrar';
import { regGlobalInterceptor, clearGlobalInterceptors } from '../settings';
import type { CoEffects, EventRegistrationOptions, Interceptor, Context } from '../types';
import { waitForScheduled } from './test-utils';

// Type definitions for testing type-safe event handlers
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
  // Register a default error handler to suppress console errors in tests
  beforeAll(() => {
    registerHandler('error', 'event-handler', () => undefined);
  });

  describe('Initialize db', () => {
    it('should handle db initialized', () => {
      initAppDb({ counter: 0, items: [] });
      expect(getAppDb()).toEqual(expect.objectContaining({ counter: 0, items: [] }));
    });
  });

  describe('Event dispatch async and handling', () => {
    it('should handle async event dispatch with queue management', async () => {
      const initialDb = getAppDb();
      expect(initialDb.counter).toBe(0);

      // Register an event that increments the counter
      regEvent('incrementCounter', ({ draftDb }) => {
        draftDb.counter += 1;
      });

      // Dispatch the increment event asynchronously
      dispatch(['incrementCounter']);

      // The database should still have the old value
      expect(getAppDb().counter).toBe(0);

      // Wait for the async event to be processed
      await waitForScheduled();

      // Now the database should be updated
      expect(getAppDb().counter).toBe(1);
    });
  });

  describe('Event dispatch async and handling with Immer', () => {
    it('should handle async event dispatch with Immer dbUpdate effect', async () => {
      const initialDb = getAppDb();
      const initialCounter = initialDb.counter;

      // Store reference to original db object to verify immutability
      const originalDbReference = initialDb;

      // Register an event that uses Immer dbUpdate effect
      regEvent('incrementCounterImmer', ({ draftDb }) => {
        draftDb.counter += 1;
        draftDb.lastUpdated = Date.now();
      });

      // Dispatch the increment event asynchronously
      dispatch(['incrementCounterImmer']);

      // The database should still have the old value immediately
      expect(getAppDb().counter).toBe(initialCounter);

      // Wait for the async event to be processed
      await waitForScheduled();

      const updatedDb = getAppDb();

      // Now the database should be updated
      expect(updatedDb.counter).toBe(initialCounter + 1);
      expect(updatedDb.lastUpdated).toBeDefined();

      // Verify immutability - original db object should be unchanged
      expect(originalDbReference.counter).toBe(initialCounter);
      expect(originalDbReference.lastUpdated).toBeUndefined();

      // Verify we have a new db object reference
      expect(updatedDb).not.toBe(originalDbReference);
    });

    it('should handle async event dispatch with complex Immer mutations', async () => {
      const initialDb = getAppDb();

      // Register an event that performs complex mutations
      regEvent('complexImmerUpdate', ({ draftDb }) => {
        // Increment counter
        draftDb.counter += 5;

        // Add multiple items to arrays
        if (!draftDb.todos) draftDb.todos = [];
        draftDb.todos.push({ id: 1, text: 'Async todo 1', completed: false });
        draftDb.todos.push({ id: 2, text: 'Async todo 2', completed: true });

        // Update nested objects
        if (!draftDb.user) draftDb.user = {};
        draftDb.user.lastAction = 'complex-update';
        draftDb.user.actionCount = (draftDb.user.actionCount || 0) + 1;
      });

      // Dispatch the complex event asynchronously
      dispatch(['complexImmerUpdate']);

      // Initial state should be unchanged
      expect(getAppDb().counter).toBe(initialDb.counter);

      // Wait for async processing
      await waitForScheduled();

      const updatedDb = getAppDb();

      // Verify all mutations were applied
      expect(updatedDb.counter).toBe(initialDb.counter + 5);
      expect(updatedDb.todos).toHaveLength(2);
      expect(updatedDb.todos[0]).toEqual({ id: 1, text: 'Async todo 1', completed: false });
      expect(updatedDb.todos[1]).toEqual({ id: 2, text: 'Async todo 2', completed: true });
      expect(updatedDb.user.lastAction).toBe('complex-update');
      expect(updatedDb.user.actionCount).toBe(1);

      // Verify immutability
      expect(updatedDb).not.toBe(initialDb);
    });

    it('should allow effects through fx properly', async () => {
      // Register a test event handler to capture dispatched events
      const capturedEvents: string[] = [];
      regEvent('captureTestEvent', () => {
        capturedEvents.push('captured');
      });

      // Register an event that uses effects for other effects
      regEvent('effectsTest', ({ draftDb }) => {
        draftDb.fxTestValue = 'updated-via-fx';
        return [['dispatch', ['captureTestEvent']]];
      });

      // Dispatch the event
      dispatch(['effectsTest']);

      // Wait for async processing with longer timeout and multiple checks
      await new Promise<void>((resolve) => {
        let resolved = false;
        const timeouts: ReturnType<typeof setTimeout>[] = [];

        const checkForCompletion = () => {
          if (resolved) return;
          if (capturedEvents.length > 0 && getAppDb().fxTestValue === 'updated-via-fx') {
            resolved = true;
            timeouts.forEach(clearTimeout);
            resolve();
          } else {
            timeouts.push(setTimeout(checkForCompletion, 10));
          }
        };

        // Start checking immediately
        timeouts.push(setTimeout(checkForCompletion, 0));
        // But also set a timeout to avoid infinite waiting
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

      const updatedDb = getAppDb();

      // Verify dbUpdate worked
      expect(updatedDb.fxTestValue).toBe('updated-via-fx');

      // Verify effects dispatch worked
      expect(capturedEvents).toContain('captured');
    });
  });

  /*describe('Error handling', () => {
    it('should throw error for empty event id', () => {
      expect(() => {
        regEvent('', () => ({}));
      }).toThrow('reflex: regEvent requires a non-empty event id');
    });

    it('should throw error for non-function handler', () => {
      expect(() => {
        regEvent('bad-event', 'not a function' as any);
      }).toThrow('reflex: regEvent requires a handler function');
    });

    it('should throw error for non-function handler with interceptors', () => {
      expect(() => {
        regEvent('bad-event', [], 'not a function' as any);
      }).toThrow('reflex: regEvent requires a handler function');
    });
  });*/

  /*describe('Event dispatch and handling', () => {

    it('should handle events with custom interceptors', () => {
      let beforeCalled = false;
      let afterCalled = false;

      const beforeInterceptor = {
        id: 'before-test',
        before: (ctx: any) => {
          beforeCalled = true;
          return ctx;
        }
      };

      const afterInterceptor = {
        id: 'after-test',
        after: (ctx: any) => {
          afterCalled = true;
          return ctx;
        }
      };

      const handler = (coeffects: any, event: any) => {
        return { db: { ...coeffects.db, handled: true } };
      };

      regEvent('test-interceptors', [beforeInterceptor, afterInterceptor], handler);
      dispatchSync(['test-interceptors']);

      expect(beforeCalled).toBe(true);
      expect(afterCalled).toBe(true);
      expect(appDb).toEqual(expect.objectContaining({ handled: true }));
    });
  });*/
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
    initAppDb<EventTestState>(initialState);
  });

  describe('Type-safe event registration and handling', () => {
    it('should handle type-safe counter increment', async () => {
      // Register a type-safe event handler
      regEvent<EventTestState>('increment-counter', ({ draftDb }) => {
        // draftDb is now typed as EventTestState
        const currentCounter = draftDb.counter;
        expect(typeof currentCounter).toBe('number');
        draftDb.counter += 1;
      });

      // Dispatch the event
      dispatch(['increment-counter']);

      // Wait for async processing
      await waitForScheduled();

      const db = getAppDb<EventTestState>();
      expect(db.counter).toBe(1);
    });

    it('should handle type-safe array operations', async () => {
      regEvent<EventTestState>('add-message', ({ draftDb }, ...params) => {
        const [message] = params as [string];
        draftDb.messages.push(message);
      });

      dispatch(['add-message', 'Hello World']);
      await waitForScheduled();

      const db = getAppDb<EventTestState>();
      expect(db.messages).toContain('Hello World');
      expect(db.messages).toHaveLength(1);
    });

    it('should handle type-safe nested object updates', async () => {
      regEvent<EventTestState>('update-user', ({ draftDb }, ...params) => {
        const [name, isActive] = params as [string, boolean];
        draftDb.user.name = name;
        draftDb.user.isActive = isActive;
      });

      dispatch(['update-user', 'John Doe', false]);
      await waitForScheduled();

      const db = getAppDb<EventTestState>();
      expect(db.user.name).toBe('John Doe');
      expect(db.user.isActive).toBe(false);
      expect(db.user.id).toBe(1); // unchanged
    });

    it('should handle type-safe union type fields', async () => {
      regEvent<EventTestState>('toggle-theme', ({ draftDb }) => {
        draftDb.settings.theme = draftDb.settings.theme === 'light' ? 'dark' : 'light';
      });

      // Toggle from light to dark
      dispatch(['toggle-theme']);
      await waitForScheduled();

      let db = getAppDb<EventTestState>();
      expect(db.settings.theme).toBe('dark');

      // Toggle back to light
      dispatch(['toggle-theme']);
      await waitForScheduled();

      db = getAppDb<EventTestState>();
      expect(db.settings.theme).toBe('light');
    });

    it('should handle complex type-safe updates', async () => {
      regEvent<EventTestState>('complex-update', ({ draftDb }, ...params) => {
        const [userId, userName, messages] = params as [number, string, string[]];
        draftDb.user.id = userId;
        draftDb.user.name = userName;
        draftDb.messages = [...draftDb.messages, ...messages];
        draftDb.counter += messages.length;
        draftDb.settings.notifications = !draftDb.settings.notifications;
      });

      dispatch(['complex-update', 42, 'Complex User', ['msg1', 'msg2', 'msg3']]);
      await waitForScheduled();

      const db = getAppDb<EventTestState>();
      expect(db.user.id).toBe(42);
      expect(db.user.name).toBe('Complex User');
      expect(db.messages).toEqual(['msg1', 'msg2', 'msg3']);
      expect(db.counter).toBe(3);
      expect(db.settings.notifications).toBe(false);
    });

    it('should maintain type safety with multiple event handlers', async () => {
      regEvent<EventTestState>('multi-test-1', ({ draftDb }) => {
        draftDb.counter += 10;
      });

      regEvent<EventTestState>('multi-test-2', ({ draftDb }) => {
        draftDb.messages.push('From handler 2');
      });

      regEvent<EventTestState>('multi-test-3', ({ draftDb }) => {
        draftDb.user.isActive = !draftDb.user.isActive;
      });

      // Dispatch all events
      dispatch(['multi-test-1']);
      dispatch(['multi-test-2']);
      dispatch(['multi-test-3']);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      const db = getAppDb<EventTestState>();
      expect(db.counter).toBe(10);
      expect(db.messages).toContain('From handler 2');
      expect(db.user.isActive).toBe(false); // was true initially
    });
  });

  describe('Type-safe event handling with fx effects', () => {
    it('should handle type-safe events with fx effects', async () => {
      let fxExecuted = false;

      // Register a helper event to track fx execution
      regEvent<EventTestState>('fx-helper', ({ draftDb }) => {
        fxExecuted = true;
        draftDb.messages.push('FX executed');
      });

      // Register main event with effects
      regEvent<EventTestState>('main-with-effects', ({ draftDb }) => {
        draftDb.counter += 5;
        return [['dispatch', ['fx-helper']]];
      });

      dispatch(['main-with-effects']);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 20));

      const db = getAppDb<EventTestState>();
      expect(db.counter).toBe(5);
      expect(db.messages).toContain('FX executed');
      expect(fxExecuted).toBe(true);
    });
  });

  describe('Type-safe backward compatibility', () => {
    it('should allow mixing typed and untyped event handlers', async () => {
      // Typed handler
      regEvent<EventTestState>('typed-handler', ({ draftDb }) => {
        draftDb.counter += 1;
      });

      // Untyped handler (for backward compatibility)
      regEvent('untyped-handler', ({ draftDb }) => {
        (draftDb as any).counter += 10;
        (draftDb as any).untypedField = 'added';
      });

      dispatch(['typed-handler']);
      dispatch(['untyped-handler']);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const db = getAppDb<EventTestState>();
      expect(db.counter).toBe(11);
      expect((db as any).untypedField).toBe('added');
    });
  });
});

describe('regEvent with cofx', () => {
  beforeEach(() => {
    initAppDb({ counter: 0, messages: [], timestamp: 0, randomValue: 0 });
  });

  describe('Basic cofx functionality', () => {
    it('should inject built-in cofx like now', async () => {
      regEvent(
        'test-now-cofx',
        ({ draftDb, now }) => {
          expect(now).toBeDefined();
          expect(typeof now).toBe('number');
          expect(now).toBeGreaterThan(0);

          (draftDb as any).timestamp = now;
        },
        [['now']],
      );

      dispatch(['test-now-cofx']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.timestamp).toBeGreaterThan(0);
    });

    it('should inject built-in cofx like random', async () => {
      regEvent(
        'test-random-cofx',
        ({ draftDb, random }) => {
          expect(random).toBeDefined();
          expect(typeof random).toBe('number');
          expect(random).toBeGreaterThanOrEqual(0);
          expect(random).toBeLessThan(1);

          (draftDb as any).randomValue = random;
        },
        [['random']],
      );

      dispatch(['test-random-cofx']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.randomValue).toBeGreaterThanOrEqual(0);
      expect(db.randomValue).toBeLessThan(1);
    });

    it('should inject db cofx', async () => {
      const initialDb = getAppDb();

      regEvent('test-db-cofx', ({ draftDb }) => {
        expect(draftDb).toBeDefined();
        expect(draftDb).toEqual(initialDb);

        (draftDb as any).counter = draftDb.counter + 5;
      });

      dispatch(['test-db-cofx']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.counter).toBe(5);
    });
  });

  describe('Multiple cofx', () => {
    it('should inject multiple cofx in a single registration', async () => {
      regEvent(
        'test-multiple-cofx',
        ({ draftDb, now, random }) => {
          expect(now).toBeDefined();
          expect(random).toBeDefined();
          expect(draftDb).toBeDefined();

          (draftDb as any).timestamp = now;
          (draftDb as any).randomValue = random;
          (draftDb as any).counter = draftDb.counter + 1;
        },
        [['now'], ['random']],
      );

      dispatch(['test-multiple-cofx']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.timestamp).toBeGreaterThan(0);
      expect(db.randomValue).toBeGreaterThanOrEqual(0);
      expect(db.counter).toBe(1);
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
        ({ draftDb, now }) => {
          executionOrder.push('handler');
          draftDb.timestamp = now;
        },
        options,
      );

      dispatch(['test-registration-options']);
      await waitForScheduled();

      expect(getAppDb().timestamp).toBeGreaterThan(0);
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
        ({ draftDb, now }) => {
          expect(now).toBeDefined();
          expect(draftDb).toBeDefined();

          (draftDb as any).timestamp = now;
          (draftDb as any).counter = draftDb.counter + 10;
        },
        [['now']],
        [beforeInterceptor, afterInterceptor],
      );

      dispatch(['test-cofx-with-interceptors']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.timestamp).toBeGreaterThan(0);
      expect(db.counter).toBe(10);
      expect(beforeCalled).toBe(true);
      expect(afterCalled).toBe(true);
    });
  });

  describe('Backward compatibility', () => {
    it('should honor fourth-argument interceptors after an empty cofx array', () => {
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
        ({ draftDb }) => {
          draftDb.counter += 1;
        },
        [],
        [testInterceptor],
      );

      dispatchSync(['test-empty-cofx-with-interceptors']);

      expect(getAppDb().counter).toBe(1);
      expect(interceptorCall).toHaveBeenCalledTimes(1);
    });

    it('should replace and clear event interceptors when re-registering an id', () => {
      const staleCall = jest.fn();
      const replacementCall = jest.fn();
      const handler = ({ draftDb }: CoEffects) => {
        draftDb.counter += 1;
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
      expect(getAppDb().counter).toBe(2);
    });

    it('should maintain backward compatibility with interceptor-only registration', async () => {
      let interceptorCalled = false;

      const testInterceptor = {
        id: 'backward-compat-test',
        before: (ctx: any) => {
          interceptorCalled = true;
          return ctx;
        },
      };

      // Old way - interceptors only (should still work)
      regEvent(
        'test-backward-compat',
        ({ draftDb }) => {
          (draftDb as any).counter += 1;
        },
        [testInterceptor],
      );

      dispatch(['test-backward-compat']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.counter).toBe(1);
      expect(interceptorCalled).toBe(true);
    });

    it('should maintain backward compatibility with handler-only registration', async () => {
      // Old way - handler only (should still work)
      regEvent('test-handler-only', ({ draftDb }) => {
        (draftDb as any).counter += 2;
      });

      dispatch(['test-handler-only']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.counter).toBe(2);
    });
  });

  describe('Error handling', () => {
    it('should warn about invalid cofx specifications', async () => {
      // Invalid cofx with too many elements
      regEvent(
        'test-invalid-cofx',
        ({ draftDb }) => {
          (draftDb as any).counter += 1;
        },
        [['now', 'extra', 'invalid']],
      );

      dispatch(['test-invalid-cofx']);
      await waitForScheduled();

      // Verify warning was logged
      expectLogCall('warn', '[reflex] invalid cofx specification:', ['now', 'extra', 'invalid']);
    });
  });

  describe('Custom cofx', () => {
    it('should work with custom registered cofx', async () => {
      // First register a custom cofx
      regCoeffect('custom-test', (coeffects: any, value: any) => ({
        ...coeffects,
        customValue: value || 'default-custom-value',
      }));

      regEvent(
        'test-custom-cofx',
        ({ draftDb, customValue }) => {
          expect(customValue).toBe('default-custom-value');

          (draftDb as any).messages.push(customValue);
        },
        [['custom-test']],
      );

      dispatch(['test-custom-cofx']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.messages).toContain('default-custom-value');
    });

    it('should work with custom cofx with values', async () => {
      const cofxModule = await import('../cofx');
      cofxModule.regCoeffect('custom-with-value', (coeffects: any, value: any) => ({
        ...coeffects,
        customValue: `processed-${value}`,
      }));

      regEvent(
        'test-custom-cofx-with-value',
        ({ draftDb, customValue }) => {
          expect(customValue).toBe('processed-test-input');

          (draftDb as any).messages.push(customValue);
        },
        [['custom-with-value', 'test-input']],
      );

      dispatch(['test-custom-cofx-with-value']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.messages).toContain('processed-test-input');
    });
  });

  describe('Global Interceptors', () => {
    beforeEach(() => {
      clearGlobalInterceptors();
    });

    afterEach(() => {
      clearGlobalInterceptors();
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

      regGlobalInterceptor(globalInterceptor);

      regEvent('test-global-injection', ({ draftDb, globalData }) => {
        expect(globalData).toBe('injected-by-global');
        (draftDb as any).processedByGlobal = true;
      });

      dispatch(['test-global-injection']);
      await waitForScheduled();

      expect(globalInterceptorCalled).toBe(true);
      const db = getAppDb();
      expect(db.processedByGlobal).toBe(true);
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

      regGlobalInterceptor(globalInterceptor1);
      regGlobalInterceptor(globalInterceptor2);

      regEvent('test-multiple-globals', ({ draftDb, order }) => {
        executionOrder.push('handler');
        expect(order).toEqual(['global-1', 'global-2']);
        (draftDb as any).executionOrder = [...executionOrder];
      });

      dispatch(['test-multiple-globals']);
      await waitForScheduled();

      // Expected order: global-1-before, global-2-before, handler, global-2-after, global-1-after
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

      regGlobalInterceptor(globalInterceptor);

      regEvent(
        'test-execution-order',
        ({ draftDb }) => {
          executionOrder.push('handler');
          (draftDb as any).counter += 1;
        },
        [customInterceptor],
      );

      dispatch(['test-execution-order']);
      await waitForScheduled();

      // Global interceptors should execute before custom ones
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
          // Add an additional effect
          context.effects.push(['dispatch', ['secondary-event']]);
          return context;
        },
      };

      let secondaryEventCalled = false;
      regEvent('secondary-event', ({ draftDb }) => {
        secondaryEventCalled = true;
        (draftDb as any).secondaryProcessed = true;
      });

      regGlobalInterceptor(globalInterceptor);

      regEvent('test-fx-modification', ({ draftDb }) => {
        (draftDb as any).primaryProcessed = true;
        return [['dispatch', ['primary-effect']]];
      });

      regEvent('primary-effect', ({ draftDb }) => {
        (draftDb as any).primaryEffectProcessed = true;
      });

      dispatch(['test-fx-modification']);
      await waitForScheduled();
      // Wait for the dispatched effects to complete
      await waitForScheduled();

      const db = getAppDb();
      expect(db.primaryProcessed).toBe(true);
      expect(db.primaryEffectProcessed).toBe(true);
      expect(db.secondaryProcessed).toBe(true);
      expect(secondaryEventCalled).toBe(true);
    });

    it('should work with cofx and global interceptors together', async () => {
      const globalInterceptor: Interceptor = {
        id: 'global-with-cofx',
        before: (context: Context) => {
          context.coeffects.globalValue = 'from-global';
          return context;
        },
      };

      regGlobalInterceptor(globalInterceptor);

      regEvent(
        'test-global-with-cofx',
        ({ draftDb, now, globalValue }) => {
          expect(now).toBeDefined();
          expect(globalValue).toBe('from-global');

          (draftDb as any).timestamp = now;
          (draftDb as any).globalValue = globalValue;
          (draftDb as any).counter += 1;
        },
        [['now']],
      );

      dispatch(['test-global-with-cofx']);
      await waitForScheduled();

      const db = getAppDb();
      expect(db.timestamp).toBeGreaterThan(0);
      expect(db.globalValue).toBe('from-global');
      expect(db.counter).toBe(1);
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

      regGlobalInterceptor(globalInterceptor);
      clearGlobalInterceptors();

      regEvent('test-cleared-global', ({ draftDb }) => {
        (draftDb as any).counter += 1;
      });

      dispatch(['test-cleared-global']);
      await waitForScheduled();

      expect(globalInterceptorCalled).toBe(false);
      const db = getAppDb();
      expect(db.counter).toBe(1);
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

      regGlobalInterceptor(globalInterceptor1);
      regGlobalInterceptor(globalInterceptor2);
      clearGlobalInterceptors('clear-this-one');

      regEvent('test-selective-clear', ({ draftDb, from1, from2 }) => {
        expect(from1).toBe('interceptor1');
        expect(from2).toBeUndefined();
        (draftDb as any).counter += 1;
      });

      dispatch(['test-selective-clear']);
      await waitForScheduled();

      expect(interceptor1Called).toBe(true);
      expect(interceptor2Called).toBe(false);
      const db = getAppDb();
      expect(db.counter).toBe(1);
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

      regGlobalInterceptor(faultyGlobalInterceptor);

      regEvent('test-global-error', ({ draftDb }) => {
        (draftDb as any).counter += 1;
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
