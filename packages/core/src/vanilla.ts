// Detect separately initialized package copies before exposing public state.
import './duplicate-package-detection';

/** Create the explicit owner of one Uklad application. */
export { createUkladRuntime } from './runtime/runtime';

export { DISPATCH, DISPATCH_LATER } from './events/built-in-effects';
export { shallowEqual } from './core/equality';
export { current, enableMapSet, original } from './core/immer';
export { isRegistrationCollisionError } from './runtime/registrations';

// The contract surface is deliberately small. `UkladContracts` is what an
// application declares; `DefaultContracts` is the ambient single-runtime
// binding. The remaining `Contract*` helpers are extraction machinery used to
// build the runtime signatures — they stay internal to the package, and are
// exported here only where a downstream package composes contracts of its own.
export type {
  ContractNamedCoeffectBindings,
  ContractCoeffectPayloads,
  ContractEventPayloads,
  ContractRootSubscriptionId,
  ContractState,
  ContractStateKey,
  ContractStateValue,
  ContractSubscribeVector,
  ContractSubscriptionDependencyValues,
  ContractSubscriptionId,
  ContractSubscriptionPayloads,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionSignalValues,
  CreateUkladRuntimeOptions,
  DefaultContracts,
  PermissiveUkladContracts,
  UkladContracts,
  UkladDisposer,
  UkladModule,
  SubscriptionParam,
  WatchSubscriptionListener,
  WatchSubscriptionOptions,
} from './contracts';
export type {
  UkladRegistrar,
  UkladRuntime,
  UkladRuntimeClient,
  RuntimeEventHandler,
  RuntimeSubscriptionExtensionFactory,
  RuntimeSubscriptionHandler,
} from './runtime/api';
/** Structural diagnostic data retained as a type-only compatibility export. */
export type { SubscriptionDiagnostic } from './runtime/subscriptions/types';
export type {
  CoEffectHandler,
  CoeffectReadContext,
  CoEffects,
  ContractNamedEventRegistrationOptions,
  State,
  DefaultAppState,
  DispatchLaterEffect,
  EffectVector,
  EffectHandler,
  EffectRuntimeContext,
  Effects,
  ErrorHandler,
  EqualityCheckFn,
  EventHandler,
  EventContext,
  EventRegistrationOptions,
  EventVector,
  Id,
  Interceptor,
  InterceptorContext,
  InterceptorDirection,
  InterceptorErrorData,
  UkladError,
  SubConfig,
  SubDepsHandler,
  SubHandler,
  SubscriptionExtension,
  SubscriptionExtensionContext,
  SubscriptionRootUpdater,
  SubVector,
} from './types';
export type {
  Trace,
  TraceCallback,
  TraceErrorTag,
  TraceId,
  TraceOptions,
  TraceTags,
} from './core/tracing-types';
export type { UkladHandlerKeys, UkladInspector, UkladInspectorSnapshot } from './inspector-types';
