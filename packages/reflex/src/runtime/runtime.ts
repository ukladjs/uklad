import type {
  ContractDb,
  ContractDispatchVector,
  ContractEffectId,
  ContractEffectParams,
  ContractEffects,
  ContractEventId,
  ContractEventParams,
  ContractSubscribeVector,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  CreateReflexRuntimeOptions,
  DefaultReflexContracts,
  PermissiveReflexContracts,
  ReflexContracts,
  ReflexDisposer,
  ReflexModule,
  WatchSubscriptionListener,
  WatchSubscriptionOptions,
} from '../contracts';
import {
  disableTracingForRuntime,
  disposeTracingForRuntime,
  enableTracePrintForRuntime,
  enableTracingForRuntime,
  registerTraceCallbackForRuntime,
  removeTraceCallbackForRuntime,
} from '../core/tracing';
import {
  getGlobalEqualityCheckForRuntime,
  setGlobalEqualityCheckForRuntime,
} from '../core/equality';
import { regCoeffectForRuntime } from '../events/coeffects';
import { clearDelayedEffectsForRuntime, regEffectForRuntime } from '../events/effects';
import {
  clearGlobalInterceptorRegistrationForRuntime,
  clearGlobalInterceptorsForRuntime,
  getGlobalInterceptorRegistrationVersionForRuntime,
  getGlobalInterceptorsForRuntime,
  regGlobalInterceptorForRuntime,
} from '../events/global-interceptors';
import {
  getHandlingEventIdForRuntime,
  regEventErrorHandlerForRuntime,
  registerBuiltInErrorHandler,
} from '../events/pipeline';
import {
  clearAllForRuntime as clearRateLimitsForRuntime,
  debounceAndDispatchForRuntime,
  throttleAndDispatchForRuntime,
} from '../events/rate-limit';
import { regEventForRuntime } from '../events/registration';
import {
  dispatchForRuntime,
  dispatchSyncForRuntime,
  disposeEventQueueForRuntime,
  flushRuntime,
  initializeEventRouterForRuntime,
  isEventQueueIdleForRuntime,
} from '../events/router';
import { createReflexInspectorForRuntime } from '../inspector';
import { getAppDbForRuntime, initAppDbForRuntime } from './app-db';
import { clearInterceptorsForRuntime } from './event-metadata';
import { isEventVector } from '../core/validation';
import {
  clearHandlerRegistrationForRuntime,
  getHandlerRegistrationVersionForRuntime,
  getHandlersForRuntime,
  hasHandlerForRuntime,
} from './handlers';
import { clearHandlersForRuntime } from './reset';
import {
  createRuntimeScope,
  defaultRuntimeScope,
  isRuntimeDisposed,
  markRuntimeDisposed,
  type RuntimeScope,
} from './scope';
import {
  assertSubscriptionDefinitionCanBeClearedForRuntime,
  clearSubscriptionCacheForRuntime,
  clearSubscriptionDefinitionsForRuntime,
  clearSubsForHotReloadForRuntime,
  clearSubsForRuntime,
  getSubscriptionDiagnosticsForRuntime,
} from './subscriptions/cache';
import {
  assertPublicationAllowedForRuntime,
  assertSubscriptionsCanBeClearedForRuntime,
  getSubscriptionSnapshotForRuntime,
  subscribeToSubscriptionForRuntime,
} from './subscriptions/engine';
import {
  getOrCreateSubscriptionForRuntime,
  getSubscriptionValueForRuntime,
} from '../subscriptions/queries';
import { regSubForRuntime } from '../subscriptions/registration';

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

export type RuntimeEventHandler<
  TContracts extends ReflexContracts,
  TId extends ContractEventId<TContracts>,
> = (
  coeffects: CoEffects<ContractDb<TContracts>>,
  ...params: ContractEventParams<TContracts, TId>
) => ContractEffects<TContracts> | void;

export type RuntimeSubscriptionHandler<
  TContracts extends ReflexContracts,
  TId extends ContractSubscriptionId<TContracts>,
