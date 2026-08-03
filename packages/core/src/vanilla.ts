// Detect separately initialized package copies before exposing public state.
import './duplicate-package-detection';

/** Create the explicit owner of one Reflex application. */
export { createReflexRuntime } from './runtime/runtime';

export { DISPATCH, DISPATCH_LATER } from './events/built-in-effects';
export { shallowEqual } from './core/equality';
export { current, enableMapSet, original } from './core/immer';
export { isRegistrationCollisionError } from './runtime/registrations';

// The contract surface is deliberately small. `ReflexContracts` is what an
// application declares; `DefaultContracts` is the ambient single-runtime
// binding. The remaining `Contract*` helpers are extraction machinery used to
// build the runtime signatures — they stay internal to the package, and are
// exported here only where a downstream package composes contracts of its own.
export type {
  ContractNamedCoeffectBindings,
  ContractCoeffectPayloads,
  ContractEventPayloads,
  ContractState,
  ContractSubscriptionPayloads,
  CreateReflexRuntimeOptions,
  DefaultContracts,
  PermissiveReflexContracts,
  ReflexContracts,
  ReflexDisposer,
  ReflexModule,
  SubscriptionParam,
  WatchSubscriptionListener,
  WatchSubscriptionOptions,
} from './contracts';
export type {
  ReflexRegistrar,
  ReflexRuntime,
  ReflexRuntimeClient,
  RuntimeEventHandler,
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
  ReflexError,
  SubConfig,
  SubDepsHandler,
  SubHandler,
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
export type {
  ReflexHandlerKeys,
  ReflexInspector,
  ReflexInspectorSnapshot,
} from './inspector-types';
