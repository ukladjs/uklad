import type { Draft } from 'immer';

// State and shared identifiers

export type State<T = Record<string, any>> = T;
export type Id = string;

/**
 * Opt-in typed state shape. Empty by default; augment it from app code so
 * state-typed APIs infer the application state without explicit generics:
 *
 * ```ts
 * declare module '@flexsurfer/reflex' {
 *   interface AppState { todos: Todo[]; showing: Showing }
 *   // Or reuse an existing type: interface AppState extends MyStateShape {}
 * }
 * ```
 *
 * While this interface is empty, state-typed APIs use `Record<string, any>` for
 * backward compatibility.
 */
export interface AppState {}

/** The augmented `AppState`, or `Record<string, any>` while it is empty. */
export type DefaultAppState = [keyof AppState] extends [never] ? Record<string, any> : AppState;

export type EqualityCheckFn = (a: any, b: any) => boolean;

// Events

export type EventVector = [Id, ...any[]];

/**
 * Opt-in typed payload map for events. Empty by default; augment it from app
 * code to type `dispatch` vectors and `regEvent` handler parameters:
 *
 * ```ts
 * declare module '@flexsurfer/reflex' {
 *   interface EventPayloads {
 *     'todos/add': [title: string];
 *     'todos/toggle': [id: number];
 *   }
 * }
 * ```
 *
 * Payloads must be tuples (`[]` for events without parameters). Once this map
 * is augmented, dispatch entry points accept only declared events. `regEvent`
 * remains permissive for undeclared internal or bridge events.
 */
export interface EventPayloads {}

/** Parameters declared for event `K`, or `any[]` when `K` is not declared. */
export type EventParams<K extends Id> = K extends keyof EventPayloads
  ? EventPayloads[K] extends readonly any[]
    ? EventPayloads[K]
    : never
  : any[];

/** The event vectors accepted by dispatch entry points. */
export type DispatchVector = [keyof EventPayloads] extends [never]
  ? EventVector
  : {
      [K in keyof EventPayloads]: EventPayloads[K] extends readonly any[]
        ? [K, ...EventPayloads[K]]
        : never;
    }[keyof EventPayloads];

export type EventHandler<T = DefaultAppState, P extends readonly any[] = any[]> = (
  coeffects: CoEffects<T>,
  ...params: P
) => Effects | void;

/**
 * Explicit event-registration metadata. Prefer this form when an event needs
 * coeffects or interceptors. Positional arrays remain available for backward
 * compatibility, but an empty positional array cannot communicate its intent.
 */
export interface EventRegistrationOptions<T = DefaultAppState> {
  coeffects?: ReadonlyArray<readonly [id: Id] | readonly [id: Id, value: unknown]>;
  interceptors?: ReadonlyArray<Interceptor<T>>;
}

// Effects and coeffects

/**
 * Opt-in typed payload map for effects. Empty by default; augment it from app
 * code to type the effect tuples returned by event handlers:
 *
 * ```ts
 * declare module '@flexsurfer/reflex' {
 *   interface EffectPayloads {
 *     'storage/set-todos': Todo[];
 *     'ui/scroll-top': void;
 *   }
 * }
 * ```
 *
 * The built-in `dispatch` and `dispatch-later` effect IDs are always present,
 * reserved, and checked against `EventPayloads`.
 */
export interface EffectPayloads {}

export interface DispatchLaterEffect {
  ms: number;
  dispatch: DispatchVector;
}

type BuiltinEffectPayloads = {
  dispatch: DispatchVector;
  'dispatch-later': DispatchLaterEffect;
};

type AllEffectPayloads = Omit<EffectPayloads, keyof BuiltinEffectPayloads> & BuiltinEffectPayloads;

type EffectTupleFor<K, P> = [P] extends [void] ? [K] : undefined extends P ? [K, P?] : [K, P];

/** Payload declared for effect `K` (built-ins included), or `any`. */
export type EffectParams<K extends Id> = K extends keyof AllEffectPayloads
  ? AllEffectPayloads[K]
  : any;

/** The effect tuples event handlers may return. */
export type Effects = ([keyof EffectPayloads] extends [never]
  ? [Id, any?]
  : {
      [K in keyof AllEffectPayloads]: EffectTupleFor<K, AllEffectPayloads[K]>;
    }[keyof AllEffectPayloads])[];

export type EffectHandler<V = any> = (value: V) => void;

export interface CoEffects<T = DefaultAppState> {
  event: EventVector;
  draftState: Draft<State<T>>;
  [key: string]: any;
}

export type CoEffectHandler<T = DefaultAppState> = (
  coeffects: CoEffects<T>,
  value?: any,
) => CoEffects<T>;

// Interceptor pipeline and errors

export interface Context<T = Record<string, any>> {
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
  queue: Interceptor<T>[];
  stack: Interceptor<T>[];
  originalException: boolean;
}

export interface Interceptor<T = Record<string, any>> {
  id: string;
  before?: (context: Context<T>) => Context<T>;
  after?: (context: Context<T>) => Context<T>;
  comment?: string;
}

export type InterceptorDirection = 'before' | 'after';

export interface InterceptorErrorData {
  direction: InterceptorDirection;
  interceptor: string;
  originalError: Error;
  eventV?: EventVector;
}

export interface ReflexError extends Error {
  data: InterceptorErrorData;
  cause: Error;
}

export type ErrorHandler = (originalError: Error, reflexError: ReflexError) => void;

// Subscriptions

export type SubVector = [Id, ...any[]];

/**
 * Opt-in typed map for subscriptions. Empty by default; augment it from app
 * code to type subscription parameters and results:
 *
 * ```ts
 * declare module '@flexsurfer/reflex' {
 *   interface SubPayloads {
 *     'todos/all': { params: []; result: Todo[] };
 *     'todos/by-id': { params: [id: number]; result: Todo | undefined };
 *   }
 * }
 * ```
 *
 * Once augmented, subscription entry points accept only declared IDs with
 * matching parameters.
 */
export interface SubPayloads {}

/** Parameters declared for subscription `K`, or `any[]` when undeclared. */
export type SubParams<K extends Id> = K extends keyof SubPayloads
  ? SubPayloads[K] extends { params: infer P extends readonly any[] }
    ? P
    : []
  : any[];

/** Result declared for subscription `K`, or `Fallback` when undeclared. */
export type SubResult<K extends Id, Fallback = any> = K extends keyof SubPayloads
  ? SubPayloads[K] extends { result: infer R }
    ? R
    : Fallback
  : Fallback;

/** The subscription vectors accepted by public query entry points. */
export type SubscribeVector = [keyof SubPayloads] extends [never]
  ? SubVector
  : { [K in keyof SubPayloads]: K extends Id ? [K, ...SubParams<K>] : never }[keyof SubPayloads];

export type SubHandler = (...values: any[]) => any;
export type SubDepsHandler = (...params: any[]) => SubVector[];

export interface SubConfig {
  equalityCheck?: EqualityCheckFn;
}

// Tracing

/**
 * JSON-serializable event-trace error metadata. `phase` identifies whether
 * failure happened during lookup, the interceptor chain, or effect execution.
 */
export interface TraceErrorTag {
  phase: 'missing-handler' | 'handler' | 'effect';
  message: string;
  stack?: string;
  interceptor?: string;
  direction?: InterceptorDirection;
  effect?: string;
  eventV?: EventVector;
}
