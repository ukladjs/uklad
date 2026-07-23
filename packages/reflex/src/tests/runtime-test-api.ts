/**
 * Legacy-shaped helpers for unit tests that exercise internal subsystems.
 *
 * This module is deliberately test-only: production entry points expose no
 * package-global runtime. Keeping the fixture here lets focused unit tests
 * share one explicitly constructed runtime without reintroducing a singleton
 * into the library API.
 */
import { getGlobalEqualityCheckForKernel, setGlobalEqualityCheckForKernel } from '../core/equality';
import {
  disableTracingForKernel,
  enableTracingForKernel,
  isTraceEnabledForKernel,
  registerTraceCallbackForKernel,
  removeTraceCallbackForKernel,
  withTraceForKernel,
} from '../core/tracing';
import { getInjectCofxInterceptorForKernel } from '../events/coeffects';
import {
  clearGlobalInterceptorsForKernel,
  getGlobalInterceptorsForKernel,
  regGlobalInterceptorForKernel,
} from '../events/global-interceptors';
import { executeForKernel } from '../events/interceptors';
import { regEventErrorHandlerForKernel } from '../events/runner';
import { clearAllForKernel, clearForKernel } from '../events/rate-limit';
import { regEventForKernel } from '../events/registration';
import { dispatchForKernel, dispatchSyncForKernel } from '../events/router';
import { createReflexInspectorForKernel } from '../inspector';
import {
  flushSubscriptionsForKernel,
  getStateForKernel,
  getRenderStateForKernel,
  hasPendingStateFlushForKernel,
  initStateForKernel,
  updateStateForKernel,
} from '../runtime/state';
import { getInterceptorsForKernel, setInterceptorsForKernel } from '../runtime/event-metadata';
import {
  getHandlerForKernel,
  getHandlersForKernel,
  hasHandlerForKernel,
  registerHandlerForKernel,
} from '../runtime/handlers';
import { clearHandlersForKernel } from '../runtime/reset';
import { createReflexRuntime, getRuntimeKernelForTests } from '../runtime/runtime';
import {
  clearSubscriptionCacheForKernel,
  clearSubsForHotReloadForKernel,
  clearSubsForKernel,
  getRootSubSourceByIdForKernel,
  getSubConfigForKernel,
  getSubscriptionDiagnosticsForKernel,
  hasCachedSubscriptionForKernel,
  setRootSubSourceForKernel,
  setSubConfigForKernel,
  sweepProvisionalSubscriptionsForKernel,
} from '../runtime/subscriptions/cache';
import {
  createSubscriptionForKernel,
  getSubscriptionSnapshotForKernel,
  publishSubscriptionsForKernel,
  readSubscriptionForKernel,
  subscribeToSubscriptionForKernel,
} from '../runtime/subscriptions/engine';
import {
  getOrCreateSubscriptionForKernel,
  getSubscriptionValueForKernel,
} from '../subscriptions/queries';
import { regSubForKernel } from '../subscriptions/registration';
import { createElement } from 'react';

import type { Trace, TraceCallback, TraceOptions } from '../core/tracing';
import type { ReactElement, ReactNode } from 'react';
import { ReflexProvider } from '../react/context';
import type {
  Context,
  State,
  DefaultAppState,
  EffectHandler,
  EffectParams,
  ErrorHandler,
  EventHandler,
  EventRegistrationOptions,
  Id,
  Interceptor,
  SubConfig,
  SubResult,
  SubVector,
} from '../types';
import type { HandlerByKind, HandlerKind, HandlerRegistry } from '../runtime/handlers';
import type {
  SubscriptionListenerKind,
  SubscriptionNode,
  SubscriptionSpec,
} from '../runtime/subscriptions/engine';

export const testRuntime = createReflexRuntime({
  initialState: {},
  runtimeId: 'reflex-unit-test-runtime',
  name: 'Reflex unit-test runtime',
});

/** Provider for hook tests that exercise the explicit test runtime. */
export function ReflexTestProvider({ children }: { children?: ReactNode }): ReactElement {
  return createElement(ReflexProvider, { runtime: testRuntime }, children);
}

const kernel = getRuntimeKernelForTests(testRuntime);

export function initState<T extends Record<string, any> = DefaultAppState>(value: State<T>): void {
  initStateForKernel(kernel, value);
}

export function getState<T extends Record<string, any> = DefaultAppState>(): State<T> {
  return getStateForKernel<T>(kernel);
}

export function getRenderState<T extends Record<string, any> = DefaultAppState>(): State<T> {
  return getRenderStateForKernel<T>(kernel);
}

export function updateState<T = Record<string, any>>(value: State<T>): void {
  updateStateForKernel(kernel, value);
}

export function flushSubscriptions(): void {
  flushSubscriptionsForKernel(kernel);
}

export function hasPendingStateFlush(): boolean {
  return hasPendingStateFlushForKernel(kernel);
}

export function regEvent<T = DefaultAppState>(
  id: Id,
  handler: EventHandler<T>,
  registration?: EventRegistrationOptions<T> | Interceptor<T>[] | readonly unknown[],
  legacyInterceptors?: Interceptor<T>[],
): void {
  regEventForKernel(kernel, id, handler, registration, legacyInterceptors);
}

export function regEffect<K extends Id = Id>(id: K, handler: EffectHandler<EffectParams<K>>): void {
  testRuntime.regEffect(id, handler as any);
}

