/**
 * Legacy-shaped helpers for unit tests that exercise internal subsystems.
 *
 * This module is deliberately test-only: production entry points expose no
 * package-global runtime. Keeping the fixture here lets focused unit tests
 * share one explicitly constructed runtime without reintroducing a singleton
 * into the library API.
 */
import {
  getGlobalEqualityCheckForRuntime,
  setGlobalEqualityCheckForRuntime,
} from '../core/equality';
import {
  disableTracingForRuntime,
  enableTracingForRuntime,
  isTraceEnabledForRuntime,
  registerTraceCallbackForRuntime,
  removeTraceCallbackForRuntime,
  withTraceForRuntime,
} from '../core/tracing';
import { getInjectCofxInterceptorForRuntime } from '../events/coeffects';
import {
  clearGlobalInterceptorsForRuntime,
  getGlobalInterceptorsForRuntime,
  regGlobalInterceptorForRuntime,
} from '../events/global-interceptors';
import { executeForRuntime } from '../events/interceptors';
import { regEventErrorHandlerForRuntime } from '../events/pipeline';
import { clearAllForRuntime, clearForRuntime } from '../events/rate-limit';
import { regEventForRuntime } from '../events/registration';
import { dispatchForRuntime, dispatchSyncForRuntime } from '../events/router';
import { createReflexInspectorForRuntime } from '../inspector';
import {
  flushSubscriptionsForRuntime,
  getAppDbForRuntime,
  getRenderDbForRuntime,
  hasPendingDbFlushForRuntime,
  initAppDbForRuntime,
  updateAppDbForRuntime,
} from '../runtime/app-db';
import { getInterceptorsForRuntime, setInterceptorsForRuntime } from '../runtime/event-metadata';
import {
  getHandlerForRuntime,
  getHandlersForRuntime,
  hasHandlerForRuntime,
  registerHandlerForRuntime,
} from '../runtime/handlers';
import { clearHandlersForRuntime } from '../runtime/reset';
import { createReflexRuntime } from '../runtime/runtime';
import type { RuntimeKernel } from '../runtime/scope';
import {
  clearSubscriptionCacheForRuntime,
  clearSubsForHotReloadForRuntime,
  clearSubsForRuntime,
  getRootSubSourceByIdForRuntime,
  getSubConfigForRuntime,
  getSubscriptionDiagnosticsForRuntime,
  hasCachedSubscriptionForRuntime,
  setRootSubSourceForRuntime,
  setSubConfigForRuntime,
  sweepProvisionalSubscriptionsForRuntime,
} from '../runtime/subscriptions/cache';
import {
  createSubscriptionForRuntime,
  getSubscriptionSnapshotForRuntime,
  publishSubscriptionsForRuntime,
  readSubscriptionForRuntime,
  subscribeToSubscriptionForRuntime,
} from '../runtime/subscriptions/engine';
import {
  getOrCreateSubscriptionForRuntime,
  getSubscriptionValueForRuntime,
} from '../subscriptions/queries';
import { regSubForRuntime } from '../subscriptions/registration';
import { createElement } from 'react';

import type { Trace, TraceCallback, TraceOptions } from '../core/tracing';
import type { ReactElement, ReactNode } from 'react';
import { ReflexProvider } from '../react/context';
import type {
  Context,
  Db,
  DefaultAppDb,
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
  initialDb: {},
  runtimeId: 'reflex-unit-test-runtime',
  name: 'Reflex unit-test runtime',
});

/** Provider for hook tests that exercise the explicit test runtime. */
export function ReflexTestProvider({ children }: { children?: ReactNode }): ReactElement {
  return createElement(ReflexProvider, { runtime: testRuntime }, children);
}

const kernel = (testRuntime as unknown as { readonly kernel: RuntimeKernel }).kernel;

export function initAppDb<T extends Record<string, any> = DefaultAppDb>(value: Db<T>): void {
  initAppDbForRuntime(kernel, value);
}

export function getAppDb<T extends Record<string, any> = DefaultAppDb>(): Db<T> {
  return getAppDbForRuntime<T>(kernel);
}

export function getRenderDb<T extends Record<string, any> = DefaultAppDb>(): Db<T> {
  return getRenderDbForRuntime<T>(kernel);
}

export function updateAppDb<T = Record<string, any>>(value: Db<T>): void {
  updateAppDbForRuntime(kernel, value);
}

export function flushSubscriptions(): void {
  flushSubscriptionsForRuntime(kernel);
}

export function hasPendingDbFlush(): boolean {
  return hasPendingDbFlushForRuntime(kernel);
}

export function regEvent<T = DefaultAppDb>(
  id: Id,
  handler: EventHandler<T>,
  registration?: EventRegistrationOptions<T> | Interceptor<T>[] | readonly unknown[],
  legacyInterceptors?: Interceptor<T>[],
): void {
  regEventForRuntime(kernel, id, handler, registration, legacyInterceptors);
}

export function regEffect<K extends Id = Id>(id: K, handler: EffectHandler<EffectParams<K>>): void {
  testRuntime.regEffect(id, handler as any);
}

