import { shallowEqual } from '../../src/core/equality';
import { enableMapSet, original, current, produce } from '../../src/core/immer';
import {
  createUkladRuntimeForTests as createUkladRuntime,
  getRuntimeAdminForTests,
  getRuntimeCoreForTests,
} from '../../src/runtime/runtime';

const getEqualityCheck = (runtime: Parameters<typeof getRuntimeCoreForTests>[0]) =>
  getRuntimeCoreForTests(runtime).subscriptions.equalityCheck;

describe('immer-utils', () => {
  describe('enableMapSet', () => {
    it('keeps equality overrides isolated between explicit runtimes', () => {
      const runtime = createUkladRuntime({
        initialState: {},
        runtimeId: 'map-set-explicit-runtime',
      });
      const customRuntimeEquality = () => true;
      getRuntimeAdminForTests(runtime).setEqualityCheck(customRuntimeEquality);

      enableMapSet();

      expect(getEqualityCheck(runtime)).toBe(customRuntimeEquality);
      runtime.dispose();
    });

    it('keeps the safe shallow fallback for runtimes created after it is enabled', () => {
      enableMapSet();
      const runtime = createUkladRuntime({
        initialState: {},
        runtimeId: 'map-set-default-runtime',
      });
      expect(getEqualityCheck(runtime)).toBe(shallowEqual);
      runtime.dispose();
    });

    it('enables Immer updates for Map and Set values', () => {
      enableMapSet();

      const base = {
        rows: new Map([['one', 1]]),
        selected: new Set(['one']),
      };
      const next = produce(base, (draft) => {
        draft.rows.set('two', 2);
        draft.selected.add('two');
      });

      expect(next.rows).not.toBe(base.rows);
      expect(next.rows.get('two')).toBe(2);
      expect(next.selected).not.toBe(base.selected);
      expect(next.selected.has('two')).toBe(true);
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
