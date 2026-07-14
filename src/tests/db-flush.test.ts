/**
 * Subscription flush semantics: the shallow top-level diff wake-up, event
 * coalescing, and db generation reads (subscriptions serve the last flushed
 * generation, not the live db).
 */
import { regEvent } from '../events';
import { dispatch } from '../router';
import { initAppDb, getAppDb, updateAppDb, flushSubscriptions, getRenderDb } from '../db';
import { regSub, getOrCreateSubscription, getSubscriptionValue } from '../subs';
import { clearHandlers, clearSubscriptionCache, clearSubs } from '../registrar';
import { getSubscriptionSnapshot, subscribeToSubscription } from '../subscription-runtime';
import { waitForScheduled, waitForAnimationFrame, waitForSubscription } from './test-utils';
import { produce } from 'immer';

const waitForFlush = async () => {
  await waitForAnimationFrame();
  await waitForSubscription();
};

describe('Subscription flush', () => {
  regSub('flush-counter');
  regSub('flush-other');
  regSub('flush-double', (counter) => counter * 2, () => [['flush-counter']]);

  regEvent('flush-inc', ({ draftDb }) => {
    draftDb['flush-counter'] += 1;
  });
  regEvent('flush-noop', () => { });
  regEvent('flush-del-other', ({ draftDb }) => {
    delete draftDb['flush-other'];
  });

  beforeEach(() => {
    clearSubscriptionCache();
    initAppDb({ 'flush-counter': 0, 'flush-other': 'unchanged' });
  });

  describe('db generation reads', () => {
    it('should reject registry clearing while a mounted graph is active', () => {
      const subscription = getOrCreateSubscription(['flush-counter'])!;
      const callback = jest.fn();
      const unsubscribe = subscribeToSubscription(subscription, callback);
      expect(getSubscriptionSnapshot(subscription)).toBe(0);

      expect(() => clearSubscriptionCache()).toThrow('Cannot clear subscriptions while a subscription graph is active');
      expect(() => clearHandlers('sub')).toThrow('Cannot clear subscriptions while a subscription graph is active');
      expect(() => clearSubs()).toThrow('Cannot clear subscriptions while a subscription graph is active');
      initAppDb({ 'flush-counter': 2, 'flush-other': 'replacement' });
      expect(callback).toHaveBeenCalledTimes(1);
      expect(getSubscriptionSnapshot(subscription)).toBe(2);

      unsubscribe();
      expect(() => clearSubscriptionCache()).not.toThrow();
    });

    it('publishes a replaced app-db baseline to an already-active graph', () => {
      const subscription = getOrCreateSubscription(['flush-double'])!;
      const callback = jest.fn();
      const unsubscribe = subscribeToSubscription(subscription, callback);
      expect(getSubscriptionSnapshot(subscription)).toBe(0);

      initAppDb({ 'flush-counter': 7, 'flush-other': 'replacement' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(getSubscriptionSnapshot(subscription)).toBe(14);
      unsubscribe();
    });

    it('should serve the last flushed generation between commit and flush', async () => {
      const subscription = getOrCreateSubscription(['flush-counter'])!;
      const callback = jest.fn();
      const unsubscribe = subscribeToSubscription(subscription, callback);
      expect(getSubscriptionSnapshot(subscription)).toBe(0);

      dispatch(['flush-inc']);
      await waitForScheduled();

      // The event committed: the live db is ahead of the render generation
      expect(getAppDb()['flush-counter']).toBe(1);
      expect(getRenderDb()['flush-counter']).toBe(0);

      // Every subscription read — cached or fresh — serves the flushed
      // generation, so nothing on screen can mix db versions
      expect(getSubscriptionSnapshot(subscription)).toBe(0);
      expect(getSubscriptionValue(['flush-counter'])).toBe(0);
      expect(getSubscriptionValue(['flush-double'])).toBe(0);
      expect(callback).not.toHaveBeenCalled();

      await waitForFlush();

      expect(getRenderDb()['flush-counter']).toBe(1);
      expect(getSubscriptionSnapshot(subscription)).toBe(1);
      expect(getSubscriptionValue(['flush-double'])).toBe(2);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
    });

    it('should serve current data to subscriptions created after the flush', async () => {
      dispatch(['flush-inc']);
      await waitForScheduled();
      await waitForFlush();

      expect(getSubscriptionValue(['flush-double'])).toBe(2);
    });
  });

  describe('event coalescing', () => {
    it('should coalesce several events into a single flush and notification', async () => {
      const subscription = getOrCreateSubscription(['flush-double'])!;
      const callback = jest.fn();
      const unsubscribe = subscribeToSubscription(subscription, callback);
      expect(getSubscriptionSnapshot(subscription)).toBe(0);

      dispatch(['flush-inc']);
      dispatch(['flush-inc']);
      dispatch(['flush-inc']);
      await waitForScheduled();
      await waitForFlush();

      // One notification with the final value, not one per event
      expect(callback).toHaveBeenCalledTimes(1);
      expect(getSubscriptionSnapshot(subscription)).toBe(6);

      unsubscribe();
    });
  });

  describe('shallow top-level diff wake-up', () => {
    it('should not wake subscriptions whose root key kept its reference', async () => {
      const counterSubscription = getOrCreateSubscription(['flush-counter'])!;
      const otherSubscription = getOrCreateSubscription(['flush-other'])!;
      const counterCallback = jest.fn();
      const otherCallback = jest.fn();
      const unsubscribeCounter = subscribeToSubscription(counterSubscription, counterCallback);
      const unsubscribeOther = subscribeToSubscription(otherSubscription, otherCallback);
      getSubscriptionSnapshot(counterSubscription);
      getSubscriptionSnapshot(otherSubscription);

      dispatch(['flush-inc']);
      await waitForScheduled();
      await waitForFlush();

      expect(counterCallback).toHaveBeenCalledTimes(1);
      expect(otherCallback).not.toHaveBeenCalled();
      expect(getSubscriptionSnapshot(counterSubscription)).toBe(1);
      expect(getSubscriptionSnapshot(otherSubscription)).toBe('unchanged');

      unsubscribeCounter();
      unsubscribeOther();
    });

    it('should not schedule anything when the handler leaves the db untouched', async () => {
      const dbBefore = getAppDb();

      dispatch(['flush-noop']);
      await waitForScheduled();

      // produce returned the same reference: no new generation committed
      expect(getAppDb()).toBe(dbBefore);
      expect(getRenderDb()).toBe(dbBefore);
    });

    it('should wake subscriptions when a top-level key is deleted', async () => {
      const subscription = getOrCreateSubscription(['flush-other'])!;
      const callback = jest.fn();
      const unsubscribe = subscribeToSubscription(subscription, callback);
      expect(getSubscriptionSnapshot(subscription)).toBe('unchanged');

      dispatch(['flush-del-other']);
      await waitForScheduled();
      await waitForFlush();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(getSubscriptionSnapshot(subscription)).toBeUndefined();

      unsubscribe();
    });
  });

  describe('flushSubscriptions', () => {
    it('should be a no-op when nothing was committed since the last flush', () => {
      const subscription = getOrCreateSubscription(['flush-counter'])!;
      const callback = jest.fn();
      const unsubscribe = subscribeToSubscription(subscription, callback);
      getSubscriptionSnapshot(subscription);

      flushSubscriptions();

      expect(callback).not.toHaveBeenCalled();
      unsubscribe();
    });

    it('should recompute and notify synchronously when flushed directly', () => {
      const subscription = getOrCreateSubscription(['flush-double'])!;
      const callback = jest.fn();
      const unsubscribe = subscribeToSubscription(subscription, callback);
      expect(getSubscriptionSnapshot(subscription)).toBe(0);

      updateAppDb(produce(getAppDb(), (draft: any) => {
        draft['flush-counter'] = 5;
      }));
      flushSubscriptions();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(getSubscriptionSnapshot(subscription)).toBe(10);

      unsubscribe();
    });

    it('should guard renderDb before a reentrant direct flush can promote it', () => {
      const subscription = getOrCreateSubscription(['flush-counter'])!;
      let nestedError: Error | undefined;
      let attempted = false;
      const unsubscribe = subscribeToSubscription(subscription, () => {
        if (attempted) return;
        attempted = true;
        updateAppDb(produce(getAppDb(), (draft: any) => {
          draft['flush-counter'] = 5;
        }));
        try {
          flushSubscriptions();
        } catch (error: any) {
          nestedError = error;
        }
      });
      expect(getSubscriptionSnapshot(subscription)).toBe(0);

      updateAppDb(produce(getAppDb(), (draft: any) => {
        draft['flush-counter'] = 1;
      }));
      flushSubscriptions();

      expect(nestedError?.message).toMatch(/publication is not allowed/);
      expect(getRenderDb()['flush-counter']).toBe(1);
      expect(getSubscriptionSnapshot(subscription)).toBe(1);

      flushSubscriptions();
      expect(getRenderDb()['flush-counter']).toBe(5);
      expect(getSubscriptionSnapshot(subscription)).toBe(5);
      unsubscribe();
    });
  });
});
