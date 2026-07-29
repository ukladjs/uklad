import type {
  ContractState,
  ContractDispatchVector,
  ContractSubscribeVector,
  CreateReflexRuntimeOptions,
  ReflexContracts,
  ReflexDisposer,
  ReflexModule,
  WatchSubscriptionListener,
  WatchSubscriptionOptions,
} from '../contracts';
import {
  disableTracing,
  disposeTracing,
  enableTracePrint,
  enableTracing,
  registerTraceCallback,
  removeTraceCallback,
} from './tracing';
import { defaultErrorHandler } from '../events/runner';
import {
  createRuntimeCore,
  isRuntimeDisposed,
  markRuntimeDisposed,
  type RuntimeCore,
} from './core';
import { detachRuntimeProbes, notifyRuntimeProbe } from './probe';
import {
  assertDispatchableEvent,
  assertRateLimitDuration,
  assertRegisteredSubscription,
  assertRuntimeUsable,
  assertStateRecord,
} from './validation';

import type { TraceCallback } from '../core/tracing-types';
import type { HandlerRegistry } from './handler-types';
import type { RegistrationHandle } from './registrations';
import type { SubscriptionDiagnostic } from './subscriptions/types';
import type {
  ReflexRuntime,
  ReflexRuntimeAdmin,
  ReflexRuntimeClient,
  ReflexRegistrar,
  RuntimeEventHandler,
  RuntimeStateRevisions,
  RuntimeSubscriptionHandler,
} from './api';
import type {
  CoEffectHandler,
  EqualityCheckFn,
  ErrorHandler,
  EventRegistrationOptions,
  Id,
  Interceptor,
  SubConfig,
  SubVector,
} from '../types';

export type {
  ReflexRegistrar,
  ReflexRuntime,
  ReflexRuntimeAdmin,
  ReflexRuntimeClient,
  RuntimeEventHandler,
  RuntimeStateRevisions,
  RuntimeSubscriptionHandler,
} from './api';

interface ModuleInstallation {
  readonly registrations: RegistrationHandle[];
  cleanup: ReflexDisposer | undefined;
  disposed: boolean;
}

type RuntimeFacadeRole = 'owner' | 'client';

interface RuntimeBinding {
  readonly implementation: ReflexRuntimeImplementation<any>;
  readonly role: RuntimeFacadeRole;
}

/** Private identity table for the frozen facades produced by this module. */
const RUNTIME_BINDINGS = new WeakMap<object, RuntimeBinding>();

type StateInferredContracts<TState extends Record<string, any>> = ReflexContracts & {
  readonly state: TState;
};

type NonArrayRuntimeOptions<TState extends Record<string, any>> =
  CreateReflexRuntimeOptions<TState> & (TState extends readonly any[] ? never : unknown);

class ReflexRuntimeImplementation<TContracts extends ReflexContracts> {
  /** The only owner of this runtime's mutable engine services. */
  readonly #core: RuntimeCore;
  private activeInstallation: ModuleInstallation | null = null;
  private readonly installations = new Set<ModuleInstallation>();
  private readonly watches = new Set<ReflexDisposer>();
  private readonly renderSubscriptions = new Set<ReflexDisposer>();
  private clientRuntime: ReflexRuntimeClient<TContracts> | undefined;

  constructor(core: RuntimeCore, initialState: ContractState<TContracts>) {
    assertStateRecord(initialState, 'initialState');
    this.#core = core;
    core.registry.error.registerSystem('event-handler', defaultErrorHandler);
    core.events.initialize();
    core.state.initialize<ContractState<TContracts>>(initialState);
  }

  getCoreForInternalUse(): RuntimeCore {
    return this.#core;
  }

  createPublicRuntime(): ReflexRuntime<TContracts> {
    const client = this.getClientForInternalUse();
    return Object.freeze({
      ...client,
      runtimeInstanceId: this.runtimeInstanceId,
      registerModule: this.registerModule.bind(this),
      dispose: this.dispose.bind(this),
    }) as ReflexRuntime<TContracts>;
  }

