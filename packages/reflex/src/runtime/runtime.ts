import type {
  ContractState,
  ContractDispatchVector,
  ContractEffectParams,
  ContractEffects,
  ContractEventParams,
  ContractSubscribeVector,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  CreateReflexRuntimeOptions,
  PermissiveReflexContracts,
  ReflexContracts,
  ReflexDisposer,
  ReflexModule,
  WatchSubscriptionListener,
  WatchSubscriptionOptions,
} from '../contracts';
import {
  disableTracingForKernel,
  disposeTracingForKernel,
  enableTracePrintForKernel,
  enableTracingForKernel,
  registerTraceCallbackForKernel,
  removeTraceCallbackForKernel,
} from '../core/tracing';
import { getGlobalEqualityCheckForKernel, setGlobalEqualityCheckForKernel } from '../core/equality';
import { regCoeffectForKernel } from '../events/coeffects';
import { clearDelayedEffectsForKernel, regEffectForKernel } from '../events/effects';
import { recordExecutionOutcomeForKernel } from '../events/outcomes';
import {
  clearGlobalInterceptorRegistrationForKernel,
  clearGlobalInterceptorsForKernel,
  getGlobalInterceptorRegistrationVersionForKernel,
  getGlobalInterceptorsForKernel,
  regGlobalInterceptorForKernel,
} from '../events/global-interceptors';
import {
  getHandlingEventIdForKernel,
  regEventErrorHandlerForKernel,
  registerBuiltInErrorHandler,
} from '../events/runner';
import {
  clearAllForKernel as clearRateLimitsForKernel,
  debounceAndDispatchForKernel,
  throttleAndDispatchForKernel,
} from '../events/rate-limit';
import { regEventForKernel } from '../events/registration';
import {
  dispatchOwnedForKernel,
  dispatchSyncForKernel,
  disposeEventQueueForKernel,
  flushRuntime,
  initializeEventRouterForKernel,
  isEventQueueIdleForKernel,
  isEventQueueRunningForKernel,
} from '../events/router';
import { createReflexInspectorForKernel } from '../inspector';
import { getStateForKernel, getStateRevisionsForKernel, initStateForKernel } from './state';
import { clearInterceptorsForKernel } from './event-metadata';
import { isEventVector } from '../core/validation';
import {
  clearHandlerRegistrationForKernel,
  getHandlerRegistrationVersionForKernel,
  getHandlersForKernel,
  hasHandlerForKernel,
} from './handlers';
import { clearHandlersForKernel } from './reset';
import {
  createRuntimeKernel,
  isRuntimeDisposed,
  markRuntimeDisposed,
  type RuntimeKernel,
} from './kernel';
import {
  assertSubscriptionDefinitionCanBeClearedForKernel,
  clearSubscriptionCacheForKernel,
  clearSubscriptionDefinitionsForKernel,
  clearSubsForHotReloadForKernel,
  clearSubsForKernel,
  getSubscriptionDiagnosticsForKernel,
} from './subscriptions/cache';
import {
  assertPublicationAllowedForKernel,
  assertSubscriptionsCanBeClearedForKernel,
  getSubscriptionSnapshotForKernel,
  subscribeToSubscriptionForKernel,
} from './subscriptions/engine';
import {
  getOrCreateSubscriptionForKernel,
  getSubscriptionValueForKernel,
} from '../subscriptions/queries';
import { regSubForKernel } from '../subscriptions/registration';
import {
  notifyRuntimeLifecycleForKernel,
  observeRuntimeLifecycleForKernel,
  type RuntimeLifecycleObserver,
} from './lifecycle';

import type { TraceCallback } from '../core/tracing';
import type { ReflexInspector } from '../inspector';
import type { HandlerKind, HandlerRegistry } from './handlers';
import type { SubscriptionDiagnostic } from './subscriptions/engine';
import type {
  CoEffectHandler,
  CoEffects,
  EqualityCheckFn,
  ErrorHandler,
  EventRegistrationOptions,
  Id,
  Interceptor,
  SubConfig,
  SubVector,
} from '../types';

export type RuntimeEventHandler<TContracts extends ReflexContracts, TId extends string> = (
  coeffects: CoEffects<ContractState<TContracts>>,
  ...params: ContractEventParams<TContracts, TId>
) => ContractEffects<TContracts> | void;

export type RuntimeSubscriptionHandler<TContracts extends ReflexContracts, TId extends string> = (
  ...values: any[]
) => ContractSubscriptionResult<TContracts, TId>;

