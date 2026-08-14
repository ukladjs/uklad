import { shallowEqual } from '../../src/core/equality';
import {
  clearSubscriptionCache,
  flushSubscriptions,
  getOrCreateSubscription,
  getSubscriptionSnapshot,
  initState,
  regRootSub,
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

    const sparse = new Array(1);
    expect(shallowEqual(sparse, new Array(1))).toBe(true);
    expect(shallowEqual(sparse, [undefined])).toBe(false);
  });

  it('should compare plain objects one level deep', () => {
    const nested = { x: 1 };
    expect(shallowEqual({ a: nested, b: 2 }, { a: nested, b: 2 })).toBe(true);
    expect(shallowEqual({}, {})).toBe(true);
    expect(shallowEqual({ a: nested }, { a: { x: 1 } })).toBe(false); // different value identity
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('should compare enumerable symbols and preserve plain-object prototype boundaries', () => {
    const key = Symbol('key');
    expect(shallowEqual({ [key]: 1 }, { [key]: 1 })).toBe(true);
    expect(shallowEqual({ [key]: 1 }, { [key]: 2 })).toBe(false);
    expect(shallowEqual({ [Symbol('key')]: 1 }, { [Symbol('key')]: 1 })).toBe(false);

    const nullPrototypeLeft = Object.assign(Object.create(null), { value: 1 });
    const nullPrototypeRight = Object.assign(Object.create(null), { value: 1 });
    expect(shallowEqual(nullPrototypeLeft, nullPrototypeRight)).toBe(true);
    expect(shallowEqual(nullPrototypeLeft, { value: 1 })).toBe(false);
  });

  it('should compare Maps by native key identity and shallow value identity', () => {
    const row = { id: 1 };
    expect(shallowEqual(new Map([['row', row]]), new Map([['row', row]]))).toBe(true);
    expect(shallowEqual(new Map([['row', row]]), new Map([['row', { id: 1 }]]))).toBe(false);
    expect(shallowEqual(new Map([['row', 1]]), new Map([['row', 2]]))).toBe(false);

    const key = { id: 'row' };
    expect(shallowEqual(new Map([[key, 1]]), new Map([[key, 1]]))).toBe(true);
    expect(shallowEqual(new Map([[{ id: 'row' }, 1]]), new Map([[{ id: 'row' }, 1]]))).toBe(false);
  });

  it('should compare Sets with native membership semantics', () => {
    expect(shallowEqual(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(shallowEqual(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false);

    const row = { id: 1 };
    expect(shallowEqual(new Set([row]), new Set([row]))).toBe(true);
    expect(shallowEqual(new Set([{ id: 1 }]), new Set([{ id: 1 }]))).toBe(false);
  });

  it('should compare typed arrays of the same type one level deep', () => {
    expect(shallowEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(shallowEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(shallowEqual(new Uint8Array([1]), new Int8Array([1]))).toBe(false);
    expect(shallowEqual(new Float32Array([NaN]), new Float32Array([NaN]))).toBe(true);
  });

  it('should conservatively reject distinct unsupported object types', () => {
    class Box {
      readonly value: number;

      constructor(value: number) {
        this.value = value;
      }
    }
    class Rows extends Array<number> {}
    class Lookup extends Map<string, number> {}
    class Bytes extends Uint8Array {}

    expect(shallowEqual(new Date(0), new Date(0))).toBe(false);
    expect(shallowEqual(/value/u, /value/u)).toBe(false);
    expect(shallowEqual(Promise.resolve(1), Promise.resolve(1))).toBe(false);
    expect(shallowEqual(new WeakMap(), new WeakMap())).toBe(false);
    expect(shallowEqual(new DataView(new ArrayBuffer(1)), new DataView(new ArrayBuffer(1)))).toBe(
      false,
    );
    expect(shallowEqual(new Box(1), new Box(1))).toBe(false);
    expect(shallowEqual(new Rows(1), new Rows(1))).toBe(false);
    expect(shallowEqual(new Lookup([['one', 1]]), new Lookup([['one', 1]]))).toBe(false);
    expect(shallowEqual(new Bytes([1]), new Bytes([1]))).toBe(false);
  });

  it('should fall back to unequal when a value cannot be inspected', () => {
    const unreadable = Object.defineProperty({}, 'value', {
      enumerable: true,
      get(): never {
        throw new Error('unreadable');
      },
    });

    expect(() => shallowEqual(unreadable, { value: 1 })).not.toThrow();
    expect(shallowEqual(unreadable, { value: 1 })).toBe(false);
  });

  it('should treat identical references as equal', () => {
    const value = { rows: [1, 2, 3] };
    expect(shallowEqual(value, value)).toBe(true);
  });
});

describe('per-sub equalityCheck config with shallowEqual', () => {
  regRootSub('se-items', 'se-items');
  regSub(
    'se-mapped',
    () => [['se-items']],
    ([items]: [number[]]) => items.map((n) => n),
    { equalityCheck: shallowEqual },
  );
  regSub(
    'se-always-changed',
    () => [['se-items']],
    ([items]: [number[]]) => items.length,
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
      () => [['se-items']],
      ([items]: [number[]]) => items.map((item) => item),
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
      "[uklad] Subscription 'se-invalid-equality' equalityCheck must be a function. Using the global equality check.",
    );
    expect(callback).not.toHaveBeenCalled();
    expect(getSubscriptionSnapshot(subscription)).toBe(first);
    unsubscribe();
  });
});