  getClientForInternalUse(): ReflexRuntimeClient<TContracts> {
    this.clientRuntime ??= Object.freeze({
      runtimeId: this.runtimeId,
      runtimeName: this.runtimeName,
      dispatch: this.dispatch.bind(this),
      debounceAndDispatch: this.debounceAndDispatch.bind(this),
      throttleAndDispatch: this.throttleAndDispatch.bind(this),
    }) as ReflexRuntimeClient<TContracts>;
    return this.clientRuntime!;
  }

  get runtimeId(): string {
    return this.#core.identity.runtimeId;
  }

  get runtimeInstanceId(): string {
    return this.#core.identity.runtimeInstanceId;
  }

  get runtimeName(): string {
    return this.#core.identity.runtimeName;
  }

  getState(): ContractState<TContracts> {
    this.assertUsable();
    return this.#core.state.get<ContractState<TContracts>>();
  }

  getStateRevisions(): RuntimeStateRevisions {
    this.assertUsable();
    return this.#core.state.getRevisions();
  }

  restoreState(nextState: ContractState<TContracts>): void {
    this.assertUsable();
    assertStateRecord(nextState, 'restoreState nextState');
    if (!this.#core.events.isIdle || this.#core.events.handlingEventId !== null) {
      throw new Error(
        `[reflex] Cannot restore runtime '${this.runtimeId}' while an event is pending or being handled. Await runtime.flush() first.`,
      );
    }
    this.#core.subscriptions.assertPublicationAllowed();
    this.#core.state.initialize<ContractState<TContracts>>(nextState);
  }

