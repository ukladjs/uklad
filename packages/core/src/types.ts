import type { Draft } from 'immer';

import type {
  ContractNamedCoeffectBindings,
  ContractNamedCoeffectValues,
  ContractHasOpenCoeffects,
  ContractState,
  ContractStateKey,
  ContractStateValue,
  DefaultContracts,
  PermissiveUkladContracts,
  RuntimeOwnedCoeffectId,
  UkladContracts,
} from './contracts';

// State and shared identifiers

export type State<T = Record<string, any>> = T;
export type Id = string;

/** The ambient application state, or `Record<string, any>` while undeclared. */
export type DefaultAppState = ContractState<DefaultContracts>;

export type EqualityCheckFn = (a: any, b: any) => boolean;

// Events

export type EventVector = [Id, ...any[]];

export type EventHandler<T = DefaultAppState, P extends readonly any[] = any[]> = (
  context: EventContext<T>,
  ...params: P
) => Effects | void;

/** One provider request in a named event-local coeffect binding. */
export type CoeffectBinding = Id | readonly [id: Id, arg?: unknown];

/**
 * Event-local names for coeffect providers.
 *
 * Each object key becomes a property of `context.coeffects` in the event
 * handler; each value is either a provider id or that id together with its
 * registration argument.
 */
export type NamedCoeffectBindings = Readonly<Record<string, CoeffectBinding>>;

/** Optional event-local coeffects and interceptors applied when registering an event. */
export interface EventRegistrationOptions<T = DefaultAppState> {
  coeffects?: NamedCoeffectBindings;
  interceptors?: ReadonlyArray<Interceptor<T>>;
}

/**
 * Event registration options narrowed by a runtime contract.
 *
 * `TBindings` is inferred from the `coeffects` object at the call site, which
 * lets the handler's coeffects parameter name exactly its local binding slots.
 */
export interface ContractNamedEventRegistrationOptions<
  TContracts,
  TBindings extends ContractNamedCoeffectBindings<TContracts>,
> {
  readonly coeffects?: TBindings & NamedCoeffectBindingSlotGuard<TBindings>;
  readonly interceptors?: ReadonlyArray<Interceptor<ContractState<TContracts>>>;
}

/** Reject literal slots that would replace a runtime-owned event input. */
type NamedCoeffectBindingSlotGuard<TBindings> =
  Extract<keyof TBindings, RuntimeOwnedCoeffectId | '__proto__'> extends never ? unknown : never;

// Effects and coeffects

/** One effect intent: an id with an optional payload. */
export type EffectVector = [id: Id, value?: any];

/** The effect list an event handler returns, before contract narrowing. */
export type Effects = EffectVector[];

export interface DispatchLaterEffect {
  ms: number;
  dispatch: EventVector;
}

/** Runtime capability supplied to custom effect handlers. */
export interface EffectRuntimeContext {
  readonly runtimeId: string;
  readonly runtimeName: string;
  dispatch(event: EventVector): void;
  debounceAndDispatch(event: EventVector, durationMs: number): void;
  throttleAndDispatch(event: EventVector, durationMs: number): void;
}

export type EffectHandler<V = any> = (value: V, runtime: EffectRuntimeContext) => void;

/** Read-only values explicitly injected into one event handler. */
export type EventCoeffects = Readonly<Record<string, any>>;

/** Runtime-owned inputs that frame every event-handler invocation. */
export interface EventContextBase<T = DefaultAppState> {
  readonly event: EventVector;
  readonly draftState: Draft<State<T>>;
}

/**
 * The context passed to an event handler.
 *
 * State mutation remains explicit through `draftState`; injected values live
 * under the read-only `coeffects` property, rather than sharing the top-level
 * namespace with runtime-owned inputs.
 */
export interface EventContext<
  T = DefaultAppState,
  TCoeffects extends object = EventCoeffects,
> extends EventContextBase<T> {
  readonly coeffects: TCoeffects;
}

/**
 * The flat coeffect map used inside the interceptor pipeline.
 *
 * Event handlers receive `EventContext` instead. This surface remains flat so
 * coeffect injectors and infrastructure interceptors can coordinate by global
 * provider id during pipeline execution.
 */
export interface CoEffectsBase<T = DefaultAppState> {
  event: EventVector;
  draftState: Draft<State<T>>;
}

export interface CoEffects<T = DefaultAppState> extends CoEffectsBase<T> {
  [key: string]: any;
}

/**
 * The read-only environment visible to a coeffect handler.
 *
 * This is intentionally state-free. A coeffect may inspect the dispatched
 * event and values injected by earlier coeffects, but it never receives the
 * event handler's state draft. The runtime supplies a frozen top-level view,
 * so a handler cannot replace the event or another coeffect contribution.
 */
export interface CoeffectReadContext {
  readonly event: Readonly<EventVector>;
  readonly [id: string]: unknown;
}

/**
 * A coeffect handler: given its registration argument, produce one value.
 *
 * The runtime stores the returned value under the handler's own provider id.
 * Legacy events read that id through `context.coeffects`; named event bindings
 * expose the same value through an event-local property. Handlers receive a
 * frozen, state-free view of the event and values injected before them. It is
 * useful for the rare ordered dependency, but never exposes `draftState`.
 */
