import type { Interceptor } from '../types';

let globalInterceptors: Interceptor[] = [];

/** Register or replace a global interceptor while preserving its position. */
export function regGlobalInterceptor(interceptor: Interceptor): void {
  const existingIndex = globalInterceptors.findIndex(({ id }) => id === interceptor.id);
  if (existingIndex === -1) {
    globalInterceptors = [...globalInterceptors, interceptor];
    return;
  }

  globalInterceptors = globalInterceptors.map((existing, index) =>
    index === existingIndex ? interceptor : existing,
  );
}

/** Return a snapshot of the registered global interceptors. */
export function getGlobalInterceptors(): Interceptor[] {
  return [...globalInterceptors];
}

/** Clear every global interceptor, or only the interceptor with `id`. */
export function clearGlobalInterceptors(): void;
export function clearGlobalInterceptors(id: string): void;
export function clearGlobalInterceptors(id?: string): void {
  globalInterceptors =
    id === undefined ? [] : globalInterceptors.filter((interceptor) => interceptor.id !== id);
}
