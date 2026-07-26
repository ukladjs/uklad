import {
  clearInterceptors,
  dispatch,
  getState,
  handlerRegistry,
  initState,
  regCoeffect,
  regEvent,
} from './runtime-test-api';
import type { CoEffects } from '../../src/types';
import { consoleLog } from '../../src/core/logging';
import { waitForScheduled } from './test-utils';

describe('regCofx - Co-Effects', () => {
  beforeEach(() => {
    initState({ counter: 0, messages: [] });
    clearInterceptors();
    handlerRegistry.cofx.clear('now');
    handlerRegistry.cofx.clear('random');
    regCoeffect('now', (coeffects) => ({
      ...coeffects,
      now: Date.now(),
    }));
    regCoeffect('random', (coeffects) => ({
      ...coeffects,
      random: Math.random(),
    }));
  });

  describe('Application Co-Effects', () => {
    it('should inject state co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regEvent('test-state-cofx', (coeffects: CoEffects) => {
        capturedCoeffects = coeffects;
      });

      dispatch(['test-state-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.event).toEqual(['test-state-cofx']);
    });

    it('should inject an application-defined now co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;
      const startTime = Date.now();

      regEvent(
        'test-now-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        { coeffects: [['now']] },
      );

      dispatch(['test-now-cofx']);

      await waitForScheduled();

      const endTime = Date.now();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.now).toBeGreaterThanOrEqual(startTime);
      expect(capturedCoeffects!.now).toBeLessThanOrEqual(endTime);
      expect(typeof capturedCoeffects!.now).toBe('number');
    });

    it('should inject an application-defined random co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regEvent(
        'test-random-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        { coeffects: [['random']] },
      );

      dispatch(['test-random-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(typeof capturedCoeffects!.random).toBe('number');
      expect(capturedCoeffects!.random).toBeGreaterThanOrEqual(0);
      expect(capturedCoeffects!.random).toBeLessThan(1);
    });

    it('should inject multiple application-defined co-effects', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regEvent(
        'test-multiple-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        { coeffects: [['now'], ['random']] },
      );

      dispatch(['test-multiple-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(typeof capturedCoeffects!.now).toBe('number');
      expect(typeof capturedCoeffects!.random).toBe('number');
      expect(capturedCoeffects!.event).toEqual(['test-multiple-cofx']);
    });
  });

  describe('Custom Co-Effects Registration', () => {
    it('should register and inject custom co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regCoeffect('user-info', (coeffects: CoEffects) => ({
        ...coeffects,
        userInfo: {
          id: 123,
          name: 'Test User',
          role: 'admin',
        },
      }));

      regEvent(
        'test-custom-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        { coeffects: [['user-info']] },
      );

      dispatch(['test-custom-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.userInfo).toEqual({
        id: 123,
        name: 'Test User',
        role: 'admin',
      });
    });

    it('should register co-effect with parameter', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regCoeffect('api-token', (coeffects: CoEffects, apiEndpoint: string) => ({
        ...coeffects,
        apiToken: `token-for-${apiEndpoint}`,
      }));

      regEvent(
        'test-param-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        { coeffects: [['api-token', 'users']] },
      );

      dispatch(['test-param-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.apiToken).toBe('token-for-users');
    });

    it('should handle complex custom co-effects', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regCoeffect(
        'enhanced-data',
        (coeffects: CoEffects, config: { includeTimestamp: boolean; prefix: string }) => {
          const baseData = {
            enhancedBy: 'cofx-handler',
          };

          return {
            ...coeffects,
            enhancedData: config.includeTimestamp
              ? { ...baseData, timestamp: Date.now(), prefix: config.prefix }
              : { ...baseData, prefix: config.prefix },
          };
        },
      );

      regEvent(
        'test-complex-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        {
          coeffects: [['enhanced-data', { includeTimestamp: true, prefix: 'test' }]],
        },
      );

      dispatch(['test-complex-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.enhancedData).toMatchObject({
        enhancedBy: 'cofx-handler',
        prefix: 'test',
      });
      expect(capturedCoeffects!.enhancedData.timestamp).toBeGreaterThan(0);
    });
  });

  describe('Co-Effects Integration with Event Handlers', () => {
    it('should use co-effects in event handler logic', async () => {
      regCoeffect('app-config', (coeffects: CoEffects) => ({
        ...coeffects,
        config: {
          maxCounter: 100,
          defaultMessage: 'Hello World',
        },
      }));

      regEvent(
        'test-cofx-logic',
        ({ config, draftState }) => {
          const newCounter = Math.min(draftState.counter + 10, config.maxCounter);

          draftState.counter = newCounter;
          draftState.messages.push(config.defaultMessage);
        },
        { coeffects: [['app-config']] },
      );

      dispatch(['test-cofx-logic']);

      await waitForScheduled();

      const updatedState = getState();
      expect(updatedState.counter).toBe(10);
      expect(updatedState.messages).toEqual(['Hello World']);
    });

    it('should chain multiple co-effects for complex data preparation', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regCoeffect('session-info', (coeffects: CoEffects) => ({
        ...coeffects,
        session: { userId: 456, sessionId: 'sess-123' },
      }));

      regCoeffect('permissions', (coeffects: CoEffects) => ({
        ...coeffects,
        permissions: ['read', 'write', 'admin'],
      }));

      regCoeffect('feature-flags', (coeffects: CoEffects) => ({
        ...coeffects,
        features: {
          newUI: true,
          betaFeatures: coeffects.session?.userId === 456,
        },
      }));

      regEvent(
        'test-chained-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        {
          coeffects: [['session-info'], ['permissions'], ['feature-flags']],
        },
      );

      dispatch(['test-chained-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.session).toEqual({ userId: 456, sessionId: 'sess-123' });
      expect(capturedCoeffects!.permissions).toEqual(['read', 'write', 'admin']);
      expect(capturedCoeffects!.features).toEqual({ newUI: true, betaFeatures: true });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in co-effect handlers gracefully', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regCoeffect('failing-cofx', (coeffects: CoEffects) => {
        consoleLog('error', '[reflex] Co-effect failed');
        return coeffects;
      });

      regCoeffect('working-cofx', (coeffects: CoEffects) => ({
        ...coeffects,
        working: true,
      }));

      regEvent(
        'test-error-handling',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        { coeffects: [['working-cofx'], ['failing-cofx']] },
      );

      dispatch(['test-error-handling']);

      await waitForScheduled();

      expectLogCall('error', '[reflex] Co-effect failed');

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.working).toBe(true);
    });

    it('should handle unregistered co-effects', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regEvent(
        'test-unregistered-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        { coeffects: [['non-existent-cofx']] },
      );

      dispatch(['test-unregistered-cofx']);

      await waitForScheduled();

      expectLogCall('error', '[reflex] No cofx handler registered for', 'non-existent-cofx');

      expect(capturedCoeffects).not.toBeNull();
    });
  });

  describe('Co-Effects with Event Parameters', () => {
    it('should work with events that have parameters', async () => {
      let capturedCoeffects: CoEffects | null = null;
      let capturedParams: any[] | null = null;

      regCoeffect('request-meta', (coeffects: CoEffects) => ({
        ...coeffects,
        requestId: 'req-' + Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
      }));

      regEvent(
        'test-params-with-cofx',
        (coeffects, ...params) => {
          capturedCoeffects = coeffects;
          capturedParams = params;
          const draftState = coeffects.draftState;
          draftState.lastRequest = {
            id: coeffects.requestId,
            params: params,
            timestamp: coeffects.timestamp,
          };
        },
        { coeffects: [['request-meta']] },
      );

      dispatch(['test-params-with-cofx', 'param1', { key: 'value' }, 123]);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedParams).toEqual(['param1', { key: 'value' }, 123]);
      expect(typeof capturedCoeffects!.requestId).toBe('string');
      expect(capturedCoeffects!.requestId.startsWith('req-')).toBe(true);

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
      let capturedCoeffects: CoEffects | null = null;
      const cofxSpy = jest.fn((coeffects: CoEffects) => ({
        ...coeffects,
        expensive: 'computed-value',
      }));

      regCoeffect('expensive-cofx', cofxSpy);

      regEvent('test-no-cofx', (coeffects) => {
        capturedCoeffects = coeffects;
      });

      dispatch(['test-no-cofx']);

      await waitForScheduled();

      expect(cofxSpy).not.toHaveBeenCalled();
      expect(capturedCoeffects!.expensive).toBeUndefined();

      regEvent(
        'test-with-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        { coeffects: [['expensive-cofx']] },
      );

      dispatch(['test-with-cofx']);

      await waitForScheduled();

      expect(cofxSpy).toHaveBeenCalledTimes(1);
      expect(capturedCoeffects!.expensive).toBe('computed-value');
    });
  });
});
