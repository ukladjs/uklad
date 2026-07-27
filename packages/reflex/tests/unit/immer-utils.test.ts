import { enableMapSet, original, current } from '../../src/core/immer';
import {
  createReflexRuntimeForTests as createReflexRuntime,
  getRuntimeAdminForTests,
  getRuntimeCoreForTests,
} from '../../src/runtime/runtime';
import isEqualEs6 from 'fast-deep-equal/es6/index.js';

const getEqualityCheck = (runtime: Parameters<typeof getRuntimeCoreForTests>[0]) =>
  getRuntimeCoreForTests(runtime).subscriptions.equalityCheck;

describe('immer-utils', () => {
  describe('enableMapSet', () => {
    it('keeps equality overrides isolated between explicit runtimes', () => {
      const runtime = createReflexRuntime({
        initialState: {},
        runtimeId: 'map-set-explicit-runtime',
      });
      const customRuntimeEquality = () => true;
      getRuntimeAdminForTests(runtime).setEqualityCheck(customRuntimeEquality);

      enableMapSet();

      expect(getEqualityCheck(runtime)).toBe(customRuntimeEquality);
      runtime.dispose();
    });

    it('uses the ES6 equality fallback for runtimes created after Map and Set support is enabled', () => {
      enableMapSet();
      const runtime = createReflexRuntime({
        initialState: {},
        runtimeId: 'map-set-default-runtime',
      });
      expect(getEqualityCheck(runtime)).toBe(isEqualEs6);
      runtime.dispose();
    });

    it('does not override a custom equality check when Map and Set support is enabled', () => {
      const runtime = createReflexRuntime({
        initialState: {},
        runtimeId: 'map-set-custom-runtime',
      });
      const customEquality = () => true;
      getRuntimeAdminForTests(runtime).setEqualityCheck(customEquality);

      enableMapSet();

      expect(getEqualityCheck(runtime)).toBe(customEquality);
      expect(getEqualityCheck(runtime)).not.toBe(isEqualEs6);
      runtime.dispose();
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

      enableMapSet();
      const runtime = createReflexRuntime({
        initialState: {},
        runtimeId: 'map-set-values-runtime',
      });
      const equalityCheck = getEqualityCheck(runtime);

      expect(equalityCheck(map1, map2)).toBe(true);
      expect(equalityCheck(set1, set2)).toBe(true);
      expect(equalityCheck(map1, map3)).toBe(false);
      expect(equalityCheck(set1, set3)).toBe(false);
      runtime.dispose();
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
