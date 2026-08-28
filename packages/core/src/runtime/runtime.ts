import type {
  ContractState,
  ContractDispatchVector,
  ContractSubscribeVector,
  ContractSubscriptionParamsAreValid,
  CreateUkladRuntimeOptions,
  UkladContracts,
  UkladDisposer,
  UkladModule,
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
  assertCoeffectId,
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
import type { ExternalSubscriptionDriver } from './subscriptions/types';
import type {
  UkladRuntime,
  UkladRuntimeAdmin,
  UkladRuntimeClient,
  UkladRegistrar,
  RuntimeStateRevisions,
  RuntimeSubscriptionHandler,
} from './api';
import type {
  CoEffectHandler,
  EqualityCheckFn,
  ErrorHandler,
  EventHandler,
  EventRegistrationOptions,
  Id,
  Interceptor,
  SubConfig,
  SubscriptionExtension,
  SubscriptionExtensionContext,
  SubVector,
} from '../types';

export type {
  UkladRegistrar,
  UkladRuntime,
  UkladRuntimeAdmin,
  UkladRuntimeClient,
  RuntimeEventHandler,
  RuntimeStateRevisions,
  RuntimeExternalSubscriptionDriverFactory,
  RuntimeSubscriptionExtensionFactory,
  RuntimeSubscriptionHandler,
} from './api';

interface ModuleInstallation {
  readonly registrations: RegistrationHandle[];
  cleanup: UkladDisposer | undefined;
  disposed: boolean;
}

type RuntimeFacadeRole = 'owner' | 'client';

interface RuntimeBinding {
  readonly implementation: UkladRuntimeImplementation<any>;
  readonly role: RuntimeFacadeRole;
}

/** Private identity table for the frozen facades produced by this module. */
const RUNTIME_BINDINGS = new WeakMap<object, RuntimeBinding>();

type StateInferredContracts<TState extends Record<string, any>> = UkladContracts & {
  readonly state: TState;
};

type NonArrayRuntimeOptions<TState extends Record<string, any>> =
  CreateUkladRuntimeOptions<TState> & (TState extends readonly any[] ? never : unknown);

/** Make an invalid subscription-parameter contract fail at typed runtime creation. */
type SubscriptionParameterContractGuard<TContracts> =
  ContractSubscriptionParamsAreValid<TContracts> extends true
    ? unknown
    : { readonly __ukladSubscriptionParamsMustBeScalars: never };

class UkladRuntimeImplementation<TContracts extends UkladContracts> {
  /** The only owner of this runtime's mutable engine services. */
  readonly #core: RuntimeCore;
  private activeInstallation: ModuleInstallation | null = null;
  private readonly installations = new Set<ModuleInstallation>();
  private readonly watches = new Set<UkladDisposer>();
  private readonly renderSubscriptions = new Set<UkladDisposer>();
  private clientRuntime: UkladRuntimeClient<TContracts> | undefined;

  constructor(core: RuntimeCore, options: CreateUkladRuntimeOptions<ContractState<TContracts>>) {
    const { initialState, equalityCheck, interceptors } = options;
    assertStateRecord(initialState, 'initialState');
    this.#core = core;
    if (equalityCheck !== undefined) {
      if (typeof equalityCheck !== 'function') {
        throw new TypeError('[uklad] runtime equalityCheck must be a function.');
      }
      core.subscriptions.equalityCheck = equalityCheck;
    }
    core.registry.error.registerSystem('event-handler', defaultErrorHandler);
    core.events.initialize();
    core.events.installGlobalInterceptors(
      interceptors as unknown as readonly Interceptor[] | undefined,
    );
    core.state.initialize<ContractState<TContracts>>(initialState);
  }

  getCoreForInternalUse(): RuntimeCore {
    return this.#core;
  }

  createPublicRuntime(): UkladRuntime<TContracts> {
    const client = this.getClientForInternalUse();
    return Object.freeze({
      ...client,
      runtimeInstanceId: this.runtimeInstanceId,
      registerModule: this.registerModule.bind(this),
      dispose: this.dispose.bind(this),
    }) as UkladRuntime<TContracts>;
  }

  getClientForInternalUse(): UkladRuntimeClient<TContracts> {
    this.clientRuntime ??= Object.freeze({
      runtimeId: this.runtimeId,
      runtimeName: this.runtimeName,
      dispatch: this.dispatch.bind(this),
      debounceAndDispatch: this.debounceAndDispatch.bind(this),
      throttleAndDispatch: this.throttleAndDispatch.bind(this),
    }) as UkladRuntimeClient<TContracts>;
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
        `[uklad] Cannot restore runtime '${this.runtimeId}' while an event is pending or being handled. Await runtime.flush() first.`,
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
    handler: EventHandler<any, any>,
    options?: EventRegistrationOptions<ContractState<TContracts>>,
  ): void {
    this.assertUsable();
    this.recordRegistration(this.#core.events.registerEvent(id, handler as any, options));
  }

  regEffect(id: Id, handler: (value: any, runtime: UkladRuntimeClient<any>) => void): void {
    this.assertUsable();
    this.recordRegistration(this.#core.registry.fx.register(id, handler));
  }

  regCoeffect(id: string, handler: CoEffectHandler<any, any>): void {
    this.assertUsable();
    assertCoeffectId(id);
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

  regExternalSub(
    id: Id,
    dependencies: (...params: any[]) => readonly SubVector[],
    createDriver: (...params: any[]) => ExternalSubscriptionDriver<readonly unknown[], any>,
    config?: SubConfig,
  ): void {
    this.assertUsable();
    const registration = this.#core.subscriptions.registerExternal(
      id,
      dependencies as (...params: any[]) => SubVector[],
      createDriver,
      config,
    );
    if (registration) this.recordRegistration(registration);
  }

  regSubExt(
    id: Id,
    signals: (...params: any[]) => readonly SubVector[],
    createExtension: (
      context: SubscriptionExtensionContext,
      ...params: any[]
    ) => SubscriptionExtension<any>,
  ): void {
    this.assertUsable();
    const registration = this.#core.subscriptions.registerExtension(
      id,
      signals as (...params: any[]) => SubVector[],
      createExtension,
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
  ): UkladDisposer {
    this.assertUsable();
    assertRegisteredSubscription(this.#core, query);
    const subscription = this.#core.subscriptions.getOrCreate(query as SubVector);
    if (!subscription) {
      throw new Error(
        `[uklad] Failed to build the subscription graph for '${String((query as SubVector)[0])}' in runtime '${this.runtimeId}'.`,
      );
    }

    let previousValue = this.#core.subscriptions.getSnapshot(subscription);
    let initializing = true;
    const unsubscribe = this.#core.subscriptions.subscribe(
      subscription,
      () => {
        const nextValue = this.#core.subscriptions.getSnapshot(subscription);
        const oldValue = previousValue;
        previousValue = nextValue;
        if (initializing) return;
        listener(nextValue, oldValue);
      },
      options.label ?? 'subscription watcher',
      'watch',
    );
    try {
      // Activation may catch up an external source that changed between the
      // initial read and commit. Emit the watcher's initial value from the
      // settled snapshot rather than the pre-activation one.
      previousValue = this.#core.subscriptions.getSnapshot(subscription);
    } catch (error) {
      unsubscribe();
      throw error;
    }
    initializing = false;

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
  ): UkladDisposer {
    this.assertUsable();
    assertRegisteredSubscription(this.#core, query);
    const subscription = this.#core.subscriptions.getOrCreate(query as SubVector);
    if (!subscription) {
      throw new Error(
        `[uklad] Failed to build the subscription graph for '${String((query as SubVector)[0])}' in runtime '${this.runtimeId}'.`,
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

  registerModule(module: UkladModule<UkladRegistrar<TContracts>>): UkladDisposer {
    return this.installModule(module, () => this.createRegistrar());
  }

  private installModule<TRegistrar>(
    module: UkladModule<TRegistrar>,
    createRegistrar: () => TRegistrar,
  ): UkladDisposer {
    this.assertUsable();
    if (this.activeInstallation) {
      throw new Error('[uklad] registerModule installers cannot be nested.');
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

  private createRegistrar(): UkladRegistrar<TContracts> {
    return Object.freeze({
      regEvent: this.regEvent.bind(this) as UkladRegistrar<TContracts>['regEvent'],
      regEffect: this.regEffect.bind(this),
      regCoeffect: this.regCoeffect.bind(this),
      regRootSub: this.regRootSub.bind(this),
      regSubExt: this.regSubExt.bind(this) as unknown as UkladRegistrar<TContracts>['regSubExt'],
      regExternalSub: this.regExternalSub.bind(
        this,
      ) as UkladRegistrar<TContracts>['regExternalSub'],
      regSub: this.regSub.bind(this),
    });
  }

  dispose(): void {
    if (isRuntimeDisposed(this.#core)) return;
    if (this.#core.events.isRunning) {
      throw new Error(
        `[uklad] Cannot dispose runtime '${this.runtimeId}' while its event queue is synchronously running. Dispose after the current event or runtime.flush() settles.`,
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
    const disposeError = new Error(`[uklad] Runtime '${this.runtimeId}' was disposed.`);
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

export function createUkladRuntime<
  TContracts extends UkladContracts,
  TState extends ContractState<TContracts> = ContractState<TContracts>,
>(
  options: NonArrayRuntimeOptions<TState> & SubscriptionParameterContractGuard<TContracts>,
): UkladRuntime<TContracts>;
export function createUkladRuntime<TState extends Record<string, any>>(
  options: NonArrayRuntimeOptions<TState>,
): UkladRuntime<StateInferredContracts<TState>>;
export function createUkladRuntime(options: CreateUkladRuntimeOptions<any>): UkladRuntime<any> {
  const core = createRuntimeCore(options);
  const implementation = new UkladRuntimeImplementation(core, options);
  const runtime = implementation.createPublicRuntime();
  const client = implementation.getClientForInternalUse();
  core.effectRuntime = client;
  RUNTIME_BINDINGS.set(runtime, { implementation, role: 'owner' });
  RUNTIME_BINDINGS.set(client, { implementation, role: 'client' });
  return runtime;
}

/** @internal Test-only owner facade with administrative operations attached. */
export function createUkladRuntimeForTests<
  TContracts extends UkladContracts,
  TState extends ContractState<TContracts> = ContractState<TContracts>,
>(
  options: NonArrayRuntimeOptions<TState> & SubscriptionParameterContractGuard<TContracts>,
): UkladRuntime<TContracts> & UkladRuntimeAdmin<TContracts>;
export function createUkladRuntimeForTests<TState extends Record<string, any>>(
  options: NonArrayRuntimeOptions<TState>,
): UkladRuntime<StateInferredContracts<TState>> & UkladRuntimeAdmin<StateInferredContracts<TState>>;
export function createUkladRuntimeForTests(
  options: CreateUkladRuntimeOptions<any>,
): UkladRuntime<any> & UkladRuntimeAdmin<any> {
  const owner = createUkladRuntime(options);
  const implementation = getRuntimeOwnerImplementation(
    owner,
    '[uklad] Expected a runtime created by createUkladRuntime().',
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
  return testRuntime as unknown as UkladRuntime<any> & UkladRuntimeAdmin<any>;
}

/** @internal Test-only access for focused engine subsystem tests. */
export function getRuntimeCoreForTests<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
): RuntimeCore {
  return getRuntimeOwnerImplementation(
    runtime,
    '[uklad] Expected a runtime created by createUkladRuntime().',
  ).getCoreForInternalUse();
}

/** @internal Administrative access used to construct bounded public facades. */
export function getRuntimeAdminForInternalUse<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
): UkladRuntimeAdmin<TContracts> {
  return getRuntimeOwnerImplementation(
    runtime,
    '[uklad] Expected a runtime created by createUkladRuntime().',
  ) as unknown as UkladRuntimeAdmin<TContracts>;
}

/** @internal Backward-compatible test helper. */
export function getRuntimeAdminForTests<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
): UkladRuntimeAdmin<TContracts> {
  return getRuntimeAdminForInternalUse(runtime);
}

/** @internal Core access used by the separate DevTools entrypoint. */
export function getRuntimeCoreForDevtools(runtime: object): RuntimeCore {
  return getRuntimeOwnerImplementation(
    runtime,
    '[uklad] DevTools require a runtime created by createUkladRuntime().',
  ).getCoreForInternalUse();
}

/** @internal Return the stable app-consumer facade for a runtime owner. */
export function getRuntimeClient<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
): UkladRuntimeClient<TContracts> {
  return getRuntimeOwnerImplementation(
    runtime,
    '[uklad] UkladProvider requires a runtime created by createUkladRuntime().',
  ).getClientForInternalUse() as UkladRuntimeClient<TContracts>;
}

/** @internal Normalize an owner or client facade to the stable client identity. */
export function getRuntimeClientForInternalUse<TContracts extends UkladContracts>(
  runtime: UkladRuntimeClient<TContracts>,
): UkladRuntimeClient<TContracts> {
  return getRuntimeImplementation(
    runtime,
    '[uklad] Expected a runtime created by createUkladRuntime().',
  ).getClientForInternalUse() as UkladRuntimeClient<TContracts>;
}

/** @internal Subscription access used by the React binding without widening its client API. */
export function getSubscriptionValueForInternalUse<TContracts extends UkladContracts>(
  runtime: UkladRuntimeClient<TContracts>,
  query: ContractSubscribeVector<TContracts>,
): unknown {
  return getRuntimeImplementation(
    runtime,
    '[uklad] Expected a runtime created by createUkladRuntime().',
  ).getSubscriptionValue(query as SubVector);
}

/** @internal Subscription access used by the React binding without widening its client API. */
export function watchSubscriptionForInternalUse<TContracts extends UkladContracts>(
  runtime: UkladRuntimeClient<TContracts>,
  query: ContractSubscribeVector<TContracts>,
  listener: WatchSubscriptionListener<any>,
  options?: WatchSubscriptionOptions,
): UkladDisposer {
  return getRuntimeImplementation(
    runtime,
    '[uklad] Expected a runtime created by createUkladRuntime().',
  ).watchSubscription(query as SubVector, listener, options);
}

/** @internal Register the React binding as a render listener. */
export function subscribeForRender(
  runtime: UkladRuntimeClient<any>,
  query: ContractSubscribeVector<any>,
  listener: () => void,
  componentName?: string,
): UkladDisposer {
  return getRuntimeImplementation(
    runtime,
    '[uklad] React subscriptions require a runtime created by createUkladRuntime().',
  ).subscribeForRender(query, listener, componentName);
}

/** @internal Clear one explicit runtime's subscriptions for an imminent HMR remount. */
export function clearRuntimeSubsForHotReload<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
  subscriptionIds?: readonly Id[],
): void {
  getRuntimeOwnerImplementation(
    runtime,
    '[uklad] setupSubsHotReload requires a runtime created by createUkladRuntime().',
  ).clearSubsForHotReload(subscriptionIds);
}

function getRuntimeOwnerImplementation(
  runtime: object,
  errorMessage: string,
): UkladRuntimeImplementation<any> {
  const binding = RUNTIME_BINDINGS.get(runtime);
  if (binding?.role !== 'owner') throw new Error(errorMessage);
  return binding.implementation;
}

function getRuntimeImplementation(
  runtime: object,
  errorMessage: string,
): UkladRuntimeImplementation<any> {
  const binding = RUNTIME_BINDINGS.get(runtime);
  if (!binding) throw new Error(errorMessage);
  return binding.implementation;
}
