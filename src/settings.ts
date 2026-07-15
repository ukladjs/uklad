import isEqual from 'fast-deep-equal';
import type { EqualityCheckFn, Interceptor } from './types';

let globalInterceptors: Interceptor[] = [];
let globalEqualityCheck: EqualityCheckFn = isEqual;

/**
 * Register a global interceptor
 */
export function regGlobalInterceptor(interceptor: Interceptor): void {
  const existingIndex = globalInterceptors.findIndex(({ id }) => id === interceptor.id);
  if (existingIndex === -1) {
    globalInterceptors = [...globalInterceptors, interceptor];
    return;
  }

  // Replace in place to preserve interceptor ordering during hot reload.
  globalInterceptors = globalInterceptors.map((existing, index) =>
    index === existingIndex ? interceptor : existing,
  );
}

/**
 * Get all global interceptors
 */
export function getGlobalInterceptors(): Interceptor[] {
  return [...globalInterceptors];
}

/**
 * Clear global interceptors - either all or by specific ID
 */
export function clearGlobalInterceptors(): void;
export function clearGlobalInterceptors(id: string): void;
export function clearGlobalInterceptors(id?: string): void {
  if (id === undefined) {
    globalInterceptors = [];
  } else {
    globalInterceptors = globalInterceptors.filter((interceptor) => interceptor.id !== id);
  }
}

/**
 * Set the global equality check function used for subscription value comparisons
 */
export function setGlobalEqualityCheck(equalityCheck: EqualityCheckFn): void {
  globalEqualityCheck = equalityCheck;
}

/**
 * Get the current global equality check function
 */
export function getGlobalEqualityCheck(): EqualityCheckFn {
  return globalEqualityCheck;
}
