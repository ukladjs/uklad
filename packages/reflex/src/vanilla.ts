// Detect separately initialized package copies before exposing public state.
import './runtime/instance';

/** Create the explicit owner of one Reflex application. */
export { createReflexRuntime } from './runtime/runtime';

export { DISPATCH, DISPATCH_LATER } from './events/effects';
export { NOW, RANDOM } from './events/coeffects';
export { shallowEqual } from './core/equality';
export { current, enableMapSet, original } from './core/immer';

export type {
  ContractAllEffectPayloads,
  ContractDb,
  ContractDispatchLaterEffect,
  ContractDispatchVector,
  ContractEffectId,
  ContractEffectParams,
  ContractEffectPayloads,
  ContractEffects,
  ContractEffectVector,
  ContractEventId,
  ContractEventParams,
  ContractEventPayloads,
  ContractEventVector,
  ContractSubscribeVector,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionPayloads,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  CreateReflexRuntimeOptions,
  DefaultReflexContracts,
  PermissiveEffectPayloads,
  PermissiveEventPayloads,
  PermissiveReflexContracts,
  PermissiveSubscriptionPayloads,
  ReflexContracts,
  ReflexDisposer,
  ReflexModule,
  WatchSubscriptionListener,
  WatchSubscriptionOptions,
} from './contracts';
export type {
  ReflexRuntime,
  RuntimeEventHandler,
  RuntimeStateRevisions,
  RuntimeSubscriptionHandler,
} from './runtime/runtime';
export type {
  RuntimeLifecycleEffect,
  RuntimeLifecycleEffectStatus,
  RuntimeLifecycleErrorKind,
  RuntimeLifecycleObserver,
  RuntimeLifecyclePatch,
  RuntimeLifecycleStatePlan,
  RuntimeLifecycleSubscription,
} from './runtime/lifecycle';
export type {
  AppDb,
  CoEffectHandler,
  CoEffects,
  Context,
  Db,
  DefaultAppDb,
  DispatchLaterEffect,
  DispatchVector,
  EffectHandler,
  EffectParams,
  EffectPayloads,
  Effects,
  EqualityCheckFn,
  ErrorHandler,
  EventHandler,
  EventParams,
  EventPayloads,
  EventRegistrationOptions,
  EventVector,
  Id,
  Interceptor,
  InterceptorErrorData,
  ReflexError,
  SubConfig,
  SubDepsHandler,
  SubHandler,
  SubParams,
  SubPayloads,
  SubResult,
  SubscribeVector,
  SubVector,
  TraceErrorTag,
} from './types';
export type {
  HandlerByKind,
  HandlerKind,
  HandlerRegistry,
  RegistryHandler,
} from './runtime/handlers';
export type { SubscriptionDiagnostic } from './runtime/subscriptions/engine';
export type { Trace, TraceCallback, TraceId, TraceOptions, TraceTags } from './core/tracing';
export type { ReflexHandlerKeys, ReflexInspector, ReflexInspectorSnapshot } from './inspector';