export const regCoeffect = testRuntime.regCoeffect.bind(testRuntime);
export const dispatch = dispatchForKernel.bind(null, kernel);
export const dispatchSync = dispatchSyncForKernel.bind(null, kernel);
export const regEventErrorHandler = regEventErrorHandlerForKernel.bind(null, kernel);

export function regSub<R = any, K extends Id = Id>(
  id: K,
  computeFn?: ((...values: any[]) => SubResult<K, R>) | string,
  depsFn?: (...params: any[]) => SubVector[],
  config?: SubConfig,
): void {
  regSubForKernel(kernel, id, computeFn, depsFn, config);
}

export function getSubscriptionValue<T>(subVector: SubVector): T {
  return getSubscriptionValueForKernel<T>(kernel, subVector);
}

export const getOrCreateSubscription = getOrCreateSubscriptionForKernel.bind(null, kernel);
export function getSubscriptionSnapshot<T>(node: SubscriptionNode<T>): T {
  return getSubscriptionSnapshotForKernel(kernel, node);
}

export function subscribeToSubscription<T>(
  node: SubscriptionNode<T>,
  listener: () => void,
  componentName?: string,
  listenerKind?: SubscriptionListenerKind,
): () => void {
  return subscribeToSubscriptionForKernel(kernel, node, listener, componentName, listenerKind);
}
export const clearSubscriptionCache = clearSubscriptionCacheForKernel.bind(null, kernel);
export const clearSubs = clearSubsForKernel.bind(null, kernel);
export const clearSubsForHotReload = clearSubsForHotReloadForKernel.bind(null, kernel);
export const hasCachedSubscription = hasCachedSubscriptionForKernel.bind(null, kernel);
export const getSubscriptionDiagnostics = getSubscriptionDiagnosticsForKernel.bind(null, kernel);
export const getRootSubSourceById = getRootSubSourceByIdForKernel.bind(null, kernel);
export const getSubConfig = getSubConfigForKernel.bind(null, kernel);
export const setRootSubSource = setRootSubSourceForKernel.bind(null, kernel);
export const setSubConfig = setSubConfigForKernel.bind(null, kernel);
export const sweepProvisionalSubscriptions = sweepProvisionalSubscriptionsForKernel.bind(
  null,
  kernel,
);
export function createSubscription<T>(spec: SubscriptionSpec<T>): SubscriptionNode<T> {
  return createSubscriptionForKernel(kernel, spec);
}

export function readSubscription<T>(node: SubscriptionNode<T>): T {
  return readSubscriptionForKernel(kernel, node);
}

export function publishSubscriptions(roots: SubscriptionNode<any>[]): void {
  publishSubscriptionsForKernel(kernel, roots);
}

export function getHandler<K extends HandlerKind>(kind: K, id: Id): HandlerByKind[K] | undefined {
  return getHandlerForKernel(kernel, kind, id);
}

export function getHandlers(): HandlerRegistry {
  return getHandlersForKernel(kernel);
}

export function registerHandler<K extends HandlerKind, T extends HandlerByKind[K]>(
  kind: K,
  id: Id,
  handler: T,
): T {
  return registerHandlerForKernel(kernel, kind, id, handler);
}

export const hasHandler = hasHandlerForKernel.bind(null, kernel);
export const clearHandlers = clearHandlersForKernel.bind(null, kernel);
export const getInterceptors = getInterceptorsForKernel.bind(null, kernel);
export const setInterceptors = setInterceptorsForKernel.bind(null, kernel);

export const regGlobalInterceptor = regGlobalInterceptorForKernel.bind(null, kernel);
export const getGlobalInterceptors = getGlobalInterceptorsForKernel.bind(null, kernel);
export const clearGlobalInterceptors = clearGlobalInterceptorsForKernel.bind(null, kernel);
export const getInjectCofxInterceptor = getInjectCofxInterceptorForKernel.bind(null, kernel);
export const execute = executeForKernel.bind(null, kernel) as (
  event: Id extends never ? never : [Id, ...any[]],
  interceptors: Interceptor[],
) => Context;

export const setGlobalEqualityCheck = setGlobalEqualityCheckForKernel.bind(null, kernel);
export const getGlobalEqualityCheck = getGlobalEqualityCheckForKernel.bind(null, kernel);

export const enableTracing = enableTracingForKernel.bind(null, kernel);
export const disableTracing = disableTracingForKernel.bind(null, kernel);
export const isTraceEnabled = isTraceEnabledForKernel.bind(null, kernel);
export const registerTraceCallback = registerTraceCallbackForKernel.bind(null, kernel) as (
  key: string,
  callback: TraceCallback,
) => void;
export const removeTraceCallback = removeTraceCallbackForKernel.bind(null, kernel);
export function withTrace<T>(options: TraceOptions, fn: () => T): T {
  return withTraceForKernel(kernel, options, fn);
}

export const clear = clearForKernel.bind(null, kernel);
export const clearAll = clearAllForKernel.bind(null, kernel);
export const debounceAndDispatch = testRuntime.debounceAndDispatch.bind(testRuntime);
export const throttleAndDispatch = testRuntime.throttleAndDispatch.bind(testRuntime);

export function createReflexInspector() {
  return createReflexInspectorForKernel(kernel);
}

export type { ErrorHandler, Trace };
