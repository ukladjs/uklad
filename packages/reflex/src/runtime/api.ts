import type {
  ContractDispatchVector,
  ContractEffectParams,
  ContractEffects,
  ContractEventParams,
  ContractState,
  ContractSubscribeVector,
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
  regEventErrorHandler(handler: ErrorHandler): void;
  regRootSub<TId extends string>(id: TId, sourceKey: string): void;
  regSub<TId extends string>(
    id: TId,
    compute: RuntimeSubscriptionHandler<TContracts, TId>,
    dependencies: (
      ...params: ContractSubscriptionParams<TContracts, TId>
    ) => ContractSubscribeVector<TContracts>[],
    config?: SubConfig,
  ): void;
  registerInterceptor(interceptor: Interceptor<ContractState<TContracts>>): void;
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
  getInterceptors(): Interceptor<ContractState<TContracts>>[];
  clearInterceptors(id?: string): void;
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