  dispatch(event: ContractDispatchVector<TContracts>): void {
    this.assertUsable();
    assertDispatchableEvent(this.#core, event, 'dispatch');
    this.#core.events.dispatchOwned(event as any);
  }

  dispatchSync(event: ContractDispatchVector<TContracts>): void {
    this.assertUsable();
    assertDispatchableEvent(this.#core, event, 'dispatchSync');
    this.#core.events.dispatchSync(event as any);
  }

  flush(): Promise<void> {
    this.assertUsable();
    return this.#core.events.flush();
  }

  regEvent(
    id: Id,
    handler: RuntimeEventHandler<TContracts, any>,
    options?: EventRegistrationOptions<ContractState<TContracts>>,
  ): void {
    this.assertUsable();
    this.recordRegistration(this.#core.events.registerEvent(id, handler as any, options));
  }

  regEffect(id: Id, handler: (value: any, runtime: ReflexRuntimeClient<any>) => void): void {
    this.assertUsable();
    this.recordRegistration(this.#core.registry.fx.register(id, handler));
  }

  regCoeffect(id: string, handler: CoEffectHandler<ContractState<TContracts>>): void {
    this.assertUsable();
    this.recordRegistration(
      this.#core.registry.cofx.register(id, handler as unknown as CoEffectHandler),
    );
  }

  setEventErrorHandler(handler: ErrorHandler): void {
    this.assertUsable();
    this.#core.registry.error.registerSystemOverride('event-handler', handler);
  }

  clearEventErrorHandler(): void {
    this.assertUsable();
    // The store keeps the system baseline registered at construction, so
    // clearing the override restores it rather than leaving no handler.
    this.#core.registry.error.clear('event-handler');
  }

  regRootSub(id: Id, sourceKey: string): void {
    this.assertUsable();
    const registration = this.#core.subscriptions.registerRoot(id, sourceKey);
    if (registration) this.recordRegistration(registration);
  }

  regSub(
    id: Id,
    dependencies: (...params: any[]) => readonly ContractSubscribeVector<TContracts>[],
    compute: RuntimeSubscriptionHandler<TContracts, any>,
    config?: SubConfig,
  ): void {
    this.assertUsable();
    const registration = this.#core.subscriptions.register(
      id,
      dependencies as any,
      compute as any,
      config,
    );
    if (registration) this.recordRegistration(registration);
  }

  getSubscriptionValue(query: ContractSubscribeVector<TContracts>): unknown {
    this.assertUsable();
    assertRegisteredSubscription(this.#core, query);
    return this.#core.subscriptions.read(query as SubVector);
  }

  watchSubscription(
    query: ContractSubscribeVector<TContracts>,
    listener: WatchSubscriptionListener<any>,
    options: WatchSubscriptionOptions = {},
  ): ReflexDisposer {
    this.assertUsable();
    assertRegisteredSubscription(this.#core, query);
    const subscription = this.#core.subscriptions.getOrCreate(query as SubVector);
    if (!subscription) {
      throw new Error(
        `[reflex] Failed to build the subscription graph for '${String((query as SubVector)[0])}' in runtime '${this.runtimeId}'.`,
      );
    }

    let previousValue = this.#core.subscriptions.getSnapshot(subscription);
    const unsubscribe = this.#core.subscriptions.subscribe(
      subscription,
      () => {
        const nextValue = this.#core.subscriptions.getSnapshot(subscription);
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
    assertRegisteredSubscription(this.#core, query);
    const subscription = this.#core.subscriptions.getOrCreate(query as SubVector);
    if (!subscription) {
      throw new Error(
        `[reflex] Failed to build the subscription graph for '${String((query as SubVector)[0])}' in runtime '${this.runtimeId}'.`,
      );
    }

    const unsubscribe = this.#core.subscriptions.subscribe(
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

  addInterceptor(interceptor: Interceptor<ContractState<TContracts>>): void {
    this.assertUsable();
    this.#core.events.registerInterceptor(interceptor as unknown as Interceptor);
  }

  getInterceptors(): Interceptor<ContractState<TContracts>>[] {
    this.assertUsable();
    return this.#core.events.getInterceptors() as unknown as Interceptor<
      ContractState<TContracts>
    >[];
  }

  removeInterceptor(id: string): void {
    this.assertUsable();
    this.#core.events.clearInterceptors(id);
  }

  setEqualityCheck(equalityCheck: EqualityCheckFn): void {
    this.assertUsable();
    this.#core.subscriptions.equalityCheck = equalityCheck;
  }

  getEqualityCheck(): EqualityCheckFn {
    this.assertUsable();
    return this.#core.subscriptions.equalityCheck;
  }

  enableTracing(): void {
    this.assertUsable();
    enableTracing(this.#core);
  }

  disableTracing(): void {
    this.assertUsable();
    disableTracing(this.#core);
  }

  enableTracePrint(): void {
    this.assertUsable();
    enableTracePrint(this.#core);
  }

  registerTraceCallback(key: string, callback: TraceCallback): void {
    this.assertUsable();
    registerTraceCallback(this.#core, key, callback);
  }

  removeTraceCallback(key: string): void {
    this.assertUsable();
    removeTraceCallback(this.#core, key);
  }

  debounceAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void {
    this.assertUsable();
    assertDispatchableEvent(this.#core, event, 'debounceAndDispatch');
    assertRateLimitDuration(durationMs, 'debounceAndDispatch');
    this.#core.events.debounce(event as any, durationMs);
  }

  throttleAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void {
    this.assertUsable();
    assertDispatchableEvent(this.#core, event, 'throttleAndDispatch');
    assertRateLimitDuration(durationMs, 'throttleAndDispatch');
    this.#core.events.throttle(event as any, durationMs);
  }

  getHandlers(): HandlerRegistry {
    this.assertUsable();
    return this.#core.registry.handlers;
  }

  clearHandlers(): void {
    this.assertUsable();
    this.clearHandlersInternal();
  }

  clearSubs(): void {
    this.assertUsable();
    this.#core.subscriptions.clearAll();
  }

  /** @internal Clear definitions immediately before the owning React tree remounts. */
  clearSubsForHotReload(subscriptionIds?: readonly Id[]): void {
    this.assertUsable();
    this.#core.subscriptions.clearForHotReload(subscriptionIds);
  }

  clearSubscriptionCache(key?: string): void {
    this.assertUsable();
    this.#core.subscriptions.clearCache(key);
  }

  getSubscriptionDiagnostics(): readonly SubscriptionDiagnostic[] {
    this.assertUsable();
    return this.#core.subscriptions.diagnostics();
  }

  registerModule(module: ReflexModule<ReflexRegistrar<TContracts>>): ReflexDisposer {
    return this.installModule(module, () => this.createRegistrar());
  }

  private installModule<TRegistrar>(
    module: ReflexModule<TRegistrar>,
    createRegistrar: () => TRegistrar,
  ): ReflexDisposer {
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
      const cleanup = module(createRegistrar());
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

  private createRegistrar(): ReflexRegistrar<TContracts> {
    return Object.freeze({
      regEvent: this.regEvent.bind(this),
      regEffect: this.regEffect.bind(this),
      regCoeffect: this.regCoeffect.bind(this),
      regRootSub: this.regRootSub.bind(this),
      regSub: this.regSub.bind(this),
    });
  }

  dispose(): void {
    if (isRuntimeDisposed(this.#core)) return;
    if (this.#core.events.isRunning) {
      throw new Error(
        `[reflex] Cannot dispose runtime '${this.runtimeId}' while its event queue is synchronously running. Dispose after the current event or runtime.flush() settles.`,
      );
    }

    for (const disposeRenderSubscription of Array.from(this.renderSubscriptions)) {
      disposeRenderSubscription();
    }
    for (const disposeWatch of Array.from(this.watches)) disposeWatch();
    this.#core.subscriptions.assertClearAllowed();
    for (const installation of Array.from(this.installations).reverse()) {
      this.disposeInstallation(installation);
    }

    this.#core.events.clearRateLimits();
    this.#core.events.clearDelayedEffects();
    this.#core.events.dispose();
    const disposeError = new Error(`[reflex] Runtime '${this.runtimeId}' was disposed.`);
    markRuntimeDisposed(this.#core);
    notifyRuntimeProbe(this.#core, 'runtimeDisposed', disposeError);
    disposeTracing(this.#core);
    this.#core.events.clearInterceptors();
    this.clearHandlersInternal();
    detachRuntimeProbes(this.#core);
  }

  private assertUsable(): void {
    assertRuntimeUsable(this.#core);
  }

  private clearHandlersInternal(): void {
    this.#core.subscriptions.assertClearAllowed();
    this.#core.registry.clear();
    this.#core.events.clearEventDefinitions();
    this.#core.subscriptions.clearDefinitions();
  }

  private recordRegistration(registration: RegistrationHandle): void {
    this.activeInstallation?.registrations.push(registration);
  }

  private disposeInstallation(installation: ModuleInstallation): void {
    if (installation.disposed) return;

    for (const registration of installation.registrations) {
      registration.assertReleasable?.();
    }

    const cleanup = installation.cleanup;
    installation.cleanup = undefined;
    cleanup?.();

    for (let index = installation.registrations.length - 1; index >= 0; index--) {
      const registration = installation.registrations[index]!;
      registration.release();
    }

    installation.disposed = true;
    this.installations.delete(installation);
  }
}

export function createReflexRuntime<
  TContracts extends ReflexContracts,
  TState extends ContractState<TContracts> = ContractState<TContracts>,
>(options: NonArrayRuntimeOptions<TState>): ReflexRuntime<TContracts>;
export function createReflexRuntime<TState extends Record<string, any>>(
  options: NonArrayRuntimeOptions<TState>,
): ReflexRuntime<StateInferredContracts<TState>>;
export function createReflexRuntime(options: CreateReflexRuntimeOptions<any>): ReflexRuntime<any> {
  const core = createRuntimeCore(options);
  const implementation = new ReflexRuntimeImplementation(core, options.initialState);
  const runtime = implementation.createPublicRuntime();
  const client = implementation.getClientForInternalUse();
  core.effectRuntime = client;
  RUNTIME_BINDINGS.set(runtime, { implementation, role: 'owner' });
  RUNTIME_BINDINGS.set(client, { implementation, role: 'client' });
  return runtime;
}

/** @internal Test-only owner facade with administrative operations attached. */
export function createReflexRuntimeForTests<
  TContracts extends ReflexContracts,
  TState extends ContractState<TContracts> = ContractState<TContracts>,
>(
  options: NonArrayRuntimeOptions<TState>,
): ReflexRuntime<TContracts> & ReflexRuntimeAdmin<TContracts>;
export function createReflexRuntimeForTests<TState extends Record<string, any>>(
  options: NonArrayRuntimeOptions<TState>,
): ReflexRuntime<StateInferredContracts<TState>> &
  ReflexRuntimeAdmin<StateInferredContracts<TState>>;
export function createReflexRuntimeForTests(
  options: CreateReflexRuntimeOptions<any>,
): ReflexRuntime<any> & ReflexRuntimeAdmin<any> {
  const owner = createReflexRuntime(options);
  const implementation = getRuntimeOwnerImplementation(
    owner,
    '[reflex] Expected a runtime created by createReflexRuntime().',
  );
  const testRuntime = Object.freeze({
    ...owner,
    getState: implementation.getState.bind(implementation),
    flush: implementation.flush.bind(implementation),
    dispatchSync: implementation.dispatchSync.bind(implementation),
    getStateRevisions: implementation.getStateRevisions.bind(implementation),
    restoreState: implementation.restoreState.bind(implementation),
    getSubscriptionValue: implementation.getSubscriptionValue.bind(implementation),
    watchSubscription: implementation.watchSubscription.bind(implementation),
    addInterceptor: implementation.addInterceptor.bind(implementation),
    setEventErrorHandler: implementation.setEventErrorHandler.bind(implementation),
    clearEventErrorHandler: implementation.clearEventErrorHandler.bind(implementation),
    getInterceptors: implementation.getInterceptors.bind(implementation),
    removeInterceptor: implementation.removeInterceptor.bind(implementation),
    setEqualityCheck: implementation.setEqualityCheck.bind(implementation),
    getEqualityCheck: implementation.getEqualityCheck.bind(implementation),
    enableTracing: implementation.enableTracing.bind(implementation),
    disableTracing: implementation.disableTracing.bind(implementation),
    enableTracePrint: implementation.enableTracePrint.bind(implementation),
    registerTraceCallback: implementation.registerTraceCallback.bind(implementation),
    removeTraceCallback: implementation.removeTraceCallback.bind(implementation),
    getHandlers: implementation.getHandlers.bind(implementation),
    clearHandlers: implementation.clearHandlers.bind(implementation),
    clearSubs: implementation.clearSubs.bind(implementation),
    clearSubscriptionCache: implementation.clearSubscriptionCache.bind(implementation),
    getSubscriptionDiagnostics: implementation.getSubscriptionDiagnostics.bind(implementation),
  });
  RUNTIME_BINDINGS.set(testRuntime, { implementation, role: 'owner' });
  return testRuntime as unknown as ReflexRuntime<any> & ReflexRuntimeAdmin<any>;
}

/** @internal Test-only access for focused engine subsystem tests. */
export function getRuntimeCoreForTests<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
): RuntimeCore {
  return getRuntimeOwnerImplementation(
    runtime,
    '[reflex] Expected a runtime created by createReflexRuntime().',
  ).getCoreForInternalUse();
}

/** @internal Administrative access used by testing and development adapters. */
export function getRuntimeAdminForTests<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
): ReflexRuntimeAdmin<TContracts> {
  return getRuntimeOwnerImplementation(
    runtime,
    '[reflex] Expected a runtime created by createReflexRuntime().',
  ) as unknown as ReflexRuntimeAdmin<TContracts>;
}

/** @internal Core access used by the separate DevTools entrypoint. */
export function getRuntimeCoreForDevtools(runtime: object): RuntimeCore {
  return getRuntimeOwnerImplementation(
    runtime,
    '[reflex] DevTools require a runtime created by createReflexRuntime().',
  ).getCoreForInternalUse();
}

/** @internal Return the stable app-consumer facade for a runtime owner. */
export function getRuntimeClient<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
): ReflexRuntimeClient<TContracts> {
  return getRuntimeOwnerImplementation(
    runtime,
    '[reflex] ReflexProvider requires a runtime created by createReflexRuntime().',
  ).getClientForInternalUse() as ReflexRuntimeClient<TContracts>;
}

/** @internal Normalize an owner or client facade to the stable client identity. */
export function getRuntimeClientForInternalUse<TContracts extends ReflexContracts>(
  runtime: ReflexRuntimeClient<TContracts>,
): ReflexRuntimeClient<TContracts> {
  return getRuntimeImplementation(
    runtime,
    '[reflex] Expected a runtime created by createReflexRuntime().',
  ).getClientForInternalUse() as ReflexRuntimeClient<TContracts>;
}

/** @internal Subscription access used by the React binding without widening its client API. */
export function getSubscriptionValueForInternalUse<TContracts extends ReflexContracts>(
  runtime: ReflexRuntimeClient<TContracts>,
  query: ContractSubscribeVector<TContracts>,
): unknown {
  return getRuntimeImplementation(
    runtime,
    '[reflex] Expected a runtime created by createReflexRuntime().',
  ).getSubscriptionValue(query as SubVector);
}

/** @internal Subscription access used by the React binding without widening its client API. */
export function watchSubscriptionForInternalUse<TContracts extends ReflexContracts>(
  runtime: ReflexRuntimeClient<TContracts>,
  query: ContractSubscribeVector<TContracts>,
  listener: WatchSubscriptionListener<any>,
  options?: WatchSubscriptionOptions,
): ReflexDisposer {
  return getRuntimeImplementation(
    runtime,
    '[reflex] Expected a runtime created by createReflexRuntime().',
  ).watchSubscription(query as SubVector, listener, options);
}

/** @internal Register the React binding as a render listener. */
export function subscribeForRender(
  runtime: ReflexRuntimeClient<any>,
  query: ContractSubscribeVector<any>,
  listener: () => void,
  componentName?: string,
): ReflexDisposer {
  return getRuntimeImplementation(
    runtime,
    '[reflex] React subscriptions require a runtime created by createReflexRuntime().',
  ).subscribeForRender(query, listener, componentName);
}

/** @internal Clear one explicit runtime's subscriptions for an imminent HMR remount. */
export function clearRuntimeSubsForHotReload<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
  subscriptionIds?: readonly Id[],
): void {
  getRuntimeOwnerImplementation(
    runtime,
    '[reflex] setupSubsHotReload requires a runtime created by createReflexRuntime().',
  ).clearSubsForHotReload(subscriptionIds);
}

function getRuntimeOwnerImplementation(
  runtime: object,
  errorMessage: string,
): ReflexRuntimeImplementation<any> {
  const binding = RUNTIME_BINDINGS.get(runtime);
  if (binding?.role !== 'owner') throw new Error(errorMessage);
  return binding.implementation;
}

function getRuntimeImplementation(
  runtime: object,
  errorMessage: string,
): ReflexRuntimeImplementation<any> {
  const binding = RUNTIME_BINDINGS.get(runtime);
  if (!binding) throw new Error(errorMessage);
  return binding.implementation;
}
