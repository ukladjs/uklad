/**
 * Legacy-shaped helpers for unit tests that exercise internal subsystems.
 *
 * This module is deliberately test-only: production entry points expose no
 * package-global runtime. Keeping the fixture here lets focused unit tests
 * share one explicitly constructed runtime without reintroducing a singleton
 * into the library API.
 */
import {
  disableTracing as disableTracingInternal,
  enableTracing as enableTracingInternal,
  isTraceEnabled as isTraceEnabledInternal,
  registerTraceCallback as registerTraceCallbackInternal,
  removeTraceCallback as removeTraceCallbackInternal,
  withOptionalTrace as withOptionalTraceInternal,
} from '../../src/runtime/tracing';
import { execute as executeInterceptors } from '../../src/events/interceptors-executor';
import { createUkladInspector as createInspectorInternal } from '../../src/inspector';
import {
  createUkladRuntimeForTests as createUkladRuntime,
  getRuntimeCoreForTests,
} from '../../src/runtime/runtime';
import type { RegistrationStore } from '../../src/runtime/registrations';
import { createElement } from 'react';

import type { Trace, TraceCallback, TraceOptions } from '../../src/runtime/tracing';
import type { ReactElement, ReactNode } from 'react';
import { UkladProvider } from '../../src/react/context';
import type {
  Context,
  CoEffectHandler,
  State,
  DefaultAppState,
  EffectHandler,
  EqualityCheckFn,
  ErrorHandler,
  EventHandler,
  EventRegistrationOptions,
  Id,
  Interceptor,
  SubConfig,
  SubVector,
} from '../../src/types';
import type { HandlerRegistry } from '../../src/runtime/handler-types';
import type {
  SubscriptionListenerKind,
  SubscriptionNode,
  SubscriptionSpec,
} from '../../src/runtime/subscriptions/engine';

export const testRuntime = createUkladRuntime({
  initialState: {},
  runtimeId: 'uklad-unit-test-runtime',
  name: 'Uklad unit-test runtime',
});

/** Provider for hook tests that exercise the explicit test runtime. */
export function UkladTestProvider({ children }: { children?: ReactNode }): ReactElement {
  return createElement(UkladProvider, { runtime: testRuntime }, children);
}

const core = getRuntimeCoreForTests(testRuntime);
export const handlerRegistry = core.registry;

export function initState<T extends Record<string, any> = DefaultAppState>(value: State<T>): void {
  core.state.initialize(value);
}

export function getState<T extends Record<string, any> = DefaultAppState>(): State<T> {
  return core.state.get<T>();
}

export function getRenderState<T extends Record<string, any> = DefaultAppState>(): State<T> {
  return core.state.getRender<T>();
}

export function updateState<T = Record<string, any>>(value: State<T>): void {
  core.state.commit(value);
}

export function flushSubscriptions(): void {
  core.state.publish();
}

export function hasPendingStateFlush(): boolean {
  return core.state.hasPendingPublication;
}

export function regEvent<T = DefaultAppState>(
  id: Id,
  handler: EventHandler<T>,
  options?: EventRegistrationOptions<T>,
): void {
  core.events.registerEvent(id, handler, options);
}

export function regEffect<K extends Id = Id>(id: K, handler: EffectHandler<any>): void {
  testRuntime.registerModule((registrar) => {
    registrar.regEffect(id, handler as any);
  });
}

export function regCoeffect<TValue = any, TArg = any>(
  id: string,
  handler: CoEffectHandler<TValue, TArg>,
): void {
  testRuntime.registerModule((registrar) => {
    registrar.regCoeffect(id, handler as any);
  });
}
export const dispatch = core.events.dispatch.bind(core.events);
export const dispatchSync = core.events.dispatchSync.bind(core.events);
export function setEventErrorHandler(handler: ErrorHandler): void {
  core.registry.error.registerSystemOverride('event-handler', handler);
}

export function regSub<R = any, K extends Id = Id>(
  id: K,
  depsFn: (...params: any[]) => SubVector[],
  // `any` rather than `any[]`, so cases may annotate the dependency list as an
  // exact tuple (`([value]: [number]) => …`) without fighting assignability.
  computeFn: (values: any, ...params: any[]) => R,
  config?: SubConfig,
): void {
  core.subscriptions.register(id, depsFn, computeFn, config);
}

export function regRootSub<K extends Id = Id>(id: K, sourceKey: string): void {
  core.subscriptions.registerRoot(id, sourceKey);
}

export function getSubscriptionValue<T>(subVector: SubVector): T {
  return core.subscriptions.read<T>(subVector);
}

export const getOrCreateSubscription = core.subscriptions.getOrCreate.bind(core.subscriptions);
export function getSubscriptionSnapshot<T>(node: SubscriptionNode<T>): T {
  return core.subscriptions.getSnapshot(node);
}