/** Monotonic committed and render-published state generations. */
export interface RuntimeStateRevisions {
  readonly committedRevision: number;
  readonly publishedRevision: number;
}

export interface ReflexRuntime<TContracts extends ReflexContracts = PermissiveReflexContracts> {
  readonly runtimeId: string;
  readonly runtimeInstanceId: string;
  readonly runtimeName: string;

  getState(): ContractState<TContracts>;
  getStateRevisions(): RuntimeStateRevisions;
  restoreState(nextState: ContractState<TContracts>): void;
  dispatch(event: ContractDispatchVector<TContracts>): void;
  dispatchSync(event: ContractDispatchVector<TContracts>): void;
  flush(): Promise<void>;

  regEvent<TId extends string>(
    id: TId,
    handler: RuntimeEventHandler<TContracts, TId>,
    options?:
      | EventRegistrationOptions<ContractState<TContracts>>
      | Interceptor<ContractState<TContracts>>[],
  ): void;
  regEffect<TId extends string>(
    id: TId,
    handler: (value: ContractEffectParams<TContracts, TId>) => void,
  ): void;
  regCoeffect(id: string, handler: CoEffectHandler<ContractState<TContracts>>): void;
  regEventErrorHandler(handler: ErrorHandler): void;
  regSub<TId extends string>(id: TId): void;
  regSub<TId extends string>(id: TId, sourceKey: string): void;
  regSub<TId extends string>(
    id: TId,
    compute: RuntimeSubscriptionHandler<TContracts, TId>,
    dependencies: (
      ...params: ContractSubscriptionParams<TContracts, TId>
    ) => ContractSubscribeVector<TContracts>[],
    config?: SubConfig,
  ): void;

  getSubscriptionValue<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
  ): ContractSubscriptionResult<TContracts, TId>;
  watchSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    listener: WatchSubscriptionListener<ContractSubscriptionResult<TContracts, TId>>,
    options?: WatchSubscriptionOptions,
  ): ReflexDisposer;

  regGlobalInterceptor(interceptor: Interceptor<ContractState<TContracts>>): void;
  getGlobalInterceptors(): Interceptor<ContractState<TContracts>>[];
  clearGlobalInterceptors(id?: string): void;
  setGlobalEqualityCheck(equalityCheck: EqualityCheckFn): void;
  getGlobalEqualityCheck(): EqualityCheckFn;

  enableTracing(): void;
  disableTracing(): void;
  enableTracePrint(): void;
  registerTraceCallback(key: string, callback: TraceCallback): void;
  removeTraceCallback(key: string): void;

  debounceAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void;
  throttleAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void;

  getHandlers(): HandlerRegistry;
  clearHandlers(kind?: HandlerKind, id?: Id): void;
  clearSubs(): void;
  clearSubscriptionCache(key?: string): void;
  getSubscriptionDiagnostics(): readonly SubscriptionDiagnostic[];

  observeLifecycle(observer: RuntimeLifecycleObserver): ReflexDisposer;

  registerModule(module: ReflexModule<ReflexRuntime<TContracts>>): ReflexDisposer;
  createInspector(): ReflexInspector;
  dispose(): void;
}

type OwnedRegistration =
  | {
      readonly type: 'handler';
      readonly kind: HandlerKind;
      readonly id: Id;
      readonly version: number;
      readonly clearEventMetadata: boolean;
    }
  | {
      readonly type: 'subscription';
      readonly id: Id;
      readonly version: number;
    }
  | {
      readonly type: 'global-interceptor';
      readonly id: string;
      readonly version: number;
    };

interface ModuleInstallation {
  readonly registrations: OwnedRegistration[];
  cleanup: ReflexDisposer | undefined;
  disposed: boolean;
}

function assertRuntimeState(
  value: unknown,
  field: 'initialState' | 'restoreState nextState',
): asserts value is Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`[reflex] ${field} must be a non-null, non-array object.`);
  }
}

class ReflexRuntimeImplementation<TContracts extends ReflexContracts> {
  /** The only owner of this runtime's mutable engine services. */
  readonly #kernel: RuntimeKernel;
  private activeInstallation: ModuleInstallation | null = null;
  private readonly installations = new Set<ModuleInstallation>();
  private readonly watches = new Set<ReflexDisposer>();
  private readonly renderSubscriptions = new Set<ReflexDisposer>();

