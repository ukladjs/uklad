import { defaultErrorHandler } from '../events/runner';
import {
  clearSubscriptionCache,
  dispatch,
  dispatchSync,
  getState,
  getOrCreateSubscription,
  getSubscriptionSnapshot,
  getSubscriptionValue,
  initState,
  regEffect,
  regEvent,
  regEventErrorHandler,
  regRootSub,
  regSub,
  subscribeToSubscription,
} from './runtime-test-api';
import { waitForScheduled, waitForAnimationFrame, waitForSubscription } from './test-utils';

describe('dispatchSync', () => {
  regRootSub('ds-counter', 'ds-counter');
  regSub(
    'ds-double',
    (counter) => counter * 2,
    () => [['ds-counter']],
  );

  regEvent('ds-inc', ({ draftState }) => {
    draftState['ds-counter'] += 1;
  });

  beforeEach(() => {
    clearSubscriptionCache();
    initState({ 'ds-counter': 0 });
  });

  it('should commit the state synchronously', () => {
    dispatchSync(['ds-inc']);

    expect(getState()['ds-counter']).toBe(1);
    expect(getSubscriptionValue(['ds-counter'])).toBe(1);
  });

  it('should notify subscription watchers before returning', () => {
    const subscription = getOrCreateSubscription(['ds-double'])!;
    const callback = jest.fn();
    const unsubscribe = subscribeToSubscription(subscription, callback);
    expect(getSubscriptionSnapshot(subscription)).toBe(0);

    dispatchSync(['ds-inc']);

    // No queue tick, no animation frame: the watcher already ran
    expect(callback).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(subscription)).toBe(2);

    unsubscribe();
  });

  it('should run effects synchronously', () => {
    const captured: any[] = [];
    regEffect('ds-capture', (value) => {
      captured.push(value);
    });
    regEvent('ds-with-effect', () => {
      return [['ds-capture', 'ran']];
    });

    dispatchSync(['ds-with-effect']);

    expect(captured).toEqual(['ran']);
  });

  it('should flush changes committed by earlier async dispatches too', async () => {
    const subscription = getOrCreateSubscription(['ds-double'])!;
    const callback = jest.fn();
    const unsubscribe = subscribeToSubscription(subscription, callback);
    getSubscriptionSnapshot(subscription);

    // Async event commits but its animation-frame flush is still pending
    dispatch(['ds-inc']);
    await waitForScheduled();
    expect(callback).not.toHaveBeenCalled();

    // The sync flush promotes everything committed so far, in one shot
    dispatchSync(['ds-inc']);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(subscription)).toBe(4);

    // The still-pending scheduled flush finds nothing left to do
    await waitForAnimationFrame();
    await waitForSubscription();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('should not overtake accepted asynchronous work', async () => {
    dispatch(['ds-inc']);

    expect(() => dispatchSync(['ds-inc'])).toThrow(/cannot overtake/);
    expect(getState()['ds-counter']).toBe(0);

    await waitForScheduled();
    expect(getState()['ds-counter']).toBe(1);
  });

  it('should throw when called from within an event handler', () => {
    regEvent('ds-reentrant', () => {
      dispatchSync(['ds-inc']);
    });

    expect(() => dispatchSync(['ds-reentrant'])).toThrow(/dispatchSync/);
    expect(getState()['ds-counter']).toBe(0);

    regEventErrorHandler(defaultErrorHandler);
  });

  it('should throw when called from within an effect handler', () => {
    // Effects run inside the event's interceptor chain, so the guard covers
    // them too: a sync reentrant commit mid-chain is just as unsafe there
    let effectError: Error | undefined;
    regEffect('ds-reentrant-effect', () => {
      try {
        dispatchSync(['ds-inc']);
      } catch (e: any) {
        effectError = e;
      }
    });
    regEvent('ds-with-reentrant-effect', ({ draftState }) => {
      draftState['ds-counter'] += 10;
      return [['ds-reentrant-effect']];
    });

    dispatchSync(['ds-with-reentrant-effect']);

    expect(effectError).toBeDefined();
    expect(String(effectError?.message)).toMatch(/dispatchSync/);
    expect(getState()['ds-counter']).toBe(10);
  });

  it('should reject dispatchSync from a subscription listener before mutation', () => {
    const subscription = getOrCreateSubscription(['ds-counter'])!;
    let nestedError: Error | undefined;
    const unsubscribe = subscribeToSubscription(subscription, () => {
      try {
        dispatchSync(['ds-inc']);
      } catch (error: any) {
        nestedError = error;
      }
    });
    expect(getSubscriptionSnapshot(subscription)).toBe(0);

    dispatchSync(['ds-inc']);

    expect(nestedError?.message).toMatch(/publication is not allowed/);
    expect(getState()['ds-counter']).toBe(1);
    expect(getSubscriptionSnapshot(subscription)).toBe(1);
    unsubscribe();
  });

  it('should propagate handler errors to the caller', () => {
    regEvent('ds-boom', () => {
      throw new Error('sync boom');
    });

    expect(() => dispatchSync(['ds-boom'])).toThrow('sync boom');

    regEventErrorHandler(defaultErrorHandler);
  });

  it('should reject invalid event vectors without throwing', () => {
    dispatchSync([] as any);

    expectLogCall('error', '[reflex] invalid dispatchSync event vector.');
  });
});
