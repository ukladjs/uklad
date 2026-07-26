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
import type { TraceCallback } from '../core/tracing-types';
import type { ReflexInspector } from '../inspector-types';
import type { HandlerRegistry } from './handler-types';
import type { RuntimeLifecycleObserver } from './lifecycle-types';
import type { SubscriptionDiagnostic } from './subscriptions/types';
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
    options?: EventRegistrationOptions<ContractState<TContracts>>,
  ): void;
  regEffect<TId extends string>(
    id: TId,
    handler: (value: ContractEffectParams<TContracts, TId>) => void,
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

  getSubscriptionValue<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
  ): ContractSubscriptionResult<TContracts, TId>;
  watchSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    listener: WatchSubscriptionListener<ContractSubscriptionResult<TContracts, TId>>,
    options?: WatchSubscriptionOptions,
  ): ReflexDisposer;

  registerInterceptor(interceptor: Interceptor<ContractState<TContracts>>): void;
  getInterceptors(): Interceptor<ContractState<TContracts>>[];
  clearInterceptors(id?: string): void;
  setEqualityCheck(equalityCheck: EqualityCheckFn): void;
  getEqualityCheck(): EqualityCheckFn;

  enableTracing(): void;
  disableTracing(): void;
  enableTracePrint(): void;
  registerTraceCallback(key: string, callback: TraceCallback): void;
  removeTraceCallback(key: string): void;

  debounceAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void;
  throttleAndDispatch(event: ContractDispatchVector<TContracts>, durationMs: number): void;

  getHandlers(): HandlerRegistry;
  clearHandlers(): void;
  clearSubs(): void;
  clearSubscriptionCache(key?: string): void;
  getSubscriptionDiagnostics(): readonly SubscriptionDiagnostic[];

  observeLifecycle(observer: RuntimeLifecycleObserver): ReflexDisposer;

  registerModule(module: ReflexModule<ReflexRuntime<TContracts>>): ReflexDisposer;
  createInspector(): ReflexInspector;
  dispose(): void;
}