> = (...values: any[]) => ContractSubscriptionResult<TContracts, TId>;

export interface ReflexRuntime<TContracts extends ReflexContracts = PermissiveReflexContracts> {
  readonly runtimeId: string;
  readonly runtimeName: string;

  getAppDb(): ContractDb<TContracts>;
  restoreAppDb(nextDb: ContractDb<TContracts>): void;
  dispatch(event: ContractDispatchVector<TContracts>): void;
  dispatchSync(event: ContractDispatchVector<TContracts>): void;
  flush(): Promise<void>;

  regEvent<TId extends ContractEventId<TContracts>>(
    id: TId,
    handler: RuntimeEventHandler<TContracts, TId>,
    options?:
      EventRegistrationOptions<ContractDb<TContracts>> | Interceptor<ContractDb<TContracts>>[],
  ): void;
  regEffect<TId extends ContractEffectId<TContracts>>(
    id: TId,
    handler: (value: ContractEffectParams<TContracts, TId>) => void,
  ): void;
  regCoeffect(id: string, handler: CoEffectHandler<ContractDb<TContracts>>): void;
  regEventErrorHandler(handler: ErrorHandler): void;
  regSub<TId extends ContractSubscriptionId<TContracts>>(id: TId): void;
  regSub<TId extends ContractSubscriptionId<TContracts>>(id: TId, sourceKey: string): void;
  regSub<TId extends ContractSubscriptionId<TContracts>>(
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

  regGlobalInterceptor(interceptor: Interceptor<ContractDb<TContracts>>): void;
  getGlobalInterceptors(): Interceptor<ContractDb<TContracts>>[];
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

function assertRuntimeDb(
  value: unknown,
  field: 'initialDb' | 'restoreAppDb nextDb',
): asserts value is Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`[reflex] ${field} must be a non-null, non-array object.`);
  }
}

class ReflexRuntimeImplementation<TContracts extends ReflexContracts> {
  readonly scope: RuntimeScope;
  private activeInstallation: ModuleInstallation | null = null;
  private readonly installations = new Set<ModuleInstallation>();
  private readonly watches = new Set<ReflexDisposer>();
  private readonly renderSubscriptions = new Set<ReflexDisposer>();

  constructor(scope: RuntimeScope, initialDb: ContractDb<TContracts>) {
    assertRuntimeDb(initialDb, 'initialDb');
    this.scope = scope;
    registerBuiltInErrorHandler(scope);
    initializeEventRouterForRuntime(scope);
    initAppDbForRuntime<ContractDb<TContracts>>(scope, initialDb);
  }

  get runtimeId(): string {
    return this.scope.runtimeId;
  }

  get runtimeName(): string {
    return this.scope.runtimeName;
  }

  getAppDb(): ContractDb<TContracts> {
    this.assertUsable();
    return getAppDbForRuntime<ContractDb<TContracts>>(this.scope);
  }

  restoreAppDb(nextDb: ContractDb<TContracts>): void {
    this.assertUsable();
    assertRuntimeDb(nextDb, 'restoreAppDb nextDb');
    if (
      !isEventQueueIdleForRuntime(this.scope) ||
      getHandlingEventIdForRuntime(this.scope) !== null
    ) {
      throw new Error(
        `[reflex] Cannot restore runtime '${this.runtimeId}' while an event is pending or being handled. Await runtime.flush() first.`,
      );
    }
    assertPublicationAllowedForRuntime(this.scope);
    initAppDbForRuntime<ContractDb<TContracts>>(this.scope, nextDb);
  }

  dispatch(event: ContractDispatchVector<TContracts>): void {
    this.assertUsable();
    this.assertDispatchableEvent(event, 'dispatch');
    dispatchForRuntime(this.scope, event as any);
  }

  dispatchSync(event: ContractDispatchVector<TContracts>): void {
    this.assertUsable();
    this.assertDispatchableEvent(event, 'dispatchSync');
    dispatchSyncForRuntime(this.scope, event as any);
  }

