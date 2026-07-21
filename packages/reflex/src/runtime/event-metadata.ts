import type { Id, Interceptor } from '../types';
import { createRuntimeStateKey, getOrCreateRuntimeState, type RuntimeKernel } from './kernel';

const EMPTY_INTERCEPTORS: readonly Interceptor[] = Object.freeze([]);
const INTERCEPTOR_STATE = createRuntimeStateKey<Map<Id, readonly Interceptor[]>>(
  'reflex.event-interceptors',
);

function getInterceptorState(runtime: RuntimeKernel): Map<Id, readonly Interceptor[]> {
  return getOrCreateRuntimeState(runtime, INTERCEPTOR_STATE, () => new Map());
}

/** @internal Return event interceptors owned by one runtime. */
export function getInterceptorsForKernel(
  runtime: RuntimeKernel,
  eventId: Id,
): readonly Interceptor[] {
  return getInterceptorState(runtime).get(eventId) ?? EMPTY_INTERCEPTORS;
}

/** @internal Replace event interceptors in one runtime. */
export function setInterceptorsForKernel(
  runtime: RuntimeKernel,
  eventId: Id,
  interceptors: readonly Interceptor[],
): void {
  getInterceptorState(runtime).set(eventId, Object.freeze([...interceptors]));
}

/** @internal Clear event interceptor metadata in one runtime. */
export function clearInterceptorsForKernel(runtime: RuntimeKernel, eventId?: Id): void {
  const state = getInterceptorState(runtime);
  if (eventId === undefined) {
    state.clear();
  } else {
    state.delete(eventId);
  }
}
