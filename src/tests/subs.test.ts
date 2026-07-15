import {
  regSub,
  getOrCreateSubscription,
  getSubscriptionValue,
  hasNonSerializableSubParam,
} from '../subs';
import { initAppDb } from '../db';
import {
  hasCachedSubscription,
  clearSubscriptionCache,
  getSubConfig,
  sweepProvisionalSubscriptions,
} from '../registrar';
import { subscribeToSubscription } from '../subscription-runtime';
import { waitForAnimationFrame, waitForSubscription } from './test-utils';

describe('Subscription registry lifecycle', () => {
  regSub('sweep-todos');
  regSub(
    'sweep-count',
    (todos) => (todos || []).length,
    () => [['sweep-todos']],
  );
  regSub(
    'sweep-cycle-a',
    (value) => value,
    () => [['sweep-cycle-b']],
  );
  regSub(
    'sweep-cycle-b',
    (value) => value,
    () => [['sweep-cycle-a']],
  );
  regSub(
    'sweep-missing-parent',
    (value) => value,
    () => [['sweep-missing-child']],
  );
  regSub('sweep-invalid-deps', () => 1, (() => undefined) as any);
  regSub(
    'sweep-lease-a',
    (todos) => todos.length,
    () => [['sweep-todos']],
  );
  regSub(
    'sweep-lease-b',
    (value) => value + 1,
    () => [['sweep-lease-a']],
  );
  regSub(
    'sweep-lease-c',
    (value) => value + 1,
    () => [['sweep-lease-b']],
  );
  regSub(
    'sweep-override',
    () => 1,
    () => [],
  );

  const countKey = JSON.stringify(['sweep-count']);
  const rootKey = JSON.stringify(['sweep-todos']);

  beforeEach(() => {
    initAppDb({ 'sweep-todos': [1, 2, 3] });
    clearSubscriptionCache();
  });

  describe('provisional subscription sweep (aborted renders)', () => {
    it('should sweep subscriptions that never went live after one full grace cycle', () => {
      // Simulates a render that never commits: the computed subscription and
      // its persistent root are created but subscribe() never runs.
      expect(getSubscriptionValue(['sweep-count'])).toBe(3);
      expect(hasCachedSubscription(countKey)).toBe(true);
      expect(hasCachedSubscription(rootKey)).toBe(true);

      // First flush cycle: still within the grace period
      sweepProvisionalSubscriptions();
      expect(hasCachedSubscription(countKey)).toBe(true);
      expect(hasCachedSubscription(rootKey)).toBe(true);

      // Second flush cycle: the computed cell is swept. Canonical roots are
      // persistent db wake-up anchors and remain registered while dormant.
      sweepProvisionalSubscriptions();
      expect(hasCachedSubscription(countKey)).toBe(false);
      expect(hasCachedSubscription(rootKey)).toBe(true);
    });

    it('should keep subscriptions that go live during the grace period', () => {
      const subscription = getOrCreateSubscription(['sweep-count'])!;
      sweepProvisionalSubscriptions();

      // Late subscribe (e.g. a slow-committing render) inside the grace cycle
      const callback = () => {};
      const unsubscribe = subscribeToSubscription(subscription, callback);

      sweepProvisionalSubscriptions();
      sweepProvisionalSubscriptions();
      expect(hasCachedSubscription(countKey)).toBe(true);
      expect(hasCachedSubscription(rootKey)).toBe(true);

      // Terminal computed cells prune immediately once unused; roots persist.
      unsubscribe();
      expect(hasCachedSubscription(countKey)).toBe(false);
      expect(hasCachedSubscription(rootKey)).toBe(true);
    });

    it('should recreate swept subscriptions transparently on the next read', () => {
      getSubscriptionValue(['sweep-count']);
      sweepProvisionalSubscriptions();
      sweepProvisionalSubscriptions();
      expect(hasCachedSubscription(countKey)).toBe(false);
      expect(hasCachedSubscription(rootKey)).toBe(true);

      // Sweeping is safe: a later read (or subscribe) recreates and recomputes
      expect(getSubscriptionValue(['sweep-count'])).toBe(3);
      expect(hasCachedSubscription(countKey)).toBe(true);
    });

    it('should sweep via the runtime scheduler without manual sweeps or db updates', async () => {
      // A render-like read on an app that never dispatches afterwards
      getSubscriptionValue(['sweep-count']);
      expect(hasCachedSubscription(countKey)).toBe(true);
      expect(hasCachedSubscription(rootKey)).toBe(true);

      // Let the self-scheduled sweep run its grace cycle and deletion cycle
      for (let i = 0; i < 3; i++) {
        await waitForAnimationFrame();
        await waitForSubscription();
      }

      expect(hasCachedSubscription(countKey)).toBe(false);
      expect(hasCachedSubscription(rootKey)).toBe(true);
    });

    it('should not sweep subscriptions that went live, via the runtime scheduler', async () => {
      const subscription = getOrCreateSubscription(['sweep-count'])!;
      const callback = () => {};
      const unsubscribe = subscribeToSubscription(subscription, callback);

      for (let i = 0; i < 3; i++) {
        await waitForAnimationFrame();
        await waitForSubscription();
      }

      expect(hasCachedSubscription(countKey)).toBe(true);
      expect(hasCachedSubscription(rootKey)).toBe(true);

      unsubscribe();
      expect(hasCachedSubscription(countKey)).toBe(false);
      expect(hasCachedSubscription(rootKey)).toBe(true);
    });

    it('should renew the complete provisional dependency tree on a cache hit', () => {
      expect(getSubscriptionValue(['sweep-lease-b'])).toBe(4);
      sweepProvisionalSubscriptions();

      // C reuses B while B and A are in their previous grace generation.
      // Renewing only B would let the next sweep dispose A underneath it.
      expect(getSubscriptionValue(['sweep-lease-c'])).toBe(5);
      sweepProvisionalSubscriptions();

      expect(hasCachedSubscription(JSON.stringify(['sweep-lease-a']))).toBe(true);
      expect(hasCachedSubscription(JSON.stringify(['sweep-lease-b']))).toBe(true);
      expect(hasCachedSubscription(JSON.stringify(['sweep-lease-c']))).toBe(true);

      const subscription = getOrCreateSubscription(['sweep-lease-c'])!;
      const unsubscribe = subscribeToSubscription(subscription, () => {});
      expect(() => unsubscribe()).not.toThrow();
      expect(hasCachedSubscription(JSON.stringify(['sweep-lease-a']))).toBe(false);
      expect(hasCachedSubscription(JSON.stringify(['sweep-lease-b']))).toBe(false);
      expect(hasCachedSubscription(JSON.stringify(['sweep-lease-c']))).toBe(false);
    });
  });

  describe('subscription key contract', () => {
    it('replaces an omitted config instead of retaining stale registration metadata', () => {
      regSub(
        'sweep-config-reset',
        () => 1,
        () => [],
        { equalityCheck: Object.is },
      );
      expect(getSubConfig('sweep-config-reset')?.equalityCheck).toBe(Object.is);

      regSub(
        'sweep-config-reset',
        () => 2,
        () => [],
      );

      expect(getSubConfig('sweep-config-reset')).toBeUndefined();
      expect(getSubscriptionValue(['sweep-config-reset'])).toBe(2);
    });

    it('supports an empty string as an explicit root source key', () => {
      regSub('sweep-empty-source', '');
      initAppDb({ '': 'empty-key-value' });

      expect(getSubscriptionValue(['sweep-empty-source'])).toBe('empty-key-value');
    });

    it('should return null when the top-level handler is missing', () => {
      expect(getOrCreateSubscription(['sweep-missing-top-level'])).toBeNull();
    });

    it('should reject handler overrides after a subscription was created', () => {
      expect(getSubscriptionValue(['sweep-override'])).toBe(1);
      expect(() =>
        regSub(
          'sweep-override',
          () => 2,
          () => [],
        ),
      ).toThrow(
        "Cannot register subscription 'sweep-override' while a cached query for that id exists",
      );
      expect(getSubscriptionValue(['sweep-override'])).toBe(1);
    });

    it('should construct a deep registered graph iteratively', () => {
      const depth = 3000;
      regSub(
        'sweep-deep-0',
        (value) => value,
        () => [['sweep-todos']],
      );
      for (let index = 1; index <= depth; index++) {
        const previous = `sweep-deep-${index - 1}`;
        regSub(
          `sweep-deep-${index}`,
          (value) => value,
          () => [[previous]],
        );
      }

      const tailKey = JSON.stringify([`sweep-deep-${depth}`]);
      expect(getSubscriptionValue([`sweep-deep-${depth}`])).toEqual([1, 2, 3]);

      // Targeted invalidation walks all cached parents iteratively.
      expect(() => clearSubscriptionCache(rootKey)).not.toThrow();
      expect(hasCachedSubscription(tailKey)).toBe(false);

      const rebuiltTail = getOrCreateSubscription([`sweep-deep-${depth}`])!;
      const unsubscribe = subscribeToSubscription(rebuiltTail, () => {});
      expect(() => unsubscribe()).not.toThrow();
      expect(hasCachedSubscription(tailKey)).toBe(false);
      clearSubscriptionCache();
    });

    it('should reject parameters on root subscriptions', () => {
      expect(() => getOrCreateSubscription(['sweep-todos', 1])).toThrow(
        "Root subscription 'sweep-todos' does not accept parameters",
      );
    });

    it('should report circular and missing dependency graphs explicitly', () => {
      expect(() => getOrCreateSubscription(['sweep-cycle-a'])).toThrow(
        'Circular subscription dependency',
      );
      expect(() => getOrCreateSubscription(['sweep-missing-parent'])).toThrow(
        "depends on missing subscription 'sweep-missing-child'",
      );
    });

    it('should validate dependency handler output at runtime', () => {
      expect(() => getOrCreateSubscription(['sweep-invalid-deps'])).toThrow(
        'dependency handler must return an array',
      );
    });

    it('should flag params that do not survive JSON serialization', () => {
      expect(hasNonSerializableSubParam([new Map()])).toBe(true);
      expect(hasNonSerializableSubParam([new Set([1])])).toBe(true);
      expect(hasNonSerializableSubParam([() => 1])).toBe(true);
      expect(hasNonSerializableSubParam([1, undefined])).toBe(true);
    });

    it('should flag non-serializable values at any nesting depth', () => {
      expect(hasNonSerializableSubParam([{ x: undefined }])).toBe(true);
      expect(hasNonSerializableSubParam([{ m: new Map() }])).toBe(true);
      expect(hasNonSerializableSubParam([[undefined]])).toBe(true);
      expect(hasNonSerializableSubParam([{ a: { b: [() => 1] } }])).toBe(true);
      expect(hasNonSerializableSubParam([{ filters: { tags: new Set() } }])).toBe(true);
    });

    it('should flag values that degrade or break JSON.stringify', () => {
      expect(hasNonSerializableSubParam([Symbol('x')])).toBe(true);
      expect(hasNonSerializableSubParam([BigInt(1)])).toBe(true);
      expect(hasNonSerializableSubParam([{ big: BigInt(1) }])).toBe(true);
      expect(hasNonSerializableSubParam([/abc/])).toBe(true);
      expect(hasNonSerializableSubParam([NaN])).toBe(true);
      expect(hasNonSerializableSubParam([Infinity])).toBe(true);
    });

    it('should detect circular structures without throwing', () => {
      const circular: any = { a: 1 };
      circular.self = circular;
      expect(hasNonSerializableSubParam([circular])).toBe(true);

      const deepCircular: any = { level1: { level2: {} } };
      deepCircular.level1.level2.back = deepCircular;
      expect(hasNonSerializableSubParam([deepCircular])).toBe(true);
    });

    it('should not flag shared (diamond) references that JSON can serialize', () => {
      const shared = { id: 1 };
      expect(hasNonSerializableSubParam([{ x: shared, y: shared }])).toBe(false);
      expect(hasNonSerializableSubParam([[shared, shared]])).toBe(false);
    });

    it('should accept plain serializable params', () => {
      expect(hasNonSerializableSubParam([])).toBe(false);
      expect(hasNonSerializableSubParam([1, 'a', true, null])).toBe(false);
      expect(hasNonSerializableSubParam([{ id: 1 }, [1, 2]])).toBe(false);
      expect(hasNonSerializableSubParam([{ a: { b: [1, 'x', null] } }])).toBe(false);
      expect(hasNonSerializableSubParam([new Date(0)])).toBe(false); // has toJSON
    });
  });
});