export type CoEffectHandler<TValue = any, TArg = any> = (
  arg: TArg,
  coeffects: CoeffectReadContext,
) => TValue;

/**
 * Values available through `context.coeffects` for one event registration.
 *
 * A contract that declares no coeffects keeps the permissive shape, so
 * untyped and incrementally typed runtimes are unaffected. Once the section is
 * declared, the handler sees precisely the local slots its own registration
 * injected.
 */
export type ContractEventCoeffects<
  TContracts,
  TBindings extends ContractNamedCoeffectBindings<TContracts>,
> =
  ContractHasOpenCoeffects<TContracts> extends true
    ? EventCoeffects
    : ContractNamedCoeffectValues<TContracts, TBindings>;

/** A complete typed event-handler context for an event-local coeffect binding map. */
export type ContractEventContext<
  TContracts,
  TBindings extends ContractNamedCoeffectBindings<TContracts>,
> = EventContext<ContractState<TContracts>, ContractEventCoeffects<TContracts, TBindings>>;

// Interceptor pipeline and errors

/**
 * What an interceptor may observe and contribute.
 *
 * This is the whole public interceptor surface. The pipeline's own bookkeeping
 * — the remaining queue, the traversed stack, error routing — is deliberately
 * absent, so the before/after execution model can be replaced without breaking
 * extensions built on this type.
 */
export interface InterceptorContext<T = Record<string, any>> {
  /** The event being handled, plus any injected coeffects. */
  coeffects: CoEffects<T>;
  /**
   * The state generation captured before this event's interceptor chain
   * begins. Interceptors may observe it but must not replace it.
   */
  readonly previousState: State<T>;
  /** The shared effect list. Interceptors may append entries but must not replace it. */
  readonly effects: Effects;
  /**
   * The final state generation produced by the event handler; unset until it
   * runs. Interceptors may observe it but must not replace it.
   */
  readonly newState?: State<T>;
}

/** @internal The full pipeline context, including execution bookkeeping. */
export interface Context<T = Record<string, any>> extends InterceptorContext<T> {
  coeffects: CoEffects<T>;
  /** Invalid legacy effect values retained for the post-commit executor to report. */
  readonly invalidEffects?: readonly unknown[];
  queue: Interceptor<T>[];
  stack: Interceptor<T>[];
  originalException: boolean;
  /** Internal structured failure retained when a custom error handler recovers. */
  readonly executionError?: unknown;
}

/**
 * A cross-cutting hook around an event's state transition.
 *
 * Interceptors are an extension point for libraries and infrastructure —
 * persistence, logging, instrumentation — not a tool for application logic.
 * They are added through the runtime's administrative surface rather than the
 * registrar an application module receives; feature code belongs in events,
 * effects, and coeffects, which stay analysable one handler at a time.
 */
export interface Interceptor<T = Record<string, any>> {
  id: string;
  before?: (context: InterceptorContext<T>) => InterceptorContext<T>;
  after?: (context: InterceptorContext<T>) => InterceptorContext<T>;
  comment?: string;
}

/** @internal Interceptor owned by the runtime, able to drive the pipeline. */
export interface InternalInterceptor<T = Record<string, any>> extends Interceptor<T> {
  before?: (context: any) => any;
  after?: (context: any) => any;
}

export type InterceptorDirection = 'before' | 'after';

export interface InterceptorErrorData {
  direction: InterceptorDirection;
  interceptor: string;
  originalError: Error;
  eventV?: EventVector;
}

export interface UkladError extends Error {
  data: InterceptorErrorData;
  cause: Error;
}

export type ErrorHandler = (originalError: Error, ukladError: UkladError) => void;

// Subscriptions

export type SubVector = [Id, ...any[]];

export type SubHandler = (...values: any[]) => any;
export type SubDepsHandler = (...params: any[]) => SubVector[];

/** A state transition applied to the latest value behind a root subscription. */
export type SubscriptionRootUpdater<TValue = unknown> = (current: TValue) => TValue;

/**
 * Capability supplied to one active subscription extension.
 *
 * `updateRoot` routes an updater through Uklad's private event → STATE path.
 * The lifecycle target and storage target are intentionally independent: an
 * extension attached to a parameterized derived subscription can update an
 * ordinary backing root without activating or retaining that root.
 */
export interface SubscriptionExtensionContext<
  TContracts extends UkladContracts = PermissiveUkladContracts,
> {
  updateRoot<TStateKey extends ContractStateKey<TContracts>>(
    stateKey: TStateKey,
    updater: SubscriptionRootUpdater<ContractStateValue<TContracts, TStateKey>>,
  ): void;
}

/**
 * Lifecycle attached to an ordinary subscription without changing its data
 * definition.
 *
 * An extension is created when the subscription gains its first consumer.
 * Its first `sync` runs immediately with values from the extension's separate
 * passive signals. After later STATE publications, one coalesced sample calls
 * `sync` only when that tuple changes. `dispose` runs after the final consumer
 * leaves. The subscription's own root or derived compute function remains pure,
 * and sampling a signal neither registers a listener nor keeps its subscription
 * active.
 */
export interface SubscriptionExtension<TSignals extends readonly unknown[] = readonly unknown[]> {
  sync(signals: TSignals): void;
  dispose(): void;
}

export interface SubConfig {
  equalityCheck?: EqualityCheckFn;
}