export const regCoeffect = testRuntime.regCoeffect.bind(testRuntime);
export const dispatch = dispatchForRuntime.bind(null, kernel);
export const dispatchSync = dispatchSyncForRuntime.bind(null, kernel);
export const regEventErrorHandler = regEventErrorHandlerForRuntime.bind(null, kernel);

export function regSub<R = any, K extends Id = Id>(
  id: K,
  computeFn?: ((...values: any[]) => SubResult<K, R>) | string,
  depsFn?: (...params: any[]) => SubVector[],
  config?: SubConfig,
): void {
  regSubForRuntime(kernel, id, computeFn, depsFn, config);
}

export function getSubscriptionValue<T>(subVector: SubVector): T {
  return getSubscriptionValueForRuntime<T>(kernel, subVector);
}

export const getOrCreateSubscription = getOrCreateSubscriptionForRuntime.bind(null, kernel);
export function getSubscriptionSnapshot<T>(node: SubscriptionNode<T>): T {
  return getSubscriptionSnapshotForRuntime(kernel, node);
}

export function subscribeToSubscription<T>(
  node: SubscriptionNode<T>,
  listener: () => void,
  componentName?: string,
  listenerKind?: SubscriptionListenerKind,
): () => void {
  return subscribeToSubscriptionForRuntime(kernel, node, listener, componentName, listenerKind);
}
export const clearSubscriptionCache = clearSubscriptionCacheForRuntime.bind(null, kernel);
export const clearSubs = clearSubsForRuntime.bind(null, kernel);
export const clearSubsForHotReload = clearSubsForHotReloadForRuntime.bind(null, kernel);
export const hasCachedSubscription = hasCachedSubscriptionForRuntime.bind(null, kernel);
export const getSubscriptionDiagnostics = getSubscriptionDiagnosticsForRuntime.bind(null, kernel);
export const getRootSubSourceById = getRootSubSourceByIdForRuntime.bind(null, kernel);
export const getSubConfig = getSubConfigForRuntime.bind(null, kernel);
export const setRootSubSource = setRootSubSourceForRuntime.bind(null, kernel);
export const setSubConfig = setSubConfigForRuntime.bind(null, kernel);
export const sweepProvisionalSubscriptions = sweepProvisionalSubscriptionsForRuntime.bind(
  null,
  kernel,
);
export function createSubscription<T>(spec: SubscriptionSpec<T>): SubscriptionNode<T> {
  return createSubscriptionForRuntime(kernel, spec);
}

export function readSubscription<T>(node: SubscriptionNode<T>): T {
  return readSubscriptionForRuntime(kernel, node);
}

export function publishSubscriptions(roots: SubscriptionNode<any>[]): void {
  publishSubscriptionsForRuntime(kernel, roots);
}

export function getHandler<K extends HandlerKind>(kind: K, id: Id): HandlerByKind[K] | undefined {
  return getHandlerForRuntime(kernel, kind, id);
}

export function getHandlers(): HandlerRegistry {
  return getHandlersForRuntime(kernel);
}

export function registerHandler<K extends HandlerKind, T extends HandlerByKind[K]>(
  kind: K,
  id: Id,
  handler: T,
): T {
  return registerHandlerForRuntime(kernel, kind, id, handler);
}

export const hasHandler = hasHandlerForRuntime.bind(null, kernel);
export const clearHandlers = clearHandlersForRuntime.bind(null, kernel);
export const getInterceptors = getInterceptorsForRuntime.bind(null, kernel);
export const setInterceptors = setInterceptorsForRuntime.bind(null, kernel);

export const regGlobalInterceptor = regGlobalInterceptorForRuntime.bind(null, kernel);
export const getGlobalInterceptors = getGlobalInterceptorsForRuntime.bind(null, kernel);
export const clearGlobalInterceptors = clearGlobalInterceptorsForRuntime.bind(null, kernel);
export const getInjectCofxInterceptor = getInjectCofxInterceptorForRuntime.bind(null, kernel);
export const execute = executeForRuntime.bind(null, kernel) as (
  event: Id extends never ? never : [Id, ...any[]],
  interceptors: Interceptor[],
) => Context;

export const setGlobalEqualityCheck = setGlobalEqualityCheckForRuntime.bind(null, kernel);
export const getGlobalEqualityCheck = getGlobalEqualityCheckForRuntime.bind(null, kernel);

export const enableTracing = enableTracingForRuntime.bind(null, kernel);
export const disableTracing = disableTracingForRuntime.bind(null, kernel);
export const isTraceEnabled = isTraceEnabledForRuntime.bind(null, kernel);
export const registerTraceCallback = registerTraceCallbackForRuntime.bind(null, kernel) as (
  key: string,
  callback: TraceCallback,
) => void;
export const removeTraceCallback = removeTraceCallbackForRuntime.bind(null, kernel);
export function withTrace<T>(options: TraceOptions, fn: () => T): T {
  return withTraceForRuntime(kernel, options, fn);
}

export const clear = clearForRuntime.bind(null, kernel);
export const clearAll = clearAllForRuntime.bind(null, kernel);
export const debounceAndDispatch = testRuntime.debounceAndDispatch.bind(testRuntime);
export const throttleAndDispatch = testRuntime.throttleAndDispatch.bind(testRuntime);

export function createReflexInspector() {
  return createReflexInspectorForRuntime(kernel);
}

export type { ErrorHandler, Trace };
