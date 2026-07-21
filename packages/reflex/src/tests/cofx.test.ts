import {
  clearGlobalInterceptors,
  dispatch,
  getAppDb,
  getInjectCofxInterceptor,
  initAppDb,
  regCoeffect,
  regEvent,
} from './runtime-test-api';
import type { CoEffects } from '../types';
import { consoleLog } from '../core/logging';
import { waitForScheduled } from './test-utils';

describe('regCofx - Co-Effects', () => {
  beforeEach(() => {
    initAppDb({ counter: 0, messages: [] });
    clearGlobalInterceptors();
  });

  describe('Built-in Co-Effects', () => {
    it('should inject db co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regEvent('test-db-cofx', (coeffects: CoEffects) => {
        capturedCoeffects = coeffects;
      });

      dispatch(['test-db-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.event).toEqual(['test-db-cofx']);
    });

    it('should inject now co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;
      const startTime = Date.now();

      regEvent(
        'test-now-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [['now']],
      );

      dispatch(['test-now-cofx']);

      await waitForScheduled();

      const endTime = Date.now();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.now).toBeGreaterThanOrEqual(startTime);
      expect(capturedCoeffects!.now).toBeLessThanOrEqual(endTime);
      expect(typeof capturedCoeffects!.now).toBe('number');
    });

    it('should inject random co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regEvent(
        'test-random-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [['random']],
      );

      dispatch(['test-random-cofx']);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(typeof capturedCoeffects!.random).toBe('number');
      expect(capturedCoeffects!.random).toBeGreaterThanOrEqual(0);
      expect(capturedCoeffects!.random).toBeLessThan(1);
    });

    it('should inject multiple built-in co-effects', async () => {
      let capturedCoeffects: CoEffects | null = null;

      regEvent(
        'test-multiple-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [getInjectCofxInterceptor('now'), getInjectCofxInterceptor('random')],
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
        [getInjectCofxInterceptor('user-info')],
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
        [getInjectCofxInterceptor('api-token', 'users')],
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
        [['enhanced-data', { includeTimestamp: true, prefix: 'test' }]],
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
        ({ config, draftDb }) => {
          const newCounter = Math.min(draftDb.counter + 10, config.maxCounter);

          draftDb.counter = newCounter;
          draftDb.messages.push(config.defaultMessage);
        },
        [['app-config']],
      );

      dispatch(['test-cofx-logic']);

      await waitForScheduled();

      const updatedDb = getAppDb();
      expect(updatedDb.counter).toBe(10);
      expect(updatedDb.messages).toEqual(['Hello World']);
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
        [
          getInjectCofxInterceptor('session-info'),
          getInjectCofxInterceptor('permissions'),
          getInjectCofxInterceptor('feature-flags'),
        ],
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
        [getInjectCofxInterceptor('working-cofx'), getInjectCofxInterceptor('failing-cofx')],
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
        [getInjectCofxInterceptor('non-existent-cofx')],
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
          const draftDb = coeffects.draftDb;
          draftDb.lastRequest = {
            id: coeffects.requestId,
            params: params,
            timestamp: coeffects.timestamp,
          };
        },
        [getInjectCofxInterceptor('request-meta')],
      );

      dispatch(['test-params-with-cofx', 'param1', { key: 'value' }, 123]);

      await waitForScheduled();

      expect(capturedCoeffects).not.toBeNull();
      expect(capturedParams).toEqual(['param1', { key: 'value' }, 123]);
      expect(typeof capturedCoeffects!.requestId).toBe('string');
      expect(capturedCoeffects!.requestId.startsWith('req-')).toBe(true);

      const updatedDb = getAppDb();
      expect(updatedDb.lastRequest).toMatchObject({
        params: ['param1', { key: 'value' }, 123],
      });
      expect(typeof updatedDb.lastRequest.id).toBe('string');
      expect(typeof updatedDb.lastRequest.timestamp).toBe('number');
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
        [getInjectCofxInterceptor('expensive-cofx')],
      );

      dispatch(['test-with-cofx']);

      await waitForScheduled();

      expect(cofxSpy).toHaveBeenCalledTimes(1);
      expect(capturedCoeffects!.expensive).toBe('computed-value');
    });
  });
});
