import type { Interceptor } from '../types';
import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  type RuntimeKernel,
} from '../runtime/kernel';

interface GlobalInterceptorState {
  interceptors: Interceptor[];
  readonly versions: Map<string, number>;
  nextVersion: number;
}

const GLOBAL_INTERCEPTOR_STATE = createRuntimeStateKey<GlobalInterceptorState>(
  'reflex.global-interceptors',
);

function getInterceptorState(runtime: RuntimeKernel): GlobalInterceptorState {
  return getOrCreateRuntimeState(runtime, GLOBAL_INTERCEPTOR_STATE, () => ({
    interceptors: [],
    versions: new Map(),
    nextVersion: 0,
  }));
}

function bumpVersion(state: GlobalInterceptorState, id: string): number {
  const version = ++state.nextVersion;
  state.versions.set(id, version);
  return version;
}

/** @internal Register an interceptor in one runtime. */
export function regGlobalInterceptorForKernel(
  runtime: RuntimeKernel,
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

/** @internal Return global interceptors for one runtime. */
export function getGlobalInterceptorsForKernel(runtime: RuntimeKernel): Interceptor[] {
  return [...getInterceptorState(runtime).interceptors];
}

/** @internal Clear global interceptors in one runtime. */
export function clearGlobalInterceptorsForKernel(runtime: RuntimeKernel, id?: string): void {
  const state = getInterceptorState(runtime);
  const removedIds =
    id === undefined ? state.interceptors.map((interceptor) => interceptor.id) : [id];
  state.interceptors =
    id === undefined ? [] : state.interceptors.filter((interceptor) => interceptor.id !== id);
  for (const removedId of removedIds) bumpVersion(state, removedId);
}

/** @internal Return the opaque generation for a global interceptor id. */
export function getGlobalInterceptorRegistrationVersionForKernel(
  runtime: RuntimeKernel,
  id: string,
): number | undefined {
  return getInterceptorState(runtime).versions.get(id);
}

/** @internal Remove an interceptor only when it belongs to one installation. */
export function clearGlobalInterceptorRegistrationForKernel(
  runtime: RuntimeKernel,
  id: string,
  version: number,
): boolean {
  const state = getInterceptorState(runtime);
  if (state.versions.get(id) !== version) return false;
  state.interceptors = state.interceptors.filter((interceptor) => interceptor.id !== id);
  bumpVersion(state, id);
  return true;
}
