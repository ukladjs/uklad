import type { Id, Interceptor } from '../types';
import { createRuntimeStateKey, getOrCreateRuntimeState, type RuntimeScope } from './scope';

const EMPTY_INTERCEPTORS: readonly Interceptor[] = Object.freeze([]);
const INTERCEPTOR_STATE = createRuntimeStateKey<Map<Id, readonly Interceptor[]>>(
  'reflex.event-interceptors',
);

function getInterceptorState(runtime: RuntimeScope): Map<Id, readonly Interceptor[]> {
  return getOrCreateRuntimeState(runtime, INTERCEPTOR_STATE, () => new Map());
}

/** @internal Return event interceptors owned by one runtime. */
export function getInterceptorsForRuntime(
  runtime: RuntimeScope,
  eventId: Id,
): readonly Interceptor[] {
  return getInterceptorState(runtime).get(eventId) ?? EMPTY_INTERCEPTORS;
}

/** @internal Replace event interceptors in one runtime. */
export function setInterceptorsForRuntime(
  runtime: RuntimeScope,
  eventId: Id,
  interceptors: readonly Interceptor[],
): void {
  getInterceptorState(runtime).set(eventId, Object.freeze([...interceptors]));
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
