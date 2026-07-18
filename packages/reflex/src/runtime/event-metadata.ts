import type { Id, Interceptor } from '../types';
import { defaultRuntimeScope, type RuntimeScope } from './scope';

const EMPTY_INTERCEPTORS: readonly Interceptor[] = Object.freeze([]);
const interceptorStates = new WeakMap<RuntimeScope, Map<Id, readonly Interceptor[]>>();

function getInterceptorState(runtime: RuntimeScope): Map<Id, readonly Interceptor[]> {
  let state = interceptorStates.get(runtime);
  if (!state) {
    state = new Map();
    interceptorStates.set(runtime, state);
  }
  return state;
}

export function getInterceptors(eventId: Id): readonly Interceptor[] {
  return getInterceptorsForRuntime(defaultRuntimeScope, eventId);
}

/** @internal Return event interceptors owned by one runtime. */
export function getInterceptorsForRuntime(
  runtime: RuntimeScope,
  eventId: Id,
): readonly Interceptor[] {
  return getInterceptorState(runtime).get(eventId) ?? EMPTY_INTERCEPTORS;
}

export function setInterceptors(eventId: Id, interceptors: readonly Interceptor[]): void {
  setInterceptorsForRuntime(defaultRuntimeScope, eventId, interceptors);
}

/** @internal Replace event interceptors in one runtime. */
export function setInterceptorsForRuntime(
  runtime: RuntimeScope,
  eventId: Id,
  interceptors: readonly Interceptor[],
): void {
  getInterceptorState(runtime).set(eventId, Object.freeze([...interceptors]));
}

export function clearInterceptors(): void;
export function clearInterceptors(eventId: Id): void;
export function clearInterceptors(eventId?: Id): void {
  clearInterceptorsForRuntime(defaultRuntimeScope, eventId);
}

/** @internal Clear event interceptor metadata in one runtime. */
export function clearInterceptorsForRuntime(runtime: RuntimeScope, eventId?: Id): void {
  const state = getInterceptorState(runtime);
  if (eventId === undefined) {
    state.clear();
  } else {
    state.delete(eventId);
  }
}
