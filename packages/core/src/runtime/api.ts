import type {
  ContractCoeffectArg,
  ContractCoeffectId,
  ContractCoeffectValue,
  ContractNamedCoeffectBindings,
  ContractDispatchVector,
  ContractEffectParams,
  ContractEffects,
  ContractEventParams,
  ContractRootSubscriptionSource,
  ContractRootSubscriptionSubject,
  ContractState,
  ContractSubscribeVector,
  ContractSubscriptionDependencyValues,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  PermissiveUkladContracts,
  UkladContracts,
  UkladDisposer,
  UkladModule,
  WatchSubscriptionListener,
  WatchSubscriptionOptions,
} from '../contracts';
import type { HandlerRegistry } from './handler-types';
import type { SubscriptionDiagnostic } from './subscriptions/types';
import type { TraceCallback } from '../core/tracing-types';
import type {
  CoeffectReadContext,
  ContractEventContext,
  ContractNamedEventRegistrationOptions,
  EqualityCheckFn,
  ErrorHandler,
  Interceptor,
  SubConfig,
} from '../types';

export type RuntimeEventHandler<
  TContracts extends UkladContracts,
  TId extends string,
  TBindings extends ContractNamedCoeffectBindings<TContracts> = Record<never, never>,
> = (
  context: ContractEventContext<TContracts, TBindings>,
  ...params: ContractEventParams<TContracts, TId>
) => ContractEffects<TContracts> | void;

/**
 * A coeffect handler for one declared id.
 *
 * The value it returns is stored under `TId`, so the declaration is what both
 * sides agree on: this signature checks the producer, and the same entry types
 * the event-local binding that consumes it.
 */
export type RuntimeCoeffectHandler<TContracts extends UkladContracts, TId extends string> = (
  arg: ContractCoeffectArg<TContracts, TId>,
  coeffects: CoeffectReadContext,
) => ContractCoeffectValue<TContracts, TId>;

export type RuntimeSubscriptionHandler<TContracts extends UkladContracts, TId extends string> = (
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
export interface UkladRuntimeClient<TContracts extends UkladContracts = PermissiveUkladContracts> {
  readonly runtimeId: string;
  readonly runtimeName: string;

  dispatch(event: ContractDispatchVector<TContracts>): void;
  debounceAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void;
  throttleAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void;
}

/** Registration-only capability passed to feature modules. */
export interface UkladRegistrar<TContracts extends UkladContracts = PermissiveUkladContracts> {
  /**
   * Register an event with event-local coeffect bindings.
   *
   * A provider id stays global and is what `regCoeffect` registers. The key in
   * this object is local to the event handler, so slash-namespaced providers
   * stay pleasant to read:
   *
   * ```ts
   * regEvent('todos/add',
   *   ({ draftState, coeffects: { now } }, title) => { … },
   *   { coeffects: { now: 'system/now' } });
   * ```
   */
  regEvent<
    TId extends string,
    TBindings extends ContractNamedCoeffectBindings<TContracts> = Record<never, never>,
  >(
    id: TId,
    handler: RuntimeEventHandler<TContracts, TId, TBindings>,
    options?: ContractNamedEventRegistrationOptions<TContracts, TBindings>,
  ): void;
  regEffect<TId extends string>(
    id: TId,
    handler: (
      value: ContractEffectParams<TContracts, TId>,
      runtime: UkladRuntimeClient<TContracts>,
    ) => void,
  ): void;
  /**
   * Register a coeffect: a value the runtime injects under `id`.
   *
   * ```ts
   * regCoeffect('now', () => Date.now());
   * regCoeffect('local-storage-value', (key) => localStorage.getItem(key));
   * ```
   *
   * The second parameter is a frozen, state-free view of the event and
   * coeffects injected so far, for the rare handler that derives from `event`
   * or from a coeffect listed before it. `event` and `draftState` are reserved
   * and rejected as ids.
   */
  regCoeffect<TId extends ContractCoeffectId<TContracts>>(
    id: TId,
    handler: RuntimeCoeffectHandler<TContracts, TId>,
  ): void;
  /**
   * Register a subscription that reads one state key straight through.
   *
   * The arguments are checked as one correlated pair: `id` must name a
   * subscription that declares no parameters, since the runtime rejects a
   * parameterized query against a root subscription, and `sourceKey` must name
   * a state key whose type satisfies *that* subscription's declared result.
   *
   * ```ts
   * regRootSub('todos/all', 'todos');
   * ```
   *
   * Sections the contract leaves undeclared stay permissive, so a runtime
   * without a subscription or state contract accepts any pair.
   */
  regRootSub<TId extends ContractSubscriptionId<TContracts>, TKey extends string>(
    id: ContractRootSubscriptionSubject<TContracts, TId>,
    sourceKey: ContractRootSubscriptionSource<TContracts, TId, TKey>,
  ): void;
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
export interface UkladRuntime<
  TContracts extends UkladContracts = PermissiveUkladContracts,
> extends UkladRuntimeClient<TContracts> {
  readonly runtimeInstanceId: string;

  registerModule(module: UkladModule<UkladRegistrar<TContracts>>): UkladDisposer;
  dispose(): void;
}

/** Internal administrative view used only by testing and DevTools adapters. */
export interface UkladRuntimeAdmin<TContracts extends UkladContracts = PermissiveUkladContracts> {
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
  ): UkladDisposer;
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