  flush(): Promise<void> {
    this.assertUsable();
    return flushRuntime(this.scope);
  }

  regEvent(
    id: Id,
    handler: RuntimeEventHandler<TContracts, any>,
    options?:
      EventRegistrationOptions<ContractDb<TContracts>> | Interceptor<ContractDb<TContracts>>[],
  ): void {
    this.assertUsable();
    regEventForRuntime(this.scope, id, handler as any, options);
    this.recordHandler('event', id, true);
  }

  regEffect(id: Id, handler: (value: any) => void): void {
    this.assertUsable();
    regEffectForRuntime(this.scope, id, handler);
    this.recordHandler('fx', id, false);
  }

  regCoeffect(id: string, handler: CoEffectHandler<ContractDb<TContracts>>): void {
    this.assertUsable();
    regCoeffectForRuntime(this.scope, id, handler as unknown as CoEffectHandler);
    this.recordHandler('cofx', id, false);
  }

  regEventErrorHandler(handler: ErrorHandler): void {
    this.assertUsable();
    regEventErrorHandlerForRuntime(this.scope, handler);
    this.recordHandler('error', 'event-handler', false);
  }

  regSub(
    id: Id,
    compute?: RuntimeSubscriptionHandler<TContracts, any> | string,
    dependencies?: (...params: any[]) => ContractSubscribeVector<TContracts>[],
    config?: SubConfig,
  ): void {
    this.assertUsable();
    const previousVersion = getHandlerRegistrationVersionForRuntime(this.scope, 'sub', id);
    regSubForRuntime(this.scope, id, compute as any, dependencies as any, config);
    const version = getHandlerRegistrationVersionForRuntime(this.scope, 'sub', id);
    if (this.activeInstallation && version !== undefined && version !== previousVersion) {
      this.activeInstallation.registrations.push({ type: 'subscription', id, version });
    }
  }

  getSubscriptionValue(query: ContractSubscribeVector<TContracts>): unknown {
    this.assertUsable();
    this.assertRegisteredSubscription(query);
    return getSubscriptionValueForRuntime(this.scope, query as SubVector);
  }

