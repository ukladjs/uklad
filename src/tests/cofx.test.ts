import { regCoeffect, getInjectCofxInterceptor } from '../cofx';
import { regEvent } from '../events';
import { dispatch } from '../router';
import { initAppDb, getAppDb } from '../db';
import { clearGlobalInterceptors } from '../settings';
import type { CoEffects } from '../types';
import { consoleLog } from '../loggers';
import { waitForScheduled } from './test-utils';

describe('regCofx - Co-Effects', () => {
  beforeEach(() => {
    // Initialize a clean database for each test
    initAppDb({ counter: 0, messages: [] });
    // Clear global interceptors to ensure clean state
    clearGlobalInterceptors();
    // Test logger is automatically cleared by jest.setup.js
  });

  describe('Built-in Co-Effects', () => {
    it('should inject db co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register an event that captures coeffects
      regEvent('test-db-cofx', (coeffects: CoEffects) => {
        capturedCoeffects = coeffects;
      });

      // Dispatch event - db should be automatically injected by default
      dispatch(['test-db-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify db was injected
      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.event).toEqual(['test-db-cofx']);
    });

    it('should inject now co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;
      const startTime = Date.now();

      // Register an event with now co-effect
      regEvent(
        'test-now-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [['now']],
      );

      // Dispatch event
      dispatch(['test-now-cofx']);

      // Wait for async processing
      await waitForScheduled();

      const endTime = Date.now();

      // Verify now was injected with a reasonable timestamp
      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.now).toBeGreaterThanOrEqual(startTime);
      expect(capturedCoeffects!.now).toBeLessThanOrEqual(endTime);
      expect(typeof capturedCoeffects!.now).toBe('number');
    });

    it('should inject random co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register an event with random co-effect
      regEvent(
        'test-random-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [['random']],
      );

      // Dispatch event
      dispatch(['test-random-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify random was injected
      expect(capturedCoeffects).not.toBeNull();
      expect(typeof capturedCoeffects!.random).toBe('number');
      expect(capturedCoeffects!.random).toBeGreaterThanOrEqual(0);
      expect(capturedCoeffects!.random).toBeLessThan(1);
    });

    it('should inject multiple built-in co-effects', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register an event with multiple co-effects
      regEvent(
        'test-multiple-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [getInjectCofxInterceptor('now'), getInjectCofxInterceptor('random')],
      );

      // Dispatch event
      dispatch(['test-multiple-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify all co-effects were injected
      expect(capturedCoeffects).not.toBeNull();
      expect(typeof capturedCoeffects!.now).toBe('number');
      expect(typeof capturedCoeffects!.random).toBe('number');
      expect(capturedCoeffects!.event).toEqual(['test-multiple-cofx']);
    });
  });

  describe('Custom Co-Effects Registration', () => {
    it('should register and inject custom co-effect', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register a custom co-effect
      regCoeffect('user-info', (coeffects: CoEffects) => ({
        ...coeffects,
        userInfo: {
          id: 123,
          name: 'Test User',
          role: 'admin',
        },
      }));

      // Register an event with custom co-effect
      regEvent(
        'test-custom-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [getInjectCofxInterceptor('user-info')],
      );

      // Dispatch event
      dispatch(['test-custom-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify custom co-effect was injected
      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.userInfo).toEqual({
        id: 123,
        name: 'Test User',
        role: 'admin',
      });
    });

    it('should register co-effect with parameter', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register a parameterized co-effect
      regCoeffect('api-token', (coeffects: CoEffects, apiEndpoint: string) => ({
        ...coeffects,
        apiToken: `token-for-${apiEndpoint}`,
      }));

      // Register an event with parameterized co-effect
      regEvent(
        'test-param-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [getInjectCofxInterceptor('api-token', 'users')],
      );

      // Dispatch event
      dispatch(['test-param-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify parameterized co-effect was injected
      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.apiToken).toBe('token-for-users');
    });

    it('should handle complex custom co-effects', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register a complex co-effect that depends on existing coeffects
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

      // Register an event with complex co-effect
      regEvent(
        'test-complex-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [['enhanced-data', { includeTimestamp: true, prefix: 'test' }]],
      );

      // Dispatch event
      dispatch(['test-complex-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify complex co-effect was injected
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
      // Register a co-effect that provides configuration
      regCoeffect('app-config', (coeffects: CoEffects) => ({
        ...coeffects,
        config: {
          maxCounter: 100,
          defaultMessage: 'Hello World',
        },
      }));

      // Register an event that uses co-effects for business logic
      regEvent(
        'test-cofx-logic',
        ({ config, draftDb }) => {
          const newCounter = Math.min(draftDb.counter + 10, config.maxCounter);

          draftDb.counter = newCounter;
          draftDb.messages.push(config.defaultMessage);
        },
        [['app-config']],
      );

      // Dispatch event
      dispatch(['test-cofx-logic']);

      // Wait for async processing
      await waitForScheduled();

      // Verify co-effects were used in business logic
      const updatedDb = getAppDb();
      expect(updatedDb.counter).toBe(10);
      expect(updatedDb.messages).toEqual(['Hello World']);
    });

    it('should chain multiple co-effects for complex data preparation', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register multiple co-effects
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

      // Register an event with chained co-effects
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

      // Dispatch event
      dispatch(['test-chained-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify all co-effects were chained correctly
      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.session).toEqual({ userId: 456, sessionId: 'sess-123' });
      expect(capturedCoeffects!.permissions).toEqual(['read', 'write', 'admin']);
      expect(capturedCoeffects!.features).toEqual({ newUI: true, betaFeatures: true });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in co-effect handlers gracefully', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register a co-effect that throws an error
      regCoeffect('failing-cofx', (coeffects: CoEffects) => {
        consoleLog('error', '[reflex] Co-effect failed');
        return coeffects;
      });

      // Register a working co-effect to ensure other co-effects still work
      regCoeffect('working-cofx', (coeffects: CoEffects) => ({
        ...coeffects,
        working: true,
      }));

      // Register an event with both co-effects
      regEvent(
        'test-error-handling',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [getInjectCofxInterceptor('working-cofx'), getInjectCofxInterceptor('failing-cofx')],
      );

      // Dispatch event
      dispatch(['test-error-handling']);

      // Wait for async processing
      await waitForScheduled();

      // Verify error was logged
      expectLogCall('error', '[reflex] Co-effect failed');

      // Verify working co-effect still functioned
      expect(capturedCoeffects).not.toBeNull();
      expect(capturedCoeffects!.working).toBe(true);
    });

    it('should handle unregistered co-effects', async () => {
      let capturedCoeffects: CoEffects | null = null;

      // Register an event with unregistered co-effect
      regEvent(
        'test-unregistered-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [getInjectCofxInterceptor('non-existent-cofx')],
      );

      // Dispatch event
      dispatch(['test-unregistered-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify error was logged
      expectLogCall('error', '[reflex] No cofx handler registered for', 'non-existent-cofx');

      // Verify event still executed with original coeffects
      expect(capturedCoeffects).not.toBeNull();
    });
  });

  describe('Co-Effects with Event Parameters', () => {
    it('should work with events that have parameters', async () => {
      let capturedCoeffects: CoEffects | null = null;
      let capturedParams: any[] | null = null;

      // Register a co-effect that provides metadata
      regCoeffect('request-meta', (coeffects: CoEffects) => ({
        ...coeffects,
        requestId: 'req-' + Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
      }));

      // Register an event with parameters and co-effects
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

      // Dispatch event with parameters
      dispatch(['test-params-with-cofx', 'param1', { key: 'value' }, 123]);

      // Wait for async processing
      await waitForScheduled();

      // Verify co-effects and parameters work together
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

      // Register an expensive co-effect
      regCoeffect('expensive-cofx', cofxSpy);

      // Register an event WITHOUT the co-effect interceptor
      regEvent('test-no-cofx', (coeffects) => {
        capturedCoeffects = coeffects;
      });

      // Dispatch event
      dispatch(['test-no-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify expensive co-effect was NOT called
      expect(cofxSpy).not.toHaveBeenCalled();
      expect(capturedCoeffects!.expensive).toBeUndefined();

      // Now test with the interceptor
      regEvent(
        'test-with-cofx',
        (coeffects) => {
          capturedCoeffects = coeffects;
        },
        [getInjectCofxInterceptor('expensive-cofx')],
      );

      // Dispatch event
      dispatch(['test-with-cofx']);

      // Wait for async processing
      await waitForScheduled();

      // Verify expensive co-effect WAS called
      expect(cofxSpy).toHaveBeenCalledTimes(1);
      expect(capturedCoeffects!.expensive).toBe('computed-value');
    });
  });
});
