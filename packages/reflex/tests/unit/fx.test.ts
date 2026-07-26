import { consoleLog } from '../../src/core/logging';
import { dispatch, getState, initState, regEffect, regEvent } from './runtime-test-api';
import { waitForScheduled } from './test-utils';

describe('regFx - Custom Effects', () => {
  beforeEach(() => {
    initState({ counter: 0, logs: [] });
  });

  describe('Custom Effect Registration', () => {
    it('should register and execute a simple custom effect', async () => {
      const customEffectSpy = jest.fn();

      regEffect('custom-log', (message: string) => {
        customEffectSpy(message);
      });

      regEvent('test-custom-effect', () => [['custom-log', 'Hello from custom effect!']]);

      dispatch(['test-custom-effect']);

      expect(customEffectSpy).toHaveBeenCalledTimes(0);
      await waitForScheduled();

      expect(customEffectSpy).toHaveBeenCalledWith('Hello from custom effect!');
      expect(customEffectSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple custom effects in a single fx', async () => {
      const logEffectSpy = jest.fn();
      const alertEffectSpy = jest.fn();

      regEffect('log-message', (message: string) => {
        logEffectSpy(message);
      });

      regEffect('show-alert', (alertData: { title: string; message: string }) => {
        alertEffectSpy(alertData);
      });

      regEvent('test-multiple-effects', () => [
        ['log-message', 'First effect executed'],
        ['show-alert', { title: 'Alert', message: 'Second effect executed' }],
        ['log-message', 'Third effect executed'],
      ]);

      dispatch(['test-multiple-effects']);

      await waitForScheduled();

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

      regEffect('increment-count', (amount: number) => {
        externalState.count += amount;
      });

      regEffect('add-message', (message: string) => {
        externalState.messages.push(message);
      });

      regEvent('test-external-state', () => [
        ['increment-count', 5],
        ['add-message', 'State modified'],
        ['increment-count', 3],
      ]);

      dispatch(['test-external-state']);

      await waitForScheduled();

      expect(externalState.count).toBe(8);
      expect(externalState.messages).toEqual(['State modified']);
    });

    it('should combine custom effects with stateUpdate', async () => {
      const apiCallSpy = jest.fn();

      regEffect('api-call', (endpoint: string) => {
        apiCallSpy(endpoint);
      });

      regEvent('test-combined-effects', ({ draftState }) => {
        draftState.counter += 1;
        draftState.status = 'processing';
        return [
          ['api-call', '/api/users'],
          ['api-call', '/api/data'],
        ];
      });

      const initialState = getState();
      expect(initialState.counter).toBe(0);

      dispatch(['test-combined-effects']);

      await waitForScheduled();

      const updatedState = getState();
      expect(updatedState.counter).toBe(1);
      expect(updatedState.status).toBe('processing');

      expect(apiCallSpy).toHaveBeenCalledTimes(2);
      expect(apiCallSpy).toHaveBeenNthCalledWith(1, '/api/users');
      expect(apiCallSpy).toHaveBeenNthCalledWith(2, '/api/data');
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in custom effects gracefully', async () => {
      const workingEffectSpy = jest.fn();

      regEffect('failing-effect', () => {
        consoleLog('error', '[reflex] Custom effect failed');
      });

      regEffect('working-effect', (message: string) => {
        workingEffectSpy(message);
      });

      regEvent('test-error-handling', () => [
        ['working-effect', 'Before error'],
        ['failing-effect', null],
        ['working-effect', 'After error'],
      ]);

      dispatch(['test-error-handling']);

      await waitForScheduled();

      expectLogCall('error', '[reflex] Custom effect failed');

      expect(workingEffectSpy).toHaveBeenCalledTimes(2);
      expect(workingEffectSpy).toHaveBeenNthCalledWith(1, 'Before error');
      expect(workingEffectSpy).toHaveBeenNthCalledWith(2, 'After error');
    });

    it('should warn about unregistered effects', async () => {
      regEvent('test-unregistered-effect', () => [['non-existent-effect', 'some data']]);

      dispatch(['test-unregistered-effect']);

      await waitForScheduled();

      expectLogCall(
        'warn',
        "[reflex] in 'effects' found non-existent-effect which has no associated handler. Ignoring.",
      );
    });

    it('should warn when effects is not an array', async () => {
      regEvent('test-invalid-effects', () => 'not an array' as any);

      dispatch(['test-invalid-effects']);

      await waitForScheduled();

      expectLogCall('warn', '[reflex] effects expects a vector, but was given string');
    });

    it('should warn for a falsy non-array effect result and still commit the STATE', async () => {
      regEvent('test-falsy-effects', ({ draftState }) => {
        draftState.counter += 1;
        return false as any;
      });

      dispatch(['test-falsy-effects']);
      await waitForScheduled();

      expect(getState().counter).toBe(1);
      expectLogCall('warn', '[reflex] effects expects a vector, but was given boolean');
    });
  });

  describe('Built-in Effects Integration', () => {
    it('should work with dispatch effect in fx', async () => {
      const customEffectSpy = jest.fn();

      regEffect('custom-tracker', (action: string) => {
        customEffectSpy(action);
      });

      regEvent('target-event', ({ draftState }) => {
        draftState.counter += 10;
      });

      regEvent('test-dispatch-integration', () => [
        ['custom-tracker', 'Before dispatch'],
        ['dispatch', ['target-event']],
        ['custom-tracker', 'After dispatch'],
      ]);

      dispatch(['test-dispatch-integration']);

      // Chained dispatches require multiple queue cycles.
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(customEffectSpy).toHaveBeenCalledTimes(2);
      expect(customEffectSpy).toHaveBeenNthCalledWith(1, 'Before dispatch');
      expect(customEffectSpy).toHaveBeenNthCalledWith(2, 'After dispatch');

      const state = getState();
      expect(state.counter).toBe(10);
    });

    it('should work with dispatch-later effect in fx', async () => {
      const customEffectSpy = jest.fn();

      regEffect('time-tracker', (timestamp: number) => {
        customEffectSpy(timestamp);
      });

      regEvent('delayed-event', ({ draftState }) => {
        draftState.counter += 5;
      });

      regEvent('test-dispatch-later-integration', () => {
        const now = Date.now();
        return [
          ['time-tracker', now],
          ['dispatch-later', { ms: 50, dispatch: ['delayed-event'] }],
          ['time-tracker', now + 1],
        ];
      });

      dispatch(['test-dispatch-later-integration']);

      // Observe the state before the 50 ms delayed event is due.
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(customEffectSpy).toHaveBeenCalledTimes(2);

      expect(getState().counter).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(getState().counter).toBe(5);
    });
  });

  describe('Complex Custom Effects', () => {
    it('should handle async custom effects', async () => {
      const asyncResults: string[] = [];

      regEffect('async-operation', async (data: string) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        asyncResults.push(`Processed: ${data}`);
      });

      regEvent('test-async-effect', () => [
        ['async-operation', 'first'],
        ['async-operation', 'second'],
      ]);

      dispatch(['test-async-effect']);

      // Allow both async effects to resolve.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(asyncResults).toEqual(['Processed: first', 'Processed: second']);
    });

    it('should handle effects with complex data structures', async () => {
      const processedData: any[] = [];

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

      dispatch(['test-complex-data']);

      await new Promise((resolve) => setTimeout(resolve, 10));

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

      regEffect('no-param', () => {
        noParamSpy();
      });

      regEvent('test-no-param', () => [['no-param']]);

      dispatch(['test-no-param']);

      await waitForScheduled();

      expect(noParamSpy).toHaveBeenCalledTimes(1);
    });
  });
});
