import {
  clearInterceptors,
  dispatch,
  dispatchSync,
  getState,
  handlerRegistry,
  initState,
  regCoeffect,
  regEvent,
} from './runtime-test-api';
import type { EventContext } from '../../src/types';
import { consoleLog } from '../../src/core/logging';
import { waitForScheduled } from './test-utils';

describe('regCofx - Co-Effects', () => {
  beforeEach(() => {
    initState({ counter: 0, messages: [] });
    clearInterceptors();
    handlerRegistry.cofx.clear('now');
    handlerRegistry.cofx.clear('random');
    regCoeffect('now', () => Date.now());
    regCoeffect('random', () => Math.random());
  });

  describe('Application Co-Effects', () => {
    it('should inject state co-effect', async () => {
      let capturedContext: EventContext<any> | null = null;

      regEvent('test-state-cofx', (context: EventContext<any>) => {
        capturedContext = context;
      });

      dispatch(['test-state-cofx']);

      await waitForScheduled();

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.event).toEqual(['test-state-cofx']);
    });

    it('should inject an application-defined now co-effect', async () => {
      let capturedContext: EventContext<any> | null = null;
      const startTime = Date.now();

      regEvent(
        'test-now-cofx',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { now: 'now' } },
      );

      dispatch(['test-now-cofx']);

      await waitForScheduled();

      const endTime = Date.now();

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.coeffects.now).toBeGreaterThanOrEqual(startTime);
      expect(capturedContext!.coeffects.now).toBeLessThanOrEqual(endTime);
      expect(typeof capturedContext!.coeffects.now).toBe('number');
    });

    it('should inject an application-defined random co-effect', async () => {
      let capturedContext: EventContext<any> | null = null;

      regEvent(
        'test-random-cofx',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { random: 'random' } },
      );

      dispatch(['test-random-cofx']);

      await waitForScheduled();

      expect(capturedContext).not.toBeNull();
      expect(typeof capturedContext!.coeffects.random).toBe('number');
      expect(capturedContext!.coeffects.random).toBeGreaterThanOrEqual(0);
      expect(capturedContext!.coeffects.random).toBeLessThan(1);
    });

    it('should inject multiple application-defined co-effects', async () => {
      let capturedContext: EventContext<any> | null = null;

      regEvent(
        'test-multiple-cofx',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { now: 'now', random: 'random' } },
      );

      dispatch(['test-multiple-cofx']);

      await waitForScheduled();

      expect(capturedContext).not.toBeNull();
      expect(typeof capturedContext!.coeffects.now).toBe('number');
      expect(typeof capturedContext!.coeffects.random).toBe('number');
      expect(capturedContext!.event).toEqual(['test-multiple-cofx']);
    });
  });

  describe('Named Coeffect Bindings', () => {
    it('binds a slash-namespaced provider to an event-local property', async () => {
      let capturedContext: EventContext<any> | null = null;
      regCoeffect('system/now', () => 12345);

      regEvent(
        'test-named-cofx',
        (context) => {
          capturedContext = context;
          const {
            draftState,
            coeffects: { now },
          } = context;
          draftState.counter = now;
        },
        { coeffects: { now: 'system/now' } },
      );

      dispatch(['test-named-cofx']);
      await waitForScheduled();

      expect(capturedContext!.coeffects.now).toBe(12345);
      // Provider ids stay inside the pipeline; event code sees only its local
      // binding. Ordered coeffects and infrastructure interceptors still read
      // provider ids before this final handler projection.
      expect('system/now' in capturedContext!.coeffects).toBe(false);
      expect(getState().counter).toBe(12345);
    });

    it('passes binding arguments and preserves ordered provider dependencies', async () => {
      let capturedContext: EventContext<any> | null = null;
      regCoeffect('storage/value', (key: string) => `stored:${key}`);
      regCoeffect('request/summary', (_arg, coeffects) => {
        return `summary:${String(coeffects['storage/value'])}`;
      });

      regEvent(
        'test-named-cofx-arguments',
        (context) => {
          capturedContext = context;
          const {
            draftState,
            coeffects: { stored, summary },
          } = context;
          draftState.messages.push(`${stored}/${summary}`);
        },
        {
          coeffects: {
            stored: ['storage/value', 'todos'],
            summary: 'request/summary',
          },
        },
      );

      dispatch(['test-named-cofx-arguments']);
      await waitForScheduled();

      expect(capturedContext!.coeffects.stored).toBe('stored:todos');
      expect(capturedContext!.coeffects.summary).toBe('summary:stored:todos');
      expect(getState().messages).toEqual(['stored:todos/summary:stored:todos']);
    });

    it('keeps bindings correct when a local slot matches another provider id', async () => {
      let capturedContext: EventContext<any> | null = null;
      regCoeffect('request/source', () => 'source');
      regCoeffect('request/other', () => 'other');

      regEvent(
        'test-named-cofx-overlap',
        (context) => {
          capturedContext = context;
        },
        {
          coeffects: {
            'request/source': 'request/other',
            source: 'request/source',
          },
        },
      );

      dispatch(['test-named-cofx-overlap']);
      await waitForScheduled();

      expect(capturedContext!.coeffects['request/source']).toBe('other');
      expect(capturedContext!.coeffects.source).toBe('source');
      expect('request/other' in capturedContext!.coeffects).toBe(false);
    });
  });

  describe('Custom Co-Effects Registration', () => {
    it('should register and inject custom co-effect', async () => {
      let capturedContext: EventContext<any> | null = null;

      regCoeffect('user-info', () => ({
        id: 123,
        name: 'Test User',
        role: 'admin',
      }));

      regEvent(
        'test-custom-cofx',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { 'user-info': 'user-info' } },
      );

      dispatch(['test-custom-cofx']);

      await waitForScheduled();

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.coeffects['user-info']).toEqual({
        id: 123,
        name: 'Test User',
        role: 'admin',
      });
    });

    it('should register co-effect with parameter', async () => {
      let capturedContext: EventContext<any> | null = null;

      regCoeffect('api-token', (apiEndpoint: string) => `token-for-${apiEndpoint}`);

      regEvent(
        'test-param-cofx',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { 'api-token': ['api-token', 'users'] } },
      );

      dispatch(['test-param-cofx']);

      await waitForScheduled();

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.coeffects['api-token']).toBe('token-for-users');
    });

    it('should handle complex custom co-effects', async () => {
      let capturedContext: EventContext<any> | null = null;

      regCoeffect('enhanced-data', (config: { includeTimestamp: boolean; prefix: string }) => {
        const baseData = {
          enhancedBy: 'cofx-handler',
        };

        return config.includeTimestamp
          ? { ...baseData, timestamp: Date.now(), prefix: config.prefix }
          : { ...baseData, prefix: config.prefix };
      });

      regEvent(
        'test-complex-cofx',
        (context) => {
          capturedContext = context;
        },
        {
          coeffects: {
            'enhanced-data': ['enhanced-data', { includeTimestamp: true, prefix: 'test' }],
          },
        },
      );

      dispatch(['test-complex-cofx']);

      await waitForScheduled();

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.coeffects['enhanced-data']).toMatchObject({
        enhancedBy: 'cofx-handler',
        prefix: 'test',
      });
      expect(capturedContext!.coeffects['enhanced-data'].timestamp).toBeGreaterThan(0);
    });
  });

  describe('Co-Effects Integration with Event Handlers', () => {
    it('should use co-effects in event handler logic', async () => {
      regCoeffect('app-config', () => ({
        maxCounter: 100,
        defaultMessage: 'Hello World',
      }));

      regEvent(
        'test-cofx-logic',
        ({ draftState, coeffects: { 'app-config': config } }) => {
          const newCounter = Math.min(draftState.counter + 10, config.maxCounter);

          draftState.counter = newCounter;
          draftState.messages.push(config.defaultMessage);
        },
        { coeffects: { 'app-config': 'app-config' } },
      );

      dispatch(['test-cofx-logic']);

      await waitForScheduled();

      const updatedState = getState();
      expect(updatedState.counter).toBe(10);
      expect(updatedState.messages).toEqual(['Hello World']);
    });

    it('should chain multiple co-effects for complex data preparation', async () => {
      let capturedContext: EventContext<any> | null = null;

      regCoeffect('session-info', () => ({ userId: 456, sessionId: 'sess-123' }));

      regCoeffect('permissions', () => ['read', 'write', 'admin']);

      // A coeffect may read what the specs before it injected, through the
      // frozen, state-free view the runtime passes as the second argument.
      regCoeffect('feature-flags', (_arg, coeffects) => {
        const session = coeffects['session-info'] as { userId: number } | undefined;
        return {
          newUI: true,
          betaFeatures: session?.userId === 456,
        };
      });

      regEvent(
        'test-chained-cofx',
        (context) => {
          capturedContext = context;
        },
        {
          coeffects: {
            'session-info': 'session-info',
            permissions: 'permissions',
            'feature-flags': 'feature-flags',
          },
        },
      );

      dispatch(['test-chained-cofx']);

      await waitForScheduled();

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.coeffects['session-info']).toEqual({
        userId: 456,
        sessionId: 'sess-123',
      });
      expect(capturedContext!.coeffects.permissions).toEqual(['read', 'write', 'admin']);
      expect(capturedContext!.coeffects['feature-flags']).toEqual({
        newUI: true,
        betaFeatures: true,
      });
    });
  });

  describe('Error Handling', () => {
    it('should permit an intentionally undefined co-effect value', async () => {
      let capturedContext: EventContext<any> | null = null;

      regCoeffect('failing-cofx', () => {
        consoleLog('error', '[reflex] Co-effect failed');
        return undefined;
      });

      regCoeffect('working-cofx', () => true);

      regEvent(
        'test-error-handling',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { 'working-cofx': 'working-cofx', 'failing-cofx': 'failing-cofx' } },
      );

      dispatch(['test-error-handling']);

      await waitForScheduled();

      expectLogCall('error', '[reflex] Co-effect failed');

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.coeffects['working-cofx']).toBe(true);
      expect('failing-cofx' in capturedContext!.coeffects).toBe(true);
      expect(capturedContext!.coeffects['failing-cofx']).toBeUndefined();
    });

    it('should abort an event when a required co-effect is unregistered', () => {
      let handlerCalled = false;

      regEvent(
        'test-unregistered-cofx',
        ({ draftState }) => {
          handlerCalled = true;
          draftState.counter += 1;
        },
        { coeffects: { 'non-existent-cofx': 'non-existent-cofx' } },
      );

      expect(() => dispatchSync(['test-unregistered-cofx'])).toThrow(
        "[reflex] No coeffect handler registered for 'non-existent-cofx'.",
      );
      expect(handlerCalled).toBe(false);
      expect(getState().counter).toBe(0);
    });

    it('should abort an event when a required co-effect handler throws', () => {
      let handlerCalled = false;
      let afterFailureCalled = false;

      regCoeffect('throwing-cofx', () => {
        throw new Error('cofx exploded');
      });
      regCoeffect('after-throwing-cofx', () => {
        afterFailureCalled = true;
        return true;
      });

      regEvent(
        'test-throwing-cofx',
        ({ draftState }) => {
          handlerCalled = true;
          draftState.counter += 1;
        },
        {
          coeffects: {
            'throwing-cofx': 'throwing-cofx',
            'after-throwing-cofx': 'after-throwing-cofx',
          },
        },
      );

      expect(() => dispatchSync(['test-throwing-cofx'])).toThrow('cofx exploded');
      expect(handlerCalled).toBe(false);
      expect(afterFailureCalled).toBe(false);
      expect(getState().counter).toBe(0);
    });
  });

  describe('Injection Ownership', () => {
    it('should inject the returned value under the co-effect id', async () => {
      let capturedContext: EventContext<any> | null = null;

      regCoeffect('local-storage-value', (key: string) => `stored:${key}`);

      regEvent(
        'test-id-keyed-cofx',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { 'local-storage-value': ['local-storage-value', 'todos'] } },
      );

      dispatch(['test-id-keyed-cofx']);

      await waitForScheduled();

      expect(capturedContext!.coeffects['local-storage-value']).toBe('stored:todos');
    });

    it('should keep event and draftState intact whatever a handler returns', async () => {
      let capturedContext: EventContext<any> | null = null;

      // The old signature let a handler replace the whole coeffects map; the
      // returned value is now confined to the handler's own key.
      regCoeffect('hostile-cofx', () => ({ event: ['hijacked'], draftState: null }));

      // `draftState` is a draft that the runtime revokes once the event
      // settles, so it is asserted while the handler still holds it.
      let draftCounter: unknown;
      regEvent(
        'test-hostile-cofx',
        (context) => {
          capturedContext = context;
          draftCounter = context.draftState.counter;
        },
        { coeffects: { 'hostile-cofx': 'hostile-cofx' } },
      );

      dispatch(['test-hostile-cofx', 'payload']);

      await waitForScheduled();

      expect(capturedContext!.event).toEqual(['test-hostile-cofx', 'payload']);
      expect(draftCounter).toBe(0);
      expect(capturedContext!.coeffects['hostile-cofx']).toEqual({
        event: ['hijacked'],
        draftState: null,
      });
    });

    it('should give a co-effect handler a frozen, state-free view', async () => {
      let capturedContext: EventContext<any> | null = null;

      regCoeffect('event-id', (_arg, coeffects) => {
        expect(Object.isFrozen(coeffects)).toBe(true);
        expect(Object.isFrozen(coeffects.event)).toBe(true);
        expect('draftState' in coeffects).toBe(false);

        const mutableContext = coeffects as unknown as Record<string, unknown>;
        const mutableEvent = coeffects.event as unknown as [string, ...unknown[]];
        expect(() => {
          mutableContext.event = ['hijacked'];
        }).toThrow();
        expect(() => {
          mutableEvent[0] = 'hijacked';
        }).toThrow();

        return coeffects.event[0];
      });

      regEvent(
        'test-event-reading-cofx',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { 'event-id': 'event-id' } },
      );

      dispatch(['test-event-reading-cofx']);

      await waitForScheduled();

      expect(capturedContext!.coeffects['event-id']).toBe('test-event-reading-cofx');
    });

    it('should reject runtime-owned co-effect ids', () => {
      expect(() => regCoeffect('event', () => 1)).toThrow(
        "[reflex] 'event' is a runtime-owned coeffect and cannot be registered with regCoeffect().",
      );
      expect(() => regCoeffect('draftState', () => 1)).toThrow(
        "[reflex] 'draftState' is a runtime-owned coeffect and cannot be registered with regCoeffect().",
      );
      expect(() => regCoeffect('', () => 1)).toThrow(
        '[reflex] regCoeffect expects a non-empty coeffect id string.',
      );
      expect(() => regCoeffect('__proto__', () => 1)).toThrow(
        "[reflex] '__proto__' is not a valid coeffect id.",
      );
    });
  });

  describe('Co-Effects with Event Parameters', () => {
    it('should work with events that have parameters', async () => {
      let capturedContext: EventContext<any> | null = null;
      let capturedParams: any[] | null = null;

      // A coeffect that once wrote several keys now returns one value under
      // its own id, which the handler destructures.
      regCoeffect('request-meta', () => ({
        requestId: 'req-' + Math.random().toString(36).substring(2, 11),
        timestamp: Date.now(),
      }));

      regEvent(
        'test-params-with-cofx',
        (context, ...params) => {
          capturedContext = context;
          capturedParams = params;
          const { requestId, timestamp } = context.coeffects['request-meta'];
          context.draftState.lastRequest = {
            id: requestId,
            params: params,
            timestamp,
          };
        },
        { coeffects: { 'request-meta': 'request-meta' } },
      );

      dispatch(['test-params-with-cofx', 'param1', { key: 'value' }, 123]);

      await waitForScheduled();

      expect(capturedContext).not.toBeNull();
      expect(capturedParams).toEqual(['param1', { key: 'value' }, 123]);
      expect(typeof capturedContext!.coeffects['request-meta'].requestId).toBe('string');
      expect(capturedContext!.coeffects['request-meta'].requestId.startsWith('req-')).toBe(true);

      const updatedState = getState();
      expect(updatedState.lastRequest).toMatchObject({
        params: ['param1', { key: 'value' }, 123],
      });
      expect(typeof updatedState.lastRequest.id).toBe('string');
      expect(typeof updatedState.lastRequest.timestamp).toBe('number');
    });
  });

  describe('Performance and Optimization', () => {
    it('should only inject co-effects when interceptors are present', async () => {
      let capturedContext: EventContext<any> | null = null;
      const cofxSpy = jest.fn(() => 'computed-value');

      regCoeffect('expensive-cofx', cofxSpy);

      regEvent('test-no-cofx', (context) => {
        capturedContext = context;
      });

      dispatch(['test-no-cofx']);

      await waitForScheduled();

      expect(cofxSpy).not.toHaveBeenCalled();
      expect(capturedContext!.coeffects['expensive-cofx']).toBeUndefined();

      regEvent(
        'test-with-cofx',
        (context) => {
          capturedContext = context;
        },
        { coeffects: { 'expensive-cofx': 'expensive-cofx' } },
      );

      dispatch(['test-with-cofx']);

      await waitForScheduled();

      expect(cofxSpy).toHaveBeenCalledTimes(1);
      expect(capturedContext!.coeffects['expensive-cofx']).toBe('computed-value');
    });
  });
});
