import {
  regGlobalInterceptor,
  getGlobalInterceptors,
  clearGlobalInterceptors,
  setGlobalEqualityCheck,
  getGlobalEqualityCheck,
} from '../settings';
import type { Interceptor, Context, EqualityCheckFn } from '../types';

beforeEach(() => {
  clearGlobalInterceptors();
});

describe('Global Interceptors', () => {
  const createTestInterceptor = (id: string): Interceptor => ({
    id,
    before: (context: Context) => context,
    after: (context: Context) => context,
  });

  describe('regGlobalInterceptor', () => {
    it('should register a new global interceptor', () => {
      const interceptor = createTestInterceptor('test-1');

      regGlobalInterceptor(interceptor);

      const globals = getGlobalInterceptors();
      expect(globals).toHaveLength(1);
      expect(globals[0]).toEqual(interceptor);
    });

    it('should register multiple global interceptors', () => {
      const interceptor1 = createTestInterceptor('test-1');
      const interceptor2 = createTestInterceptor('test-2');

      regGlobalInterceptor(interceptor1);
      regGlobalInterceptor(interceptor2);

      const globals = getGlobalInterceptors();
      expect(globals).toHaveLength(2);
      expect(globals[0]).toEqual(interceptor1);
      expect(globals[1]).toEqual(interceptor2);
    });

    it('should replace existing interceptor with same ID and maintain order', () => {
      const interceptor1 = createTestInterceptor('test-1');
      const interceptor2 = createTestInterceptor('test-2');
      const interceptor1Updated = { ...createTestInterceptor('test-1'), comment: 'updated' };

      regGlobalInterceptor(interceptor1);
      regGlobalInterceptor(interceptor2);
      regGlobalInterceptor(interceptor1Updated);

      const globals = getGlobalInterceptors();
      expect(globals).toHaveLength(2);
      expect(globals[0]).toEqual(interceptor1Updated);
      expect(globals[1]).toEqual(interceptor2);
    });
  });

  describe('getGlobalInterceptors', () => {
    it('should return empty array when no interceptors registered', () => {
      const globals = getGlobalInterceptors();
      expect(globals).toEqual([]);
    });

    it('should return copy of interceptors array', () => {
      const interceptor = createTestInterceptor('test-1');
      regGlobalInterceptor(interceptor);

      const globals1 = getGlobalInterceptors();
      const globals2 = getGlobalInterceptors();

      expect(globals1).toEqual(globals2);
      expect(globals1).not.toBe(globals2); // Different instances
    });
  });

  describe('clearGlobalInterceptors', () => {
    it('should clear all global interceptors when called without arguments', () => {
      const interceptor1 = createTestInterceptor('test-1');
      const interceptor2 = createTestInterceptor('test-2');

      regGlobalInterceptor(interceptor1);
      regGlobalInterceptor(interceptor2);
      expect(getGlobalInterceptors()).toHaveLength(2);

      clearGlobalInterceptors();
      expect(getGlobalInterceptors()).toEqual([]);
    });

    it('should clear specific interceptor by ID', () => {
      const interceptor1 = createTestInterceptor('test-1');
      const interceptor2 = createTestInterceptor('test-2');
      const interceptor3 = createTestInterceptor('test-3');

      regGlobalInterceptor(interceptor1);
      regGlobalInterceptor(interceptor2);
      regGlobalInterceptor(interceptor3);
      expect(getGlobalInterceptors()).toHaveLength(3);

      clearGlobalInterceptors('test-2');

      const globals = getGlobalInterceptors();
      expect(globals).toHaveLength(2);
      expect(globals.map((i) => i.id)).toEqual(['test-1', 'test-3']);
    });

    it('should handle clearing non-existent interceptor ID gracefully', () => {
      const interceptor1 = createTestInterceptor('test-1');
      regGlobalInterceptor(interceptor1);

      clearGlobalInterceptors('non-existent');

      const globals = getGlobalInterceptors();
      expect(globals).toHaveLength(1);
      expect(globals[0]).toEqual(interceptor1);
    });
  });

  describe('Global Equality Check', () => {
    it('should have default equality check that is isEqual', () => {
      const defaultCheck = getGlobalEqualityCheck();
      expect(defaultCheck({ a: 1 }, { a: 1 })).toBe(true);
      expect(defaultCheck({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('should allow setting custom equality check', () => {
      const customEquality: EqualityCheckFn = (a, b) => a === b;
      setGlobalEqualityCheck(customEquality);

      const currentCheck = getGlobalEqualityCheck();
      expect(currentCheck).toBe(customEquality);
      expect(currentCheck(1, 1)).toBe(true);
      expect(currentCheck(1, 2)).toBe(false);
      expect(currentCheck({ a: 1 }, { a: 1 })).toBe(false); // Reference equality, not deep equality
    });

    it('should allow setting always-equal check', () => {
      const alwaysEqual: EqualityCheckFn = () => true;
      setGlobalEqualityCheck(alwaysEqual);

      const currentCheck = getGlobalEqualityCheck();
      expect(currentCheck({ a: 1 }, { a: 2 })).toBe(true);
      expect(currentCheck('hello', 'world')).toBe(true);
    });

    it('should allow setting never-equal check', () => {
      const neverEqual: EqualityCheckFn = () => false;
      setGlobalEqualityCheck(neverEqual);

      const currentCheck = getGlobalEqualityCheck();
      expect(currentCheck({ a: 1 }, { a: 1 })).toBe(false);
      expect(currentCheck('hello', 'hello')).toBe(false);
    });
  });
});
