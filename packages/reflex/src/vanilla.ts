// Detect separately initialized package copies before exposing public state.
import './runtime/instance';

export { getAppDb, initAppDb } from './runtime/app-db';
export {
  createReflexRuntime,
  defaultRuntime,
  flush,
  registerModule,
  restoreAppDb,
  watchSubscription,
} from './runtime/runtime';

export { defaultErrorHandler, regEventErrorHandler } from './events/pipeline';
export { regEvent } from './events/registration';
export { dispatch, dispatchSync } from './events/router';
export { debounceAndDispatch, throttleAndDispatch } from './events/rate-limit';
export { DISPATCH, DISPATCH_LATER, regEffect } from './events/effects';
export { NOW, RANDOM, regCoeffect } from './events/coeffects';
export {
  clearGlobalInterceptors,
  getGlobalInterceptors,
  regGlobalInterceptor,
} from './events/global-interceptors';

export { regSub } from './subscriptions/registration';
export { getSubscriptionValue } from './subscriptions/queries';

export { getGlobalEqualityCheck, setGlobalEqualityCheck, shallowEqual } from './core/equality';
export { current, enableMapSet, original } from './core/immer';
export {
  disableTracing,
  enableTracePrint,
  enableTracing,
  registerTraceCallback,
  registerTraceCb,
  removeTraceCallback,
  removeTraceCb,
} from './core/tracing';
export { createReflexInspector } from './inspector';

export { getHandler, getHandlers } from './runtime/handlers';
export { clearHandlers } from './runtime/reset';
export {
  clearSubs,
  clearSubscriptionCache,
  getSubscriptionDiagnostics,
} from './runtime/subscriptions/cache';

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
  RuntimeSubscriptionHandler,
} from './runtime/runtime';
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