  constructor(kernel: RuntimeKernel, initialState: ContractState<TContracts>) {
    assertRuntimeState(initialState, 'initialState');
    this.#kernel = kernel;
    registerBuiltInErrorHandler(kernel);
    initializeEventRouterForKernel(kernel);
    initStateForKernel<ContractState<TContracts>>(kernel, initialState);
  }

  static getKernelForTests(runtime: ReflexRuntimeImplementation<any>): RuntimeKernel {
    return runtime.#kernel;
  }

  get runtimeId(): string {
    return this.#kernel.runtimeId;
  }

  get runtimeInstanceId(): string {
    return this.#kernel.runtimeInstanceId;
  }

  get runtimeName(): string {
    return this.#kernel.runtimeName;
  }

  getState(): ContractState<TContracts> {
    this.assertUsable();
    return getStateForKernel<ContractState<TContracts>>(this.#kernel);
  }

  getStateRevisions(): RuntimeStateRevisions {
    this.assertUsable();
    return getStateRevisionsForKernel(this.#kernel);
  }

  restoreState(nextState: ContractState<TContracts>): void {
    this.assertUsable();
    assertRuntimeState(nextState, 'restoreState nextState');
    if (
      !isEventQueueIdleForKernel(this.#kernel) ||
      getHandlingEventIdForKernel(this.#kernel) !== null
    ) {
      throw new Error(
        `[reflex] Cannot restore runtime '${this.runtimeId}' while an event is pending or being handled. Await runtime.flush() first.`,
      );
    }
    assertPublicationAllowedForKernel(this.#kernel);
    initStateForKernel<ContractState<TContracts>>(this.#kernel, nextState);
  }

  dispatch(event: ContractDispatchVector<TContracts>): void {
    this.assertUsable();
    this.assertDispatchableEvent(event, 'dispatch');
    dispatchOwnedForKernel(this.#kernel, event as any);
  }

  dispatchSync(event: ContractDispatchVector<TContracts>): void {
    this.assertUsable();
    this.assertDispatchableEvent(event, 'dispatchSync');
    dispatchSyncForKernel(this.#kernel, event as any);
  }

  flush(): Promise<void> {
    this.assertUsable();
    return flushRuntime(this.#kernel);
  }

  regEvent(
    id: Id,
    handler: RuntimeEventHandler<TContracts, any>,
    options?:
      | EventRegistrationOptions<ContractState<TContracts>>
      | Interceptor<ContractState<TContracts>>[],
  ): void {
    this.assertUsable();
    regEventForKernel(this.#kernel, id, handler as any, options);
    this.recordHandler('event', id, true);
  }

  regEffect(id: Id, handler: (value: any) => void): void {
    this.assertUsable();
    regEffectForKernel(this.#kernel, id, handler);
    this.recordHandler('fx', id, false);
  }

  regCoeffect(id: string, handler: CoEffectHandler<ContractState<TContracts>>): void {
    this.assertUsable();
    regCoeffectForKernel(this.#kernel, id, handler as unknown as CoEffectHandler);
    this.recordHandler('cofx', id, false);
  }

  regEventErrorHandler(handler: ErrorHandler): void {
    this.assertUsable();
    regEventErrorHandlerForKernel(this.#kernel, handler);
    this.recordHandler('error', 'event-handler', false);
  }

  regSub(
    id: Id,
    compute?: RuntimeSubscriptionHandler<TContracts, any> | string,
    dependencies?: (...params: any[]) => ContractSubscribeVector<TContracts>[],
    config?: SubConfig,
  ): void {
    this.assertUsable();
    const previousVersion = getHandlerRegistrationVersionForKernel(this.#kernel, 'sub', id);
    regSubForKernel(this.#kernel, id, compute as any, dependencies as any, config);
    const version = getHandlerRegistrationVersionForKernel(this.#kernel, 'sub', id);
    if (this.activeInstallation && version !== undefined && version !== previousVersion) {
      this.activeInstallation.registrations.push({ type: 'subscription', id, version });
    }
  }

  getSubscriptionValue(query: ContractSubscribeVector<TContracts>): unknown {
    this.assertUsable();
    this.assertRegisteredSubscription(query);
    return getSubscriptionValueForKernel(this.#kernel, query as SubVector);
  }

  watchSubscription(
    query: ContractSubscribeVector<TContracts>,
    listener: WatchSubscriptionListener<any>,
    options: WatchSubscriptionOptions = {},
  ): ReflexDisposer {
    this.assertUsable();
    this.assertRegisteredSubscription(query);
    const subscription = getOrCreateSubscriptionForKernel(this.#kernel, query as SubVector);
    if (!subscription) {
      throw new Error(
        `[reflex] Failed to build the subscription graph for '${String((query as SubVector)[0])}' in runtime '${this.runtimeId}'.`,
      );
    }

    let previousValue = getSubscriptionSnapshotForKernel(this.#kernel, subscription);
    const unsubscribe = subscribeToSubscriptionForKernel(
      this.#kernel,
      subscription,
      () => {
        const nextValue = getSubscriptionSnapshotForKernel(this.#kernel, subscription);
        const oldValue = previousValue;
        previousValue = nextValue;
        listener(nextValue, oldValue);
      },
      options.label ?? 'subscription watcher',
      'watch',
    );

    let subscribed = true;
    const dispose = () => {
      if (!subscribed) return;
      subscribed = false;
      this.watches.delete(dispose);
      unsubscribe();
    };
    this.watches.add(dispose);

    if (options.emitInitial !== false) {
      try {
        listener(previousValue, undefined);
      } catch (error) {
        dispose();
        throw error;
      }
    }
    return dispose;
  }

  subscribeForRender(
    query: ContractSubscribeVector<TContracts>,
    listener: () => void,
    componentName: string = 'react component',
  ): ReflexDisposer {
    this.assertUsable();
    this.assertRegisteredSubscription(query);
    const subscription = getOrCreateSubscriptionForKernel(this.#kernel, query as SubVector);
    if (!subscription) {
      throw new Error(
        `[reflex] Failed to build the subscription graph for '${String((query as SubVector)[0])}' in runtime '${this.runtimeId}'.`,
      );
    }

    const unsubscribe = subscribeToSubscriptionForKernel(
      this.#kernel,
      subscription,
      listener,
      componentName,
      'render',
    );

    let subscribed = true;
    const dispose = () => {
      if (!subscribed) return;
      subscribed = false;
      this.renderSubscriptions.delete(dispose);
      unsubscribe();
    };
    this.renderSubscriptions.add(dispose);
    return dispose;
  }

  regGlobalInterceptor(interceptor: Interceptor<ContractState<TContracts>>): void {
    this.assertUsable();
    regGlobalInterceptorForKernel(this.#kernel, interceptor as unknown as Interceptor);
    const version = getGlobalInterceptorRegistrationVersionForKernel(this.#kernel, interceptor.id);
    if (this.activeInstallation && version !== undefined) {
      this.activeInstallation.registrations.push({
        type: 'global-interceptor',
        id: interceptor.id,
        version,
      });
    }
  }

  getGlobalInterceptors(): Interceptor<ContractState<TContracts>>[] {
    this.assertUsable();
    return getGlobalInterceptorsForKernel(this.#kernel) as unknown as Interceptor<
      ContractState<TContracts>
    >[];
  }

  clearGlobalInterceptors(id?: string): void {
    this.assertUsable();
    clearGlobalInterceptorsForKernel(this.#kernel, id);
  }

  setGlobalEqualityCheck(equalityCheck: EqualityCheckFn): void {
    this.assertUsable();
    setGlobalEqualityCheckForKernel(this.#kernel, equalityCheck);
  }

  getGlobalEqualityCheck(): EqualityCheckFn {
    this.assertUsable();
    return getGlobalEqualityCheckForKernel(this.#kernel);
  }

  enableTracing(): void {
    this.assertUsable();
    enableTracingForKernel(this.#kernel);
  }

  disableTracing(): void {
    this.assertUsable();
    disableTracingForKernel(this.#kernel);
  }

  enableTracePrint(): void {
    this.assertUsable();
    enableTracePrintForKernel(this.#kernel);
  }

  registerTraceCallback(key: string, callback: TraceCallback): void {
    this.assertUsable();
    registerTraceCallbackForKernel(this.#kernel, key, callback);
  }

  removeTraceCallback(key: string): void {
    this.assertUsable();
    removeTraceCallbackForKernel(this.#kernel, key);
  }

  debounceAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void {
    this.assertUsable();
    debounceAndDispatchForKernel(this.#kernel, event as any, durationMs);
  }

  throttleAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void {
    this.assertUsable();
    throttleAndDispatchForKernel(this.#kernel, event as any, durationMs);
  }

  getHandlers(): HandlerRegistry {
    this.assertUsable();
    return getHandlersForKernel(this.#kernel);
  }

  clearHandlers(kind?: HandlerKind, id?: Id): void {
    this.assertUsable();
    clearHandlersForKernel(this.#kernel, kind, id);
  }

  clearSubs(): void {
    this.assertUsable();
    clearSubsForKernel(this.#kernel);
  }

  /** @internal Clear definitions immediately before the owning React tree remounts. */
  clearSubsForHotReload(subscriptionIds?: readonly Id[]): void {
    this.assertUsable();
    clearSubsForHotReloadForKernel(this.#kernel, subscriptionIds);
  }

  clearSubscriptionCache(key?: string): void {
    this.assertUsable();
    clearSubscriptionCacheForKernel(this.#kernel, key);
  }

  getSubscriptionDiagnostics(): readonly SubscriptionDiagnostic[] {
    this.assertUsable();
    return getSubscriptionDiagnosticsForKernel(this.#kernel);
  }

  observeLifecycle(observer: RuntimeLifecycleObserver): ReflexDisposer {
    this.assertUsable();
    return observeRuntimeLifecycleForKernel(this.#kernel, observer);
  }

  registerModule(module: ReflexModule<ReflexRuntime<TContracts>>): ReflexDisposer {
    this.assertUsable();
    if (this.activeInstallation) {
      throw new Error('[reflex] registerModule installers cannot be nested.');
    }

    const installation: ModuleInstallation = {
      registrations: [],
      cleanup: undefined,
      disposed: false,
    };
    this.activeInstallation = installation;
    try {
      const cleanup = module(this as unknown as ReflexRuntime<TContracts>);
      if (cleanup) installation.cleanup = cleanup;
      this.installations.add(installation);
    } catch (error) {
      this.activeInstallation = null;
      this.disposeInstallation(installation);
      throw error;
    } finally {
      this.activeInstallation = null;
    }

    return () => this.disposeInstallation(installation);
  }

  createInspector(): ReflexInspector {
    this.assertUsable();
    return createReflexInspectorForKernel(this.#kernel);
  }

  dispose(): void {
    if (isRuntimeDisposed(this.#kernel)) return;
    if (isEventQueueRunningForKernel(this.#kernel)) {
      throw new Error(
        `[reflex] Cannot dispose runtime '${this.runtimeId}' while its event queue is synchronously running. Dispose after the current event or runtime.flush() settles.`,
      );
    }

    for (const disposeRenderSubscription of Array.from(this.renderSubscriptions)) {
      disposeRenderSubscription();
    }
    for (const disposeWatch of Array.from(this.watches)) disposeWatch();
    assertSubscriptionsCanBeClearedForKernel(this.#kernel);
    for (const installation of Array.from(this.installations).reverse()) {
      this.disposeInstallation(installation);
    }

    clearRateLimitsForKernel(this.#kernel);
    clearDelayedEffectsForKernel(this.#kernel);
    disposeEventQueueForKernel(this.#kernel);
    recordExecutionOutcomeForKernel(this.#kernel, {
      type: 'runtime-disposed',
      runtimeInstanceId: this.#kernel.runtimeInstanceId,
      error: new Error(`[reflex] Runtime '${this.runtimeId}' was disposed.`),
    });
    disposeTracingForKernel(this.#kernel);
    clearGlobalInterceptorsForKernel(this.#kernel);
    clearHandlersForKernel(this.#kernel);
    notifyRuntimeLifecycleForKernel(this.#kernel, 'onRuntimeDisposed');
    markRuntimeDisposed(this.#kernel);
  }

  private assertUsable(): void {
    if (isRuntimeDisposed(this.#kernel)) {
      throw new Error(`[reflex] Runtime '${this.runtimeId}' has been disposed.`);
    }
  }

  // The instance API fails loudly on unknown ids. The compatibility facade's
  // root functions keep the lenient 0.x console-error behavior.
  private assertDispatchableEvent(event: unknown, api: 'dispatch' | 'dispatchSync'): void {
    if (!isEventVector(event)) {
      throw new Error(
        `[reflex] ${api} expects a non-empty event vector starting with an event id string.`,
      );
    }
    if (!hasHandlerForKernel(this.#kernel, 'event', event[0])) {
      throw new Error(
        `[reflex] No event handler registered for '${event[0]}' in runtime '${this.runtimeId}'. Register it with regEvent() before dispatching.`,
      );
    }
  }

  private assertRegisteredSubscription(query: unknown): void {
    if (!Array.isArray(query) || query.length === 0 || typeof query[0] !== 'string') {
      throw new Error(
        '[reflex] Subscription queries must be non-empty vectors starting with a subscription id string.',
      );
    }
    if (!hasHandlerForKernel(this.#kernel, 'sub', query[0])) {
      throw new Error(
        `[reflex] No subscription registered for '${query[0]}' in runtime '${this.runtimeId}'. Register it with regSub() before use.`,
      );
    }
  }

  private recordHandler(kind: HandlerKind, id: Id, clearEventMetadata: boolean): void {
    if (!this.activeInstallation) return;
    const version = getHandlerRegistrationVersionForKernel(this.#kernel, kind, id);
    if (version === undefined) return;
    this.activeInstallation.registrations.push({
      type: 'handler',
      kind,
      id,
      version,
      clearEventMetadata,
    });
  }

  private disposeInstallation(installation: ModuleInstallation): void {
    if (installation.disposed) return;

    for (const registration of installation.registrations) {
      if (
        registration.type === 'subscription' &&
        getHandlerRegistrationVersionForKernel(this.#kernel, 'sub', registration.id) ===
          registration.version
      ) {
        assertSubscriptionDefinitionCanBeClearedForKernel(this.#kernel, registration.id);
      }
    }

    const cleanup = installation.cleanup;
    installation.cleanup = undefined;
    cleanup?.();

    for (let index = installation.registrations.length - 1; index >= 0; index--) {
      const registration = installation.registrations[index]!;
      if (registration.type === 'subscription') {
        if (
          getHandlerRegistrationVersionForKernel(this.#kernel, 'sub', registration.id) ===
          registration.version
        ) {
          clearSubscriptionDefinitionsForKernel(this.#kernel, registration.id);
        }
        continue;
      }
      if (registration.type === 'global-interceptor') {
        clearGlobalInterceptorRegistrationForKernel(
          this.#kernel,
          registration.id,
          registration.version,
        );
        continue;
      }
      const cleared = clearHandlerRegistrationForKernel(
        this.#kernel,
        registration.kind,
        registration.id,
        registration.version,
      );
      if (cleared && registration.clearEventMetadata) {
        clearInterceptorsForKernel(this.#kernel, registration.id);
      }
    }

    installation.disposed = true;
    this.installations.delete(installation);
  }
}

type StateInferredContracts<TState extends Record<string, any>> = ReflexContracts & {
  readonly state: TState;
};

type NonArrayRuntimeOptions<TState extends Record<string, any>> =
  CreateReflexRuntimeOptions<TState> & (TState extends readonly any[] ? never : unknown);

export function createReflexRuntime<
  TContracts extends ReflexContracts,
  TState extends ContractState<TContracts> = ContractState<TContracts>,
>(options: NonArrayRuntimeOptions<TState>): ReflexRuntime<TContracts>;
export function createReflexRuntime<TState extends Record<string, any>>(
  options: NonArrayRuntimeOptions<TState>,
): ReflexRuntime<StateInferredContracts<TState>>;
export function createReflexRuntime(options: CreateReflexRuntimeOptions<any>): ReflexRuntime<any> {
  const kernel = createRuntimeKernel(options);
  return new ReflexRuntimeImplementation(
    kernel,
    options.initialState,
  ) as unknown as ReflexRuntime<any>;
}

/** @internal Test-only access for focused engine subsystem tests. */
export function getRuntimeKernelForTests(runtime: ReflexRuntime<any>): RuntimeKernel {
  if (!(runtime instanceof ReflexRuntimeImplementation)) {
    throw new Error('[reflex] Expected a runtime created by createReflexRuntime().');
  }
  return ReflexRuntimeImplementation.getKernelForTests(runtime);
}

/** @internal Register the React binding as a render listener. */
export function subscribeForRender(
  runtime: ReflexRuntime<any>,
  query: ContractSubscribeVector<any>,
  listener: () => void,
  componentName?: string,
): ReflexDisposer {
  if (!(runtime instanceof ReflexRuntimeImplementation)) {
    throw new Error(
      '[reflex] React subscriptions require a runtime created by createReflexRuntime().',
    );
  }
  return runtime.subscribeForRender(query, listener, componentName);
}

/** @internal Clear one explicit runtime's subscriptions for an imminent HMR remount. */
export function clearRuntimeSubsForHotReload(
  runtime: ReflexRuntime<any>,
  subscriptionIds?: readonly Id[],
): void {
  if (!(runtime instanceof ReflexRuntimeImplementation)) {
    throw new Error(
      '[reflex] setupSubsHotReload requires a runtime created by createReflexRuntime().',
    );
  }
  runtime.clearSubsForHotReload(subscriptionIds);
}