export function subscribeToSubscription<T>(
  node: SubscriptionNode<T>,
  listener: () => void,
  componentName?: string,
  listenerKind?: SubscriptionListenerKind,
): () => void {
  return core.subscriptions.subscribe(node, listener, componentName, listenerKind);
}
export const clearSubscriptionCache = core.subscriptions.clearCache.bind(core.subscriptions);
export const clearSubs = core.subscriptions.clearAll.bind(core.subscriptions);
export const clearSubsForHotReload = core.subscriptions.clearForHotReload.bind(core.subscriptions);
export const hasCachedSubscription = core.subscriptions.hasCached.bind(core.subscriptions);
export const getSubscriptionDiagnostics = core.subscriptions.diagnostics.bind(core.subscriptions);
export function getRootSubSourceById(id: Id): string | undefined {
  return core.subscriptions.rootSubSourceById.get(id);
}
export function getSubConfig(id: Id): SubConfig | undefined {
  return core.subscriptions.subConfigById.get(id);
}
export const setRootSubSource = core.subscriptions.setRootSource.bind(core.subscriptions);
export function setSubConfig(id: Id, config: SubConfig): void {
  core.subscriptions.subConfigById.set(id, config);
}
export const sweepProvisionalSubscriptions = core.subscriptions.sweepProvisional.bind(
  core.subscriptions,
);
export function createSubscription<T>(spec: SubscriptionSpec<T>): SubscriptionNode<T> {
  return core.subscriptions.engine.create(spec);
}

export function readSubscription<T>(node: SubscriptionNode<T>): T {
  return core.subscriptions.engine.read(node);
}

export function publishSubscriptions(roots: SubscriptionNode<any>[]): void {
  core.subscriptions.publish(roots);
}

export function getHandler<T>(record: RegistrationStore<T>, id: Id): T | undefined {
  return record.get(id);
}

export function getHandlers(): HandlerRegistry {
  return core.registry.handlers;
}

export function registerHandler<T>(record: RegistrationStore<T>, id: Id, handler: T): T {
  if (record === core.registry.event) {
    core.events.registerEvent(id, handler as EventHandler);
  } else if (record === core.registry.error) {
    core.registry.error.registerSystemOverride(id, handler as ErrorHandler);
  } else {
    record.register(id, handler);
  }
  return handler;
}

export const hasHandler = <T>(record: RegistrationStore<T>, id: Id): boolean => record.has(id);
export function clearHandlers(): void {
  core.subscriptions.assertClearAllowed();
  core.registry.clear();
  core.events.clearEventDefinitions();
  core.subscriptions.clearDefinitions();
}
export function clearEventHandlers(id?: Id): void {
  core.registry.event.clear(id);
  core.events.clearEventDefinitions(id);
}
export function clearSubscriptionHandlers(id?: Id): void {
  core.subscriptions.assertClearAllowed();
  core.subscriptions.clearDefinitions(id);
}
export const getEventInterceptors = core.events.getEventInterceptors.bind(core.events);
export const setEventInterceptors = core.events.setEventInterceptors.bind(core.events);

export const addInterceptor = core.events.registerInterceptor.bind(core.events);
export const getInterceptors = core.events.getInterceptors.bind(core.events);
export const clearInterceptors = core.events.clearInterceptors.bind(core.events);
export const execute = executeInterceptors.bind(null, core) as (
  event: Id extends never ? never : [Id, ...any[]],
  interceptors: Interceptor[],
) => Context;

export const setEqualityCheck = (equalityCheck: EqualityCheckFn): void => {
  core.subscriptions.equalityCheck = equalityCheck;
};
export const getEqualityCheck = (): EqualityCheckFn => core.subscriptions.equalityCheck;

export const enableTracing = enableTracingInternal.bind(null, core);
export const disableTracing = disableTracingInternal.bind(null, core);
export const isTraceEnabled = isTraceEnabledInternal.bind(null, core);
export const registerTraceCallback = registerTraceCallbackInternal.bind(null, core) as (
  key: string,
  callback: TraceCallback,
) => void;
export const removeTraceCallback = removeTraceCallbackInternal.bind(null, core);
export function withTrace<T>(options: TraceOptions, fn: () => T): T {
  return withOptionalTraceInternal(core, () => options, fn);
}

export const clear = core.events.clearRateLimit.bind(core.events);
export const clearAll = core.events.clearRateLimits.bind(core.events);
export const testEventRuntime = core.events;
export const debounceAndDispatch = testRuntime.debounceAndDispatch.bind(testRuntime);
export const throttleAndDispatch = testRuntime.throttleAndDispatch.bind(testRuntime);

export function createUkladInspector() {
  return createInspectorInternal(core);
}

export type { ErrorHandler, Trace };
