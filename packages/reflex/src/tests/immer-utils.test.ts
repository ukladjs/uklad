import { enableMapSet, original, current } from '../core/immer';
import { getGlobalEqualityCheck, setGlobalEqualityCheck } from '../core/equality';
import { createReflexRuntime, defaultRuntime } from '../runtime/runtime';
import isEqual from 'fast-deep-equal';
import isEqualEs6 from 'fast-deep-equal/es6/index.js';

describe('immer-utils', () => {
  describe('enableMapSet', () => {
    beforeEach(() => {
      setGlobalEqualityCheck(isEqual);
    });

    it('upgrades untouched explicit runtimes when the default runtime has an override', () => {
      const runtime = createReflexRuntime({
        initialDb: {},
        runtimeId: 'map-set-explicit-runtime',
      });
      const customDefaultEquality = () => false;
      defaultRuntime.setGlobalEqualityCheck(customDefaultEquality);

      const left = new Map([['value', 1]]);
      const right = new Map([['value', 2]]);
      expect(runtime.getGlobalEqualityCheck()(left, right)).toBe(true);

      enableMapSet();

      expect(defaultRuntime.getGlobalEqualityCheck()).toBe(customDefaultEquality);
      expect(runtime.getGlobalEqualityCheck()(left, right)).toBe(false);
      runtime.dispose();
    });

    it('should update global equality check to isEqualEs6 when current check is default isEqual', () => {
      expect(getGlobalEqualityCheck()).toBe(isEqual);

      enableMapSet();

      expect(getGlobalEqualityCheck()).toBe(isEqualEs6);
    });

    it('should NOT override custom equality check when user has set one', () => {
      const customEquality = () => true;
      setGlobalEqualityCheck(customEquality);

      expect(getGlobalEqualityCheck()).toBe(customEquality);

      enableMapSet();

      expect(getGlobalEqualityCheck()).toBe(customEquality);
      expect(getGlobalEqualityCheck()).not.toBe(isEqualEs6);
    });

    it('should handle Map and Set equality correctly after enableMapSet is called', () => {
      const map1 = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);
      const map2 = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);
      const set1 = new Set(['a', 'b', 'c']);
      const set2 = new Set(['a', 'b', 'c']);
      const map3 = new Map([
        ['key1', 'value1'],
        ['key2', 'different'],
      ]);
      const set3 = new Set(['a', 'b', 'd']);

      // The default comparator treats all Map and Set instances as equivalent.
      let equalityCheck = getGlobalEqualityCheck();

      expect(equalityCheck(map1, map2)).toBe(true);
      expect(equalityCheck(set1, set2)).toBe(true);
      expect(equalityCheck(map1, map3)).toBe(true);
      expect(equalityCheck(set1, set3)).toBe(true);

      enableMapSet();

      // The ES6 comparator inspects Map and Set contents.
      equalityCheck = getGlobalEqualityCheck();

      expect(equalityCheck(map1, map2)).toBe(true);
      expect(equalityCheck(set1, set2)).toBe(true);
      expect(equalityCheck(map1, map3)).toBe(false);
      expect(equalityCheck(set1, set3)).toBe(false);
    });
  });

  describe('original', () => {
    it('should return original value for non-draft values', () => {
      const obj = { a: 1, b: 2 };
      expect(original(obj)).toBe(obj);
    });

    it('should return original value for primitive values', () => {
      expect(original(42)).toBe(42);
      expect(original('hello')).toBe('hello');
      expect(original(null)).toBe(null);
      expect(original(undefined)).toBe(undefined);
    });
  });

  describe('current', () => {
    it('should return current value for non-draft values', () => {
      const obj = { a: 1, b: 2 };
      expect(current(obj)).toBe(obj);
    });

    it('should return current value for primitive values', () => {
      expect(current(42)).toBe(42);
      expect(current('hello')).toBe('hello');
      expect(current(null)).toBe(null);
      expect(current(undefined)).toBe(undefined);
    });
  });
});
