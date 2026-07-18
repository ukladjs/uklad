import type { Interceptor } from '../types';
import { defaultRuntimeScope, type RuntimeScope } from '../runtime/scope';

interface GlobalInterceptorState {
  interceptors: Interceptor[];
  readonly versions: Map<string, number>;
  nextVersion: number;
}

const interceptorStates = new WeakMap<RuntimeScope, GlobalInterceptorState>();

function getInterceptorState(runtime: RuntimeScope): GlobalInterceptorState {
  let state = interceptorStates.get(runtime);
  if (!state) {
    state = { interceptors: [], versions: new Map(), nextVersion: 0 };
    interceptorStates.set(runtime, state);
  }
  return state;
}

function bumpVersion(state: GlobalInterceptorState, id: string): number {
  const version = ++state.nextVersion;
  state.versions.set(id, version);
  return version;
}

/** Register or replace a global interceptor while preserving its position. */
export function regGlobalInterceptor(interceptor: Interceptor): void {
  regGlobalInterceptorForRuntime(defaultRuntimeScope, interceptor);
}

/** @internal Register an interceptor in one runtime. */
export function regGlobalInterceptorForRuntime(
  runtime: RuntimeScope,
  interceptor: Interceptor,
): void {
  const state = getInterceptorState(runtime);
  const globalInterceptors = state.interceptors;
  const existingIndex = globalInterceptors.findIndex(({ id }) => id === interceptor.id);
  if (existingIndex === -1) {
    state.interceptors = [...globalInterceptors, interceptor];
    bumpVersion(state, interceptor.id);
    return;
  }

  state.interceptors = globalInterceptors.map((existing, index) =>
    index === existingIndex ? interceptor : existing,
  );
  bumpVersion(state, interceptor.id);
}

/** Return a snapshot of the registered global interceptors. */
export function getGlobalInterceptors(): Interceptor[] {
  return getGlobalInterceptorsForRuntime(defaultRuntimeScope);
}

/** @internal Return global interceptors for one runtime. */
export function getGlobalInterceptorsForRuntime(runtime: RuntimeScope): Interceptor[] {
  return [...getInterceptorState(runtime).interceptors];
}

/** Clear every global interceptor, or only the interceptor with `id`. */
export function clearGlobalInterceptors(): void;
export function clearGlobalInterceptors(id: string): void;
export function clearGlobalInterceptors(id?: string): void {
  clearGlobalInterceptorsForRuntime(defaultRuntimeScope, id);
}

/** @internal Clear global interceptors in one runtime. */
export function clearGlobalInterceptorsForRuntime(runtime: RuntimeScope, id?: string): void {
  const state = getInterceptorState(runtime);
  const removedIds =
    id === undefined ? state.interceptors.map((interceptor) => interceptor.id) : [id];
  state.interceptors =
    id === undefined ? [] : state.interceptors.filter((interceptor) => interceptor.id !== id);
  for (const removedId of removedIds) bumpVersion(state, removedId);
}

/** @internal Return the opaque generation for a global interceptor id. */
export function getGlobalInterceptorRegistrationVersionForRuntime(
  runtime: RuntimeScope,
  id: string,
): number | undefined {
  return getInterceptorState(runtime).versions.get(id);
}

/** @internal Remove an interceptor only when it belongs to one installation. */
export function clearGlobalInterceptorRegistrationForRuntime(
  runtime: RuntimeScope,
  id: string,
  version: number,
): boolean {
  const state = getInterceptorState(runtime);
  if (state.versions.get(id) !== version) return false;
  state.interceptors = state.interceptors.filter((interceptor) => interceptor.id !== id);
  bumpVersion(state, id);
  return true;
}
