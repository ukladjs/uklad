import type {
  ContractDispatchVector,
  ContractEffectParams,
  ContractEffects,
  ContractEventParams,
  ContractState,
  ContractSubscribeVector,
  ContractSubscriptionDependencyValues,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  PermissiveReflexContracts,
  ReflexContracts,
  ReflexDisposer,
  ReflexModule,
  WatchSubscriptionListener,
  WatchSubscriptionOptions,
} from '../contracts';
import type { HandlerRegistry } from './handler-types';
import type { SubscriptionDiagnostic } from './subscriptions/types';
import type { TraceCallback } from '../core/tracing-types';
import type {
  CoEffectHandler,
  CoEffects,
  EqualityCheckFn,
  ErrorHandler,
  EventRegistrationOptions,
  Interceptor,
  SubConfig,
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

/**
 * The capability made available to React descendants and other app-level
 * consumers. It deliberately excludes registration, reset, inspection, and
 * terminal lifecycle operations.
 */
export interface ReflexRuntimeClient<
  TContracts extends ReflexContracts = PermissiveReflexContracts,
> {
  readonly runtimeId: string;
  readonly runtimeName: string;

  dispatch(event: ContractDispatchVector<TContracts>): void;
  debounceAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void;
  throttleAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void;
}

/** Registration-only capability passed to feature modules. */
export interface ReflexRegistrar<TContracts extends ReflexContracts = PermissiveReflexContracts> {
  regEvent<TId extends string>(
    id: TId,
    handler: RuntimeEventHandler<TContracts, TId>,
    options?: EventRegistrationOptions<ContractState<TContracts>>,
  ): void;
  regEffect<TId extends string>(
    id: TId,
    handler: (
      value: ContractEffectParams<TContracts, TId>,
      runtime: ReflexRuntimeClient<TContracts>,
    ) => void,
  ): void;
  regCoeffect(id: string, handler: CoEffectHandler<ContractState<TContracts>>): void;
  regRootSub<TId extends string>(id: TId, sourceKey: string): void;
  /**
   * Register a computed subscription.
   *
   * Arguments follow evaluation order: `dependencies` resolves first, and
   * `compute` then receives those dependency values as one array in the same
   * order, followed by the subscription's own parameters.
   *
   * ```ts
   * regSub('todos/visible',
   *   (limit) => [['todos/all'], ['ui/showing']],
   *   ([todos, showing], limit) => …);
   * ```
   *
   * Both argument groups are inferred from the dependency tuple, so reordering
   * dependencies is a compile-time error rather than a silent argument swap,
   * and adding a dependency never shifts a parameter's position.
   */
  regSub<TId extends string, TDependencies extends readonly ContractSubscribeVector<TContracts>[]>(
    id: TId,
    dependencies: (
      ...params: ContractSubscriptionParams<TContracts, TId>
    ) => readonly [...TDependencies],
    compute: (
      values: ContractSubscriptionDependencyValues<TContracts, TDependencies>,
      ...params: ContractSubscriptionParams<TContracts, TId>
    ) => ContractSubscriptionResult<TContracts, TId>,
    config?: SubConfig,
  ): void;
}

/**
 * Production runtime owned by the application root. Administrative and
 * development-only operations are intentionally absent from this surface.
 */
export interface ReflexRuntime<
  TContracts extends ReflexContracts = PermissiveReflexContracts,
> extends ReflexRuntimeClient<TContracts> {
  readonly runtimeInstanceId: string;

  registerModule(module: ReflexModule<ReflexRegistrar<TContracts>>): ReflexDisposer;
  dispose(): void;
}

/** Internal administrative view used only by testing and DevTools adapters. */
export interface ReflexRuntimeAdmin<
  TContracts extends ReflexContracts = PermissiveReflexContracts,
> {
  getState(): ContractState<TContracts>;
  flush(): Promise<void>;
  dispatchSync(event: ContractDispatchVector<TContracts>): void;
  getStateRevisions(): RuntimeStateRevisions;
  restoreState(nextState: ContractState<TContracts>): void;
  getSubscriptionValue<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
  ): ContractSubscriptionResult<TContracts, TId>;
  watchSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    listener: WatchSubscriptionListener<ContractSubscriptionResult<TContracts, TId>>,
    options?: WatchSubscriptionOptions,
  ): ReflexDisposer;
  /**
   * Append a hook around every event's transition.
   *
   * Not `reg*`: interceptors form an ordered chain rather than an id-keyed
   * handler table, and they are runtime-wide rather than scoped to the module
   * that added them. Remove one by its id with `removeInterceptor`.
   */
  addInterceptor(interceptor: Interceptor<ContractState<TContracts>>): void;
  /** Remove a previously added interceptor by its id. */
  removeInterceptor(id: string): void;
  /** Replace the runtime's handling of an unrecovered event-pipeline failure. */
  setEventErrorHandler(handler: ErrorHandler): void;
  /** Restore the built-in handler, which logs the failure and rethrows it. */
  clearEventErrorHandler(): void;
  getInterceptors(): Interceptor<ContractState<TContracts>>[];
  setEqualityCheck(equalityCheck: EqualityCheckFn): void;
  getEqualityCheck(): EqualityCheckFn;
  enableTracing(): void;
  disableTracing(): void;
  enableTracePrint(): void;
  registerTraceCallback(key: string, callback: TraceCallback): void;
  removeTraceCallback(key: string): void;
  getHandlers(): HandlerRegistry;
  clearHandlers(): void;
  clearSubs(): void;
  clearSubscriptionCache(key?: string): void;
  getSubscriptionDiagnostics(): readonly SubscriptionDiagnostic[];
}
