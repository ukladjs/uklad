// Detect separately initialized package copies before exposing public state.
import './duplicate-package-detection';

/** Create the explicit owner of one Reflex application. */
export { createReflexRuntime } from './runtime/runtime';

export { DISPATCH, DISPATCH_LATER } from './events/built-in-effects';
export { shallowEqual } from './core/equality';
export { current, enableMapSet, original } from './core/immer';

export type {
  ContractAllEffectPayloads,
  ContractState,
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
} from './runtime/api';
export type {
  AppState,
  CoEffectHandler,
  CoEffects,
  Context,
  State,
  DefaultAppState,
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
} from './types';
export type { HandlerRegistry } from './runtime/handler-types';
export type { SubscriptionDiagnostic } from './runtime/subscriptions/types';
export type {
  Trace,
  TraceCallback,
  TraceErrorTag,
  TraceId,
  TraceOptions,
  TraceTags,
} from './core/tracing-types';
export type {
  ReflexHandlerKeys,
  ReflexInspector,
  ReflexInspectorSnapshot,
} from './inspector-types';
