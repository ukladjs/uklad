import { regEffect } from '../fx';
import { regEvent } from '../events';
import { dispatch } from '../router';
import { initAppDb, getAppDb } from '../db';
import { consoleLog } from '../loggers';
import { waitForScheduled } from './test-utils';

describe('regFx - Custom Effects', () => {
  beforeEach(() => {
    // Initialize a clean database for each test
    initAppDb({ counter: 0, logs: [] });
    // Test logger is automatically cleared by jest.setup.js
  });

  describe('Custom Effect Registration', () => {
    it('should register and execute a simple custom effect', async () => {
      const customEffectSpy = jest.fn();

      // Register a custom effect
      regEffect('custom-log', (message: string) => {
        customEffectSpy(message);
      });

      // Register an event that uses the custom effect via effects
      regEvent('test-custom-effect', () => [['custom-log', 'Hello from custom effect!']]);

      // Dispatch the event
      dispatch(['test-custom-effect']);

      expect(customEffectSpy).toHaveBeenCalledTimes(0);
      // Wait for async processing
      await waitForScheduled();

      // Verify the custom effect was called
      expect(customEffectSpy).toHaveBeenCalledWith('Hello from custom effect!');
      expect(customEffectSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple custom effects in a single fx', async () => {
      const logEffectSpy = jest.fn();
      const alertEffectSpy = jest.fn();

      // Register multiple custom effects
      regEffect('log-message', (message: string) => {
        logEffectSpy(message);
      });

      regEffect('show-alert', (alertData: { title: string; message: string }) => {
        alertEffectSpy(alertData);
      });

      // Register an event that uses multiple custom effects
      regEvent('test-multiple-effects', () => [
        ['log-message', 'First effect executed'],
        ['show-alert', { title: 'Alert', message: 'Second effect executed' }],
        ['log-message', 'Third effect executed'],
      ]);

      // Dispatch the event
      dispatch(['test-multiple-effects']);

      // Wait for async processing
      await waitForScheduled();

      // Verify all effects were called in order
      expect(logEffectSpy).toHaveBeenCalledTimes(2);
      expect(logEffectSpy).toHaveBeenNthCalledWith(1, 'First effect executed');
      expect(logEffectSpy).toHaveBeenNthCalledWith(2, 'Third effect executed');

      expect(alertEffectSpy).toHaveBeenCalledTimes(1);
      expect(alertEffectSpy).toHaveBeenCalledWith({
        title: 'Alert',
        message: 'Second effect executed',
      });
    });

    it('should handle custom effects that modify external state', async () => {
      const externalState = { count: 0, messages: [] as string[] };

      // Register effects that modify external state
      regEffect('increment-count', (amount: number) => {
        externalState.count += amount;
      });

      regEffect('add-message', (message: string) => {
        externalState.messages.push(message);
      });

      // Register an event that uses these effects
      regEvent('test-external-state', () => [
        ['increment-count', 5],
        ['add-message', 'State modified'],
        ['increment-count', 3],
      ]);

      // Dispatch the event
      dispatch(['test-external-state']);

      // Wait for async processing
      await waitForScheduled();

      // Verify external state was modified correctly
      expect(externalState.count).toBe(8);
      expect(externalState.messages).toEqual(['State modified']);
    });

    it('should combine custom effects with dbUpdate', async () => {
      const apiCallSpy = jest.fn();

      // Register a custom effect for API calls
      regEffect('api-call', (endpoint: string) => {
        apiCallSpy(endpoint);
      });

      // Register an event that combines database updates with custom effects
      regEvent('test-combined-effects', ({ draftDb }) => {
        draftDb.counter += 1;
        draftDb.status = 'processing';
        return [
          ['api-call', '/api/users'],
          ['api-call', '/api/data'],
        ];
      });

      // Get initial state
      const initialDb = getAppDb();
      expect(initialDb.counter).toBe(0);

      // Dispatch the event
      dispatch(['test-combined-effects']);

      // Wait for async processing
      await waitForScheduled();

      // Verify both dbUpdate and custom effects were executed
      const updatedDb = getAppDb();
      expect(updatedDb.counter).toBe(1);
      expect(updatedDb.status).toBe('processing');

      expect(apiCallSpy).toHaveBeenCalledTimes(2);
      expect(apiCallSpy).toHaveBeenNthCalledWith(1, '/api/users');
      expect(apiCallSpy).toHaveBeenNthCalledWith(2, '/api/data');
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in custom effects gracefully', async () => {
      const workingEffectSpy = jest.fn();

      // Register a custom effect that throws an error
      regEffect('failing-effect', () => {
        consoleLog('error', '[reflex] Custom effect failed');
      });

      // Register a working effect to ensure other effects still execute
      regEffect('working-effect', (message: string) => {
        workingEffectSpy(message);
      });

      // Register an event that uses both effects
      regEvent('test-error-handling', () => [
        ['working-effect', 'Before error'],
        ['failing-effect', null],
        ['working-effect', 'After error'],
      ]);

      // Dispatch the event
      dispatch(['test-error-handling']);

      // Wait for async processing
      await waitForScheduled();

      // Verify error was logged and other effects still executed
      expectLogCall('error', '[reflex] Custom effect failed');

      expect(workingEffectSpy).toHaveBeenCalledTimes(2);
      expect(workingEffectSpy).toHaveBeenNthCalledWith(1, 'Before error');
      expect(workingEffectSpy).toHaveBeenNthCalledWith(2, 'After error');
    });

    it('should warn about unregistered effects', async () => {
      // Register an event that uses an unregistered effect
      regEvent('test-unregistered-effect', () => [['non-existent-effect', 'some data']]);

      // Dispatch the event
      dispatch(['test-unregistered-effect']);

      // Wait for async processing
      await waitForScheduled();

      // Verify warning was logged
      expectLogCall(
        'warn',
        "[reflex] in 'effects' found non-existent-effect which has no associated handler. Ignoring.",
      );
    });

    it('should warn when effects is not an array', async () => {
      // Register an event with invalid effects format
      regEvent('test-invalid-effects', () => 'not an array' as any);

      // Dispatch the event
      dispatch(['test-invalid-effects']);

      // Wait for async processing
      await waitForScheduled();

      // Verify warning was logged
      expectLogCall('warn', '[reflex] effects expects a vector, but was given string');
    });
  });

  describe('Built-in Effects Integration', () => {
    it('should work with dispatch effect in fx', async () => {
      const customEffectSpy = jest.fn();

      // Register a custom effect
      regEffect('custom-tracker', (action: string) => {
        customEffectSpy(action);
      });

      // Register target event
      regEvent('target-event', ({ draftDb }) => {
        draftDb.counter += 10;
      });

      // Register an event that dispatches another event and uses custom effect
      regEvent('test-dispatch-integration', () => [
        ['custom-tracker', 'Before dispatch'],
        ['dispatch', ['target-event']],
        ['custom-tracker', 'After dispatch'],
      ]);

      // Dispatch the event
      dispatch(['test-dispatch-integration']);

      // Wait for async processing (multiple cycles needed for chained dispatches)
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify custom effects were called
      expect(customEffectSpy).toHaveBeenCalledTimes(2);
      expect(customEffectSpy).toHaveBeenNthCalledWith(1, 'Before dispatch');
      expect(customEffectSpy).toHaveBeenNthCalledWith(2, 'After dispatch');

      // Verify the dispatched event was processed
      const db = getAppDb();
      expect(db.counter).toBe(10);
    });

    it('should work with dispatch-later effect in fx', async () => {
      const customEffectSpy = jest.fn();

      // Register a custom effect
      regEffect('time-tracker', (timestamp: number) => {
        customEffectSpy(timestamp);
      });

      // Register target event
      regEvent('delayed-event', ({ draftDb }) => {
        draftDb.counter += 5;
      });

      // Register an event that uses dispatch-later with custom effects
      regEvent('test-dispatch-later-integration', () => {
        const now = Date.now();
        return [
          ['time-tracker', now],
          ['dispatch-later', { ms: 50, dispatch: ['delayed-event'] }],
          ['time-tracker', now + 1],
        ];
      });

      // Dispatch the event
      dispatch(['test-dispatch-later-integration']);

      // Wait for immediate effects
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify immediate custom effects were called
      expect(customEffectSpy).toHaveBeenCalledTimes(2);

      // Counter should still be 0 (delayed event hasn't fired yet)
      expect(getAppDb().counter).toBe(0);

      // Wait for delayed dispatch
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now the delayed event should have been processed
      expect(getAppDb().counter).toBe(5);
    });
  });

  describe('Complex Custom Effects', () => {
    it('should handle async custom effects', async () => {
      const asyncResults: string[] = [];

      // Register an async custom effect
      regEffect('async-operation', async (data: string) => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 20));
        asyncResults.push(`Processed: ${data}`);
      });

      // Register an event that uses the async effect
      regEvent('test-async-effect', () => [
        ['async-operation', 'first'],
        ['async-operation', 'second'],
      ]);

      // Dispatch the event
      dispatch(['test-async-effect']);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify async effects completed
      expect(asyncResults).toEqual(['Processed: first', 'Processed: second']);
    });

    it('should handle effects with complex data structures', async () => {
      const processedData: any[] = [];

      // Register an effect that handles complex data
      regEffect(
        'process-complex-data',
        (data: { id: number; items: string[]; metadata: { created: number; tags: string[] } }) => {
          processedData.push({
            ...data,
            processed: true,
            processedAt: Date.now(),
          });
        },
      );

      // Register an event with complex data
      regEvent('test-complex-data', () => [
        [
          'process-complex-data',
          {
            id: 1,
            items: ['item1', 'item2'],
            metadata: { created: 123456789, tags: ['urgent', 'important'] },
          },
        ],
        [
          'process-complex-data',
          {
            id: 2,
            items: ['item3'],
            metadata: { created: 123456790, tags: ['normal'] },
          },
        ],
      ]);

      // Dispatch the event
      dispatch(['test-complex-data']);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify complex data was processed correctly
      expect(processedData).toHaveLength(2);
      expect(processedData[0]).toMatchObject({
        id: 1,
        items: ['item1', 'item2'],
        metadata: { created: 123456789, tags: ['urgent', 'important'] },
        processed: true,
      });
      expect(processedData[0].processedAt).toBeGreaterThan(0);

      expect(processedData[1]).toMatchObject({
        id: 2,
        items: ['item3'],
        metadata: { created: 123456790, tags: ['normal'] },
        processed: true,
      });
    });

    it('should execute custom effect without parameters', async () => {
      const noParamSpy = jest.fn();

      // Register a custom effect that ignores the value
      regEffect('no-param', () => {
        noParamSpy();
      });

      // Register an event that uses the effect with undefined value
      regEvent('test-no-param', () => [['no-param']]);

      // Dispatch the event
      dispatch(['test-no-param']);

      // Wait for async processing
      await waitForScheduled();

      // Verify the effect was called
      expect(noParamSpy).toHaveBeenCalledTimes(1);
    });
  });
});
