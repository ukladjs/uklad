import type { Draft } from 'immer';

export type Db<T = Record<string, any>> = T;

export type Id = string;
export type EventVector = [Id, ...any[]];
export type EventHandler<T = DefaultAppDb, P extends readonly any[] = any[]> = (
  coeffects: CoEffects<T>,
  ...params: P
) => Effects | void;

/**
 * Explicit event-registration metadata.
 *
 * Prefer this options object when an event needs coeffects or interceptors.
 * The positional array overloads remain available for backward compatibility,
 * but an empty positional array cannot describe its intent on its own.
 */
export interface EventRegistrationOptions<T = DefaultAppDb> {
  coeffects?: ReadonlyArray<readonly [id: Id] | readonly [id: Id, value: unknown]>;
  interceptors?: ReadonlyArray<Interceptor<T>>;
}

/**
 * Opt-in typed app db shape. Empty by default — augment it from app code so
 * `draftDb` (and `getAppDb`/`initAppDb`) are typed without passing an
 * explicit generic to `regEvent` (which would suppress payload inference
 * from `EventPayloads`):
 *
 * ```ts
 * declare module '@flexsurfer/reflex' {
 *   interface AppDb { todos: Todo[]; showing: Showing }
 *   // or reuse an existing type: interface AppDb extends MyDbShape {}
 * }
 * ```
 *
 * While this interface is empty, db-typed APIs default to
 * `Record<string, any>`, exactly as before.
 */
export interface AppDb {}

/** The augmented `AppDb`, or `Record<string, any>` while it is empty. */
export type DefaultAppDb = [keyof AppDb] extends [never] ? Record<string, any> : AppDb;

/**
 * Opt-in typed payload map for events. Empty by default — augment it from app
 * code to get typed `dispatch` and `regEvent` handler params:
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
 * Payloads must be tuples (use `[]` for events without params). While this
 * interface is empty the whole API stays untyped, exactly as before. Once
 * augmented, `dispatch` only accepts declared event ids with matching
 * payloads — declare every event the app dispatches (the map doubles as a
 * machine-readable event manifest). `regEvent` stays permissive for
 * undeclared ids so internal/bridge events keep working.
 */
export interface EventPayloads {}

/**
 * Opt-in typed map for subscriptions. Empty by default — augment it from app
 * code to get typed `useSubscription` params and results:
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
 * Once augmented, `useSubscription`/`getSubscriptionValue` only accept
 * declared sub ids with matching params — declare every subscription the app
 * uses.
 */
export interface SubPayloads {}

/** Params tuple declared for event id K, or `any[]` when K isn't declared. */
export type EventParams<K extends Id> = K extends keyof EventPayloads
  ? EventPayloads[K] extends readonly any[]
    ? EventPayloads[K]
    : never
  : any[];

/**
 * What `dispatch` accepts: any `EventVector` while `EventPayloads` is empty;
 * once augmented, only `[declaredId, ...declaredPayload]` vectors.
 */
export type DispatchVector = [keyof EventPayloads] extends [never]
  ? EventVector
  : {
      [K in keyof EventPayloads]: EventPayloads[K] extends readonly any[]
        ? [K, ...EventPayloads[K]]
        : never;
    }[keyof EventPayloads];

/**
 * Opt-in typed payload map for effects. Empty by default — augment it from
 * app code to get compile-checked effect tuples in event handler returns:
 *
 * ```ts
 * declare module '@flexsurfer/reflex' {
 *   interface EffectPayloads {
 *     'storage/set-todos': Todo[];
 *     'ui/scroll-top': void; // no payload → the tuple is just ['ui/scroll-top']
 *   }
 * }
 * ```
 *
 * While this interface is empty, `Effects` stays `[id, any?][]` as before.
 * Once augmented, every effect tuple a handler returns must use a declared id
 * with a matching payload — declare every effect the app emits. The built-in
 * `'dispatch'` and `'dispatch-later'` effects are always included with
 * `DispatchVector` payloads. Their ids are reserved and cannot be overridden
 * through `EffectPayloads`, so events emitted through effects are checked
 * against `EventPayloads` exactly like direct `dispatch` calls.
 */
export interface EffectPayloads {}

type BuiltinEffectPayloads = {
  dispatch: DispatchVector;
  'dispatch-later': DispatchLaterEffect;
};

type AllEffectPayloads = Omit<EffectPayloads, keyof BuiltinEffectPayloads> & BuiltinEffectPayloads;

/** Payload declared for effect id K (built-ins included), or `any`. */
export type EffectParams<K extends Id> = K extends keyof AllEffectPayloads
  ? AllEffectPayloads[K]
  : any;

type EffectTupleFor<K, P> = [P] extends [void] ? [K] : undefined extends P ? [K, P?] : [K, P];

/** Params tuple declared for sub id K, or `any[]` when K isn't declared. */
export type SubParams<K extends Id> = K extends keyof SubPayloads
  ? SubPayloads[K] extends { params: infer P extends readonly any[] }
    ? P
    : []
  : any[];

/** Result type declared for sub id K, or `Fallback` when K isn't declared. */
export type SubResult<K extends Id, Fallback = any> = K extends keyof SubPayloads
  ? SubPayloads[K] extends { result: infer R }
    ? R
    : Fallback
  : Fallback;

/**
 * What subscription entry points accept: any `SubVector` while `SubPayloads`
 * is empty; once augmented, only `[declaredId, ...declaredParams]` vectors.
 */
export type SubscribeVector = [keyof SubPayloads] extends [never]
  ? SubVector
  : { [K in keyof SubPayloads]: K extends Id ? [K, ...SubParams<K>] : never }[keyof SubPayloads];

/**
 * Normalized, JSON-serializable error entry attached to event traces.
 * A failed event carries one under `tags.error`; effects that threw after a
 * successful event are listed under `tags.effectErrors`. `phase` says where
 * processing failed:
 * - 'missing-handler' — the dispatched event id has no registered handler
 * - 'handler' — the interceptor/handler chain threw (see `interceptor`;
 *   'fx-handler' is the event handler itself)
 * - 'effect' — the event committed, but this effect handler threw
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

export type EffectHandler<V = any> = (value: V) => void;

export type CoEffectHandler<T = DefaultAppDb> = (
  coeffects: CoEffects<T>,
  value?: any,
) => CoEffects<T>;

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

export type SubVector = [Id, ...any[]];

export type SubHandler = (...values: any[]) => any;
export type SubDepsHandler = (...params: any[]) => SubVector[];

export interface SubConfig {
  equalityCheck?: EqualityCheckFn;
}

/**
 * What event handlers return: any `[effectId, payload?]` tuples while
 * `EffectPayloads` is empty; once augmented, only declared effect ids with
 * matching payloads (built-in `'dispatch'`/`'dispatch-later'` included and
 * reserved, with their event vectors checked against `EventPayloads`).
 */
export type Effects = ([keyof EffectPayloads] extends [never]
  ? [Id, any?]
  : {
      [K in keyof AllEffectPayloads]: EffectTupleFor<K, AllEffectPayloads[K]>;
    }[keyof AllEffectPayloads])[];

export interface DispatchLaterEffect {
  ms: number;
  dispatch: DispatchVector;
}

export interface CoEffects<T = DefaultAppDb> {
  event: EventVector;
  draftDb: Draft<Db<T>>;
  [key: string]: any;
}

export interface Context<T = Record<string, any>> {
  coeffects: CoEffects<T>;
  effects: Effects;
  /** The db generation produced by the event handler; unset until it ran. */
  newDb?: Db<T>;
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

export type EqualityCheckFn = (a: any, b: any) => boolean;
