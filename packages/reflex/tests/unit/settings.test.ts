import {
  clearInterceptors,
  getEqualityCheck,
  getInterceptors,
  regInterceptor,
  setEqualityCheck,
} from './runtime-test-api';
import type { Interceptor, Context, EqualityCheckFn } from '../../src/types';

beforeEach(() => {
  clearInterceptors();
});

describe('Global Interceptors', () => {
  const createTestInterceptor = (id: string): Interceptor => ({
    id,
    before: (context: Context) => context,
    after: (context: Context) => context,
  });

  describe('regInterceptor', () => {
    it('should register a new global interceptor', () => {
      const interceptor = createTestInterceptor('test-1');

      regInterceptor(interceptor);

      const globals = getInterceptors();
      expect(globals).toHaveLength(1);
      expect(globals[0]).toEqual(interceptor);
    });

    it('should register multiple global interceptors', () => {
      const interceptor1 = createTestInterceptor('test-1');
      const interceptor2 = createTestInterceptor('test-2');

      regInterceptor(interceptor1);
      regInterceptor(interceptor2);

      const globals = getInterceptors();
      expect(globals).toHaveLength(2);
      expect(globals[0]).toEqual(interceptor1);
      expect(globals[1]).toEqual(interceptor2);
    });

    it('should reject an interceptor with an existing ID', () => {
      const interceptor1 = createTestInterceptor('test-1');
      const interceptor2 = createTestInterceptor('test-2');
      const interceptor1Updated = { ...createTestInterceptor('test-1'), comment: 'updated' };

      regInterceptor(interceptor1);
      regInterceptor(interceptor2);
      expect(() => regInterceptor(interceptor1Updated)).toThrow(
        "Registration 'test-1' is already registered",
      );

      const globals = getInterceptors();
      expect(globals).toHaveLength(2);
      expect(globals[0]).toEqual(interceptor1);
      expect(globals[1]).toEqual(interceptor2);
    });
  });

  describe('getInterceptors', () => {
    it('should return empty array when no interceptors registered', () => {
      const globals = getInterceptors();
      expect(globals).toEqual([]);
    });

    it('should return copy of interceptors array', () => {
      const interceptor = createTestInterceptor('test-1');
      regInterceptor(interceptor);

      const globals1 = getInterceptors();
      const globals2 = getInterceptors();

      expect(globals1).toEqual(globals2);
      expect(globals1).not.toBe(globals2);
    });
  });

  describe('clearInterceptors', () => {
    it('should clear all global interceptors when called without arguments', () => {
      const interceptor1 = createTestInterceptor('test-1');
      const interceptor2 = createTestInterceptor('test-2');

      regInterceptor(interceptor1);
      regInterceptor(interceptor2);
      expect(getInterceptors()).toHaveLength(2);

      clearInterceptors();
      expect(getInterceptors()).toEqual([]);
    });

    it('should clear specific interceptor by ID', () => {
      const interceptor1 = createTestInterceptor('test-1');
      const interceptor2 = createTestInterceptor('test-2');
      const interceptor3 = createTestInterceptor('test-3');

      regInterceptor(interceptor1);
      regInterceptor(interceptor2);
      regInterceptor(interceptor3);
      expect(getInterceptors()).toHaveLength(3);

      clearInterceptors('test-2');

      const globals = getInterceptors();
      expect(globals).toHaveLength(2);
      expect(globals.map((i) => i.id)).toEqual(['test-1', 'test-3']);
    });

    it('should handle clearing non-existent interceptor ID gracefully', () => {
      const interceptor1 = createTestInterceptor('test-1');
      regInterceptor(interceptor1);

      clearInterceptors('non-existent');

      const globals = getInterceptors();
      expect(globals).toHaveLength(1);
      expect(globals[0]).toEqual(interceptor1);
    });
  });

  describe('Global Equality Check', () => {
    it('should have default equality check that is isEqual', () => {
      const defaultCheck = getEqualityCheck();
      expect(defaultCheck({ a: 1 }, { a: 1 })).toBe(true);
      expect(defaultCheck({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('should allow setting custom equality check', () => {
      const customEquality: EqualityCheckFn = (a, b) => a === b;
      setEqualityCheck(customEquality);

      const currentCheck = getEqualityCheck();
      expect(currentCheck).toBe(customEquality);
      expect(currentCheck(1, 1)).toBe(true);
      expect(currentCheck(1, 2)).toBe(false);
      expect(currentCheck({ a: 1 }, { a: 1 })).toBe(false);
    });

    it('should allow setting always-equal check', () => {
      const alwaysEqual: EqualityCheckFn = () => true;
      setEqualityCheck(alwaysEqual);

      const currentCheck = getEqualityCheck();
      expect(currentCheck({ a: 1 }, { a: 2 })).toBe(true);
      expect(currentCheck('hello', 'world')).toBe(true);
    });

    it('should allow setting never-equal check', () => {
      const neverEqual: EqualityCheckFn = () => false;
      setEqualityCheck(neverEqual);

      const currentCheck = getEqualityCheck();
      expect(currentCheck({ a: 1 }, { a: 1 })).toBe(false);
      expect(currentCheck('hello', 'hello')).toBe(false);
    });
  });
});
