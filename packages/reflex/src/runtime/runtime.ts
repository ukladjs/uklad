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
} from '../core/tracing';
import { getGlobalEqualityCheck, setGlobalEqualityCheck } from '../core/equality';
import { defaultErrorHandler } from '../events/runner';
import { createReflexInspector } from '../inspector';
import { clearHandlers } from './reset';
import {
  createRuntimeCore,
  isRuntimeDisposed,
  markRuntimeDisposed,
  type RuntimeCore,
} from './core';
import { observeRuntimeLifecycle } from './lifecycle';
import { detachRuntimeProbes, notifyRuntimeProbe } from './probe';
import {
  assertDispatchableEvent,
  assertRegisteredSubscription,
  assertRuntimeUsable,
  assertStateRecord,
} from './validation';

import type { TraceCallback } from '../core/tracing-types';
import type { ReflexInspector } from '../inspector-types';
import type { HandlerKind, HandlerRegistry, RegistrationOwnership } from './handler-types';
import type { RuntimeLifecycleObserver } from './lifecycle-types';
import type { SubscriptionDiagnostic } from './subscriptions/types';
import type {
  ReflexRuntime,
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
  ReflexRuntime,
  RuntimeEventHandler,
  RuntimeStateRevisions,
  RuntimeSubscriptionHandler,
} from './api';

interface ModuleInstallation {
  readonly registrations: RegistrationOwnership[];
  cleanup: ReflexDisposer | undefined;
  disposed: boolean;
}

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

  constructor(core: RuntimeCore, initialState: ContractState<TContracts>) {
    assertStateRecord(initialState, 'initialState');
    this.#core = core;
    core.registry.registerSystem('error', 'event-handler', defaultErrorHandler);
    core.events.initialize();
    core.state.initialize<ContractState<TContracts>>(initialState);
  }

  static getCoreForTests(runtime: ReflexRuntimeImplementation<any>): RuntimeCore {
    return runtime.#core;
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
    options?:
      | EventRegistrationOptions<ContractState<TContracts>>
      | Interceptor<ContractState<TContracts>>[],
  ): void {
    this.assertUsable();
    this.recordOwnership(this.#core.events.registerEvent(id, handler as any, options));
  }

  regEffect(id: Id, handler: (value: any) => void): void {
    this.assertUsable();
    this.recordOwnership(this.#core.registry.register('fx', id, handler));
  }

  regCoeffect(id: string, handler: CoEffectHandler<ContractState<TContracts>>): void {
    this.assertUsable();
    this.recordOwnership(
      this.#core.registry.register('cofx', id, handler as unknown as CoEffectHandler),
    );
  }

  regEventErrorHandler(handler: ErrorHandler): void {
    this.assertUsable();
    this.recordOwnership(this.#core.registry.register('error', 'event-handler', handler));
  }

  regSub(
    id: Id,
    compute?: RuntimeSubscriptionHandler<TContracts, any> | string,
    dependencies?: (...params: any[]) => ContractSubscribeVector<TContracts>[],
    config?: SubConfig,
  ): void {
    this.assertUsable();
    const ownership = this.#core.subscriptions.register(
      id,
      compute as any,
      dependencies as any,
      config,
    );
    if (ownership) this.recordOwnership(ownership);
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

  regGlobalInterceptor(interceptor: Interceptor<ContractState<TContracts>>): void {
    this.assertUsable();
    this.recordOwnership(
      this.#core.registry.registerGlobalInterceptor(interceptor as unknown as Interceptor),
    );
  }

  getGlobalInterceptors(): Interceptor<ContractState<TContracts>>[] {
    this.assertUsable();
    return this.#core.registry.getGlobalInterceptors() as unknown as Interceptor<
      ContractState<TContracts>
    >[];
  }

  clearGlobalInterceptors(id?: string): void {
    this.assertUsable();
    this.#core.registry.clearGlobalInterceptors(id);
  }

  setGlobalEqualityCheck(equalityCheck: EqualityCheckFn): void {
    this.assertUsable();
    setGlobalEqualityCheck(this.#core, equalityCheck);
  }

  getGlobalEqualityCheck(): EqualityCheckFn {
    this.assertUsable();
    return getGlobalEqualityCheck(this.#core);
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
    this.#core.events.debounce(event as any, durationMs);
  }

  throttleAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void {
    this.assertUsable();
    this.#core.events.throttle(event as any, durationMs);
  }

  getHandlers(): HandlerRegistry {
    this.assertUsable();
    return this.#core.registry.handlers;
  }

  clearHandlers(kind?: HandlerKind, id?: Id): void {
    this.assertUsable();
    clearHandlers(this.#core, kind, id);
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

  observeLifecycle(observer: RuntimeLifecycleObserver): ReflexDisposer {
    this.assertUsable();
    return observeRuntimeLifecycle(this.#core, observer);
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
    return createReflexInspector(this.#core);
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
    this.#core.registry.clearGlobalInterceptors();
    clearHandlers(this.#core);
    detachRuntimeProbes(this.#core);
  }

  private assertUsable(): void {
    assertRuntimeUsable(this.#core);
  }

  private recordOwnership(ownership: RegistrationOwnership): void {
    this.activeInstallation?.registrations.push(ownership);
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
  return new ReflexRuntimeImplementation(
    core,
    options.initialState,
  ) as unknown as ReflexRuntime<any>;
}

/** @internal Test-only access for focused engine subsystem tests. */
export function getRuntimeCoreForTests(runtime: ReflexRuntime<any>): RuntimeCore {
  return ReflexRuntimeImplementation.getCoreForTests(
    getRuntimeImplementation(
      runtime,
      '[reflex] Expected a runtime created by createReflexRuntime().',
    ),
  );
}

/** @internal Register the React binding as a render listener. */
export function subscribeForRender(
  runtime: ReflexRuntime<any>,
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
export function clearRuntimeSubsForHotReload(
  runtime: ReflexRuntime<any>,
  subscriptionIds?: readonly Id[],
): void {
  getRuntimeImplementation(
    runtime,
    '[reflex] setupSubsHotReload requires a runtime created by createReflexRuntime().',
  ).clearSubsForHotReload(subscriptionIds);
}

function getRuntimeImplementation(
  runtime: ReflexRuntime<any>,
  errorMessage: string,
): ReflexRuntimeImplementation<any> {
  if (!(runtime instanceof ReflexRuntimeImplementation)) {
    throw new Error(errorMessage);
  }
  return runtime;
}