  watchSubscription(
    query: ContractSubscribeVector<TContracts>,
    listener: WatchSubscriptionListener<any>,
    options: WatchSubscriptionOptions = {},
  ): ReflexDisposer {
    this.assertUsable();
    this.assertRegisteredSubscription(query);
    const subscription = getOrCreateSubscriptionForRuntime(this.scope, query as SubVector);
    if (!subscription) {
      throw new Error(
        `[reflex] Failed to build the subscription graph for '${String((query as SubVector)[0])}' in runtime '${this.runtimeId}'.`,
      );
    }

    let previousValue = getSubscriptionSnapshotForRuntime(this.scope, subscription);
    const unsubscribe = subscribeToSubscriptionForRuntime(
      this.scope,
      subscription,
      () => {
        const nextValue = getSubscriptionSnapshotForRuntime(this.scope, subscription);
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
    const subscription = getOrCreateSubscriptionForRuntime(this.scope, query as SubVector);
    if (!subscription) {
      throw new Error(
        `[reflex] Failed to build the subscription graph for '${String((query as SubVector)[0])}' in runtime '${this.runtimeId}'.`,
      );
    }

    const unsubscribe = subscribeToSubscriptionForRuntime(
      this.scope,
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

  regGlobalInterceptor(interceptor: Interceptor<ContractDb<TContracts>>): void {
    this.assertUsable();
    regGlobalInterceptorForRuntime(this.scope, interceptor as unknown as Interceptor);
    const version = getGlobalInterceptorRegistrationVersionForRuntime(this.scope, interceptor.id);
    if (this.activeInstallation && version !== undefined) {
      this.activeInstallation.registrations.push({
        type: 'global-interceptor',
        id: interceptor.id,
        version,
      });
    }
  }

  getGlobalInterceptors(): Interceptor<ContractDb<TContracts>>[] {
    this.assertUsable();
    return getGlobalInterceptorsForRuntime(this.scope) as unknown as Interceptor<
      ContractDb<TContracts>
    >[];
  }

  clearGlobalInterceptors(id?: string): void {
    this.assertUsable();
    clearGlobalInterceptorsForRuntime(this.scope, id);
  }

  setGlobalEqualityCheck(equalityCheck: EqualityCheckFn): void {
    this.assertUsable();
    setGlobalEqualityCheckForRuntime(this.scope, equalityCheck);
  }

  getGlobalEqualityCheck(): EqualityCheckFn {
    this.assertUsable();
    return getGlobalEqualityCheckForRuntime(this.scope);
  }

  enableTracing(): void {
    this.assertUsable();
    enableTracingForRuntime(this.scope);
  }

  disableTracing(): void {
    this.assertUsable();
    disableTracingForRuntime(this.scope);
  }

  enableTracePrint(): void {
    this.assertUsable();
    enableTracePrintForRuntime(this.scope);
  }

  registerTraceCallback(key: string, callback: TraceCallback): void {
    this.assertUsable();
    registerTraceCallbackForRuntime(this.scope, key, callback);
  }

  removeTraceCallback(key: string): void {
    this.assertUsable();
    removeTraceCallbackForRuntime(this.scope, key);
  }

  debounceAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void {
    this.assertUsable();
    debounceAndDispatchForRuntime(this.scope, event as any, durationMs);
  }

  throttleAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void {
    this.assertUsable();
    throttleAndDispatchForRuntime(this.scope, event as any, durationMs);
  }

  getHandlers(): HandlerRegistry {
    this.assertUsable();
    return getHandlersForRuntime(this.scope);
  }

  clearHandlers(kind?: HandlerKind, id?: Id): void {
    this.assertUsable();
    clearHandlersForRuntime(this.scope, kind, id);
  }

  clearSubs(): void {
    this.assertUsable();
    clearSubsForRuntime(this.scope);
  }

  /** @internal Clear definitions immediately before the owning React tree remounts. */
  clearSubsForHotReload(subscriptionIds?: readonly Id[]): void {
    this.assertUsable();
    clearSubsForHotReloadForRuntime(this.scope, subscriptionIds);
  }

  clearSubscriptionCache(key?: string): void {
    this.assertUsable();
    clearSubscriptionCacheForRuntime(this.scope, key);
  }

  getSubscriptionDiagnostics(): readonly SubscriptionDiagnostic[] {
    this.assertUsable();
    return getSubscriptionDiagnosticsForRuntime(this.scope);
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
    return createReflexInspectorForRuntime(this.scope);
  }

  dispose(): void {
    if (isRuntimeDisposed(this.scope)) return;
    if (this.scope === defaultRuntimeScope) {
      throw new Error('[reflex] The compatibility default runtime cannot be disposed.');
    }

    for (const disposeRenderSubscription of Array.from(this.renderSubscriptions)) {
      disposeRenderSubscription();
    }
    for (const disposeWatch of Array.from(this.watches)) disposeWatch();
    assertSubscriptionsCanBeClearedForRuntime(this.scope);
    for (const installation of Array.from(this.installations).reverse()) {
      this.disposeInstallation(installation);
    }

    clearRateLimitsForRuntime(this.scope);
    clearDelayedEffectsForRuntime(this.scope);
    disposeEventQueueForRuntime(this.scope);
    disposeTracingForRuntime(this.scope);
    clearGlobalInterceptorsForRuntime(this.scope);
    clearHandlersForRuntime(this.scope);
    markRuntimeDisposed(this.scope);
  }

  private assertUsable(): void {
    if (isRuntimeDisposed(this.scope)) {
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
    if (!hasHandlerForRuntime(this.scope, 'event', event[0])) {
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
    if (!hasHandlerForRuntime(this.scope, 'sub', query[0])) {
      throw new Error(
        `[reflex] No subscription registered for '${query[0]}' in runtime '${this.runtimeId}'. Register it with regSub() before use.`,
      );
    }
  }

  private recordHandler(kind: HandlerKind, id: Id, clearEventMetadata: boolean): void {
    if (!this.activeInstallation) return;
    const version = getHandlerRegistrationVersionForRuntime(this.scope, kind, id);
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
        getHandlerRegistrationVersionForRuntime(this.scope, 'sub', registration.id) ===
          registration.version
      ) {
        assertSubscriptionDefinitionCanBeClearedForRuntime(this.scope, registration.id);
      }
    }

    const cleanup = installation.cleanup;
    installation.cleanup = undefined;
    cleanup?.();

    for (let index = installation.registrations.length - 1; index >= 0; index--) {
      const registration = installation.registrations[index]!;
      if (registration.type === 'subscription') {
        if (
          getHandlerRegistrationVersionForRuntime(this.scope, 'sub', registration.id) ===
          registration.version
        ) {
          clearSubscriptionDefinitionsForRuntime(this.scope, registration.id);
        }
        continue;
      }
      if (registration.type === 'global-interceptor') {
        clearGlobalInterceptorRegistrationForRuntime(
          this.scope,
          registration.id,
          registration.version,
        );
        continue;
      }
      const cleared = clearHandlerRegistrationForRuntime(
        this.scope,
        registration.kind,
        registration.id,
        registration.version,
      );
      if (cleared && registration.clearEventMetadata) {
        clearInterceptorsForRuntime(this.scope, registration.id);
      }
    }

    installation.disposed = true;
    this.installations.delete(installation);
  }
}

type DbInferredContracts<TDb extends Record<string, any>> = ReflexContracts & {
  readonly db: TDb;
};

type NonArrayRuntimeOptions<TDb extends Record<string, any>> = CreateReflexRuntimeOptions<TDb> &
  (TDb extends readonly any[] ? never : unknown);

export function createReflexRuntime<
  TContracts extends ReflexContracts,
  TDb extends ContractDb<TContracts> = ContractDb<TContracts>,
>(options: NonArrayRuntimeOptions<TDb>): ReflexRuntime<TContracts>;
export function createReflexRuntime<TDb extends Record<string, any>>(
  options: NonArrayRuntimeOptions<TDb>,
): ReflexRuntime<DbInferredContracts<TDb>>;
export function createReflexRuntime(options: CreateReflexRuntimeOptions<any>): ReflexRuntime<any> {
  const scope = createRuntimeScope(options);
  return new ReflexRuntimeImplementation(scope, options.initialDb) as unknown as ReflexRuntime<any>;
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

export const defaultRuntime: ReflexRuntime<DefaultReflexContracts> =
  new ReflexRuntimeImplementation<DefaultReflexContracts>(
    defaultRuntimeScope,
    {} as unknown as ContractDb<DefaultReflexContracts>,
  ) as unknown as ReflexRuntime<DefaultReflexContracts>;

/** Replace the compatibility default runtime's app-db. */
export function restoreAppDb(nextDb: ContractDb<DefaultReflexContracts>): void {
  defaultRuntime.restoreAppDb(nextDb);
}

/** Wait for the compatibility default runtime to reach an idle publication boundary. */
export function flush(): Promise<void> {
  return defaultRuntime.flush();
}

/** Watch a subscription in the compatibility default runtime. */
export function watchSubscription<TId extends ContractSubscriptionId<DefaultReflexContracts>>(
  query: ContractSubscriptionVector<DefaultReflexContracts, TId>,
  listener: WatchSubscriptionListener<ContractSubscriptionResult<DefaultReflexContracts, TId>>,
  options?: WatchSubscriptionOptions,
): ReflexDisposer {
  return defaultRuntime.watchSubscription(query, listener, options);
}

/** Install a scoped feature in the compatibility default runtime. */
export function registerModule(
  module: ReflexModule<ReflexRuntime<DefaultReflexContracts>>,
): ReflexDisposer {
  return defaultRuntime.registerModule(module);
}
