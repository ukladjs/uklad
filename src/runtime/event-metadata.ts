import type { Id, Interceptor } from '../types';

const EMPTY_INTERCEPTORS: readonly Interceptor[] = Object.freeze([]);
const interceptorsByEvent = new Map<Id, readonly Interceptor[]>();

export function getInterceptors(eventId: Id): readonly Interceptor[] {
  return interceptorsByEvent.get(eventId) ?? EMPTY_INTERCEPTORS;
}

export function setInterceptors(eventId: Id, interceptors: readonly Interceptor[]): void {
  interceptorsByEvent.set(eventId, Object.freeze([...interceptors]));
}

export function clearInterceptors(): void;
export function clearInterceptors(eventId: Id): void;
export function clearInterceptors(eventId?: Id): void {
  if (eventId === undefined) {
    interceptorsByEvent.clear();
  } else {
    interceptorsByEvent.delete(eventId);
  }
}
