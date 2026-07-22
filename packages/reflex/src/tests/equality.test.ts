import { shallowEqual } from '../core/equality';
import {
  clearSubscriptionCache,
  flushSubscriptions,
  getOrCreateSubscription,
  getSubscriptionSnapshot,
  initState,
  regSub,
  subscribeToSubscription,
  updateState,
} from './runtime-test-api';

describe('shallowEqual', () => {
  it('should compare primitives with Object.is semantics', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(NaN, NaN)).toBe(true);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(undefined, undefined)).toBe(true);
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual(0, -0)).toBe(false);
    expect(shallowEqual(null, undefined)).toBe(false);
    expect(shallowEqual(1, '1')).toBe(false);
  });

  it('should compare arrays one level deep', () => {
    const row = { id: 1 };
    expect(shallowEqual([row, 2], [row, 2])).toBe(true);
    expect(shallowEqual([], [])).toBe(true);
    expect(shallowEqual([row], [{ id: 1 }])).toBe(false); // different element identity
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(shallowEqual([1], { 0: 1, length: 1 })).toBe(false);
  });

  it('should compare plain objects one level deep', () => {
    const nested = { x: 1 };
    expect(shallowEqual({ a: nested, b: 2 }, { a: nested, b: 2 })).toBe(true);
    expect(shallowEqual({}, {})).toBe(true);
    expect(shallowEqual({ a: nested }, { a: { x: 1 } })).toBe(false); // different value identity
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('should treat identical references as equal', () => {
    const value = { rows: [1, 2, 3] };
    expect(shallowEqual(value, value)).toBe(true);
  });
});

describe('per-sub equalityCheck config with shallowEqual', () => {
  regSub('se-items');
  regSub(
    'se-mapped',
    (items: number[]) => items.map((n) => n),
    () => [['se-items']],
    { equalityCheck: shallowEqual },
  );
  regSub(
    'se-always-changed',
    (items: number[]) => items.length,
    () => [['se-items']],
    { equalityCheck: () => false },
  );

  beforeEach(() => {
    clearSubscriptionCache();
    initState({ 'se-items': [1, 2, 3] });
  });

  it('should gate recompute propagation with the configured check', () => {
    const subscription = getOrCreateSubscription(['se-mapped'])!;
    const callback = jest.fn();
    const unsubscribe = subscribeToSubscription(subscription, callback);

    const first = getSubscriptionSnapshot(subscription);
    expect(first).toEqual([1, 2, 3]);

    // Publish a fresh root identity with unchanged elements. The mapped sub
    // creates a different array, but shallowEqual gates observable propagation.
    updateState({ 'se-items': [1, 2, 3] });
    flushSubscriptions();

    expect(callback).not.toHaveBeenCalled();
    // The cached value keeps its identity for downstream consumers
    expect(getSubscriptionSnapshot(subscription)).toBe(first);

    unsubscribe();
  });

  it('should not apply a hidden identity gate over a configured comparator', () => {
    const subscription = getOrCreateSubscription(['se-always-changed'])!;
    const callback = jest.fn();
    const unsubscribe = subscribeToSubscription(subscription, callback);
    expect(getSubscriptionSnapshot(subscription)).toBe(3);

    updateState({ 'se-items': [1, 2, 3] });
    flushSubscriptions();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(getSubscriptionSnapshot(subscription)).toBe(3);
    unsubscribe();
  });

  it('should warn and use the global comparator for an invalid JS equalityCheck', () => {
    regSub(
      'se-invalid-equality',
      (items: number[]) => items.map((item) => item),
      () => [['se-items']],
      { equalityCheck: false } as any,
    );
    const subscription = getOrCreateSubscription(['se-invalid-equality'])!;
    const callback = jest.fn();
    const unsubscribe = subscribeToSubscription(subscription, callback);
    const first = getSubscriptionSnapshot(subscription);

    updateState({ 'se-items': [1, 2, 3] });
    flushSubscriptions();

    expectLogCall(
      'warn',
      "[reflex] Subscription 'se-invalid-equality' equalityCheck must be a function. Using the global equality check.",
    );
    expect(callback).not.toHaveBeenCalled();
    expect(getSubscriptionSnapshot(subscription)).toBe(first);
    unsubscribe();
  });
});
