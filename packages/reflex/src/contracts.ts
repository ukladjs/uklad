/**
 * Store-local type contract consumed by an explicit Reflex runtime.
 *
 * Every section is optional so applications can adopt local contracts one
 * surface at a time. Missing and empty sections retain the permissive 0.x
 * behavior; a non-empty section narrows the corresponding runtime API.
 */
export interface ReflexContracts {
  readonly state?: Record<string, any>;
  readonly events?: object;
  readonly effects?: object;
  readonly subscriptions?: object;
}

/** Event payload map used when a runtime has no declared event contract. */
export type PermissiveEventPayloads = Record<string, readonly any[]>;

/** Effect payload map used when a runtime has no declared effect contract. */
export type PermissiveEffectPayloads = Record<string, any>;

/** Subscription map used when a runtime has no declared subscription contract. */
export type PermissiveSubscriptionPayloads = Record<
  string,
  { readonly params: readonly any[]; readonly result: any }
>;

/** Fully permissive contract for incrementally typed or JavaScript runtimes. */
export interface PermissiveReflexContracts extends ReflexContracts {
  readonly state: Record<string, any>;
  readonly events: PermissiveEventPayloads;
  readonly effects: PermissiveEffectPayloads;
  readonly subscriptions: PermissiveSubscriptionPayloads;
}

/**
 * The ambient contract for an application that owns a single runtime.
 *
 * Augment it once, next to the id files, and the package-level entry points
 * that cannot receive an explicit type argument — `useSubscription` above all,
 * because a React context type is fixed when the context is created — check
 * against it:
 *
 * ```ts
 * declare module '@flexsurfer/reflex' {
 *   interface DefaultContracts {
 *     state: TodoState;
 *     events: { 'todos/add': [title: string] };
 *     subscriptions: { 'todos/all': { params: []; result: Todo[] } };
 *   }
 * }
 * ```
 *
 * It is a `ReflexContracts`, not a parallel system: the same declaration can be
 * passed explicitly to `createReflexRuntime<T>()` or `createReflexHooks<T>()`.
 * Applications that own several runtimes should do exactly that instead, since
 * one ambient default cannot describe two different runtimes.
 *
 * While unaugmented every section is absent, so the API stays permissive.
 */
export interface DefaultContracts extends ReflexContracts {}

/** Options shared by `createReflexRuntime` implementations. */
export interface CreateReflexRuntimeOptions<TState extends Record<string, any>> {
  readonly initialState: TState;
  readonly runtimeId?: string;
  readonly name?: string;
}

type NormalizeContractMap<TMap, TFallback> = TMap extends object
  ? [keyof TMap] extends [never]
    ? TFallback
    : TMap
  : TFallback;

type DeclaredEffectPayloads<TContracts> = TContracts extends {
  readonly effects: infer TEffects;
}
  ? TEffects extends object
    ? TEffects
    : {}
  : {};

type EffectTupleFor<TKey extends string, TPayload> = 0 extends 1 & TPayload
  ? [id: TKey, value?: TPayload]
  : [TPayload] extends [void]
    ? [id: TKey]
    : undefined extends TPayload
      ? [id: TKey, value?: TPayload]
      : [id: TKey, value: TPayload];

/** State shape owned by `TContracts`, with the legacy state as fallback. */
export type ContractState<TContracts> = TContracts extends { readonly state: infer TState }
  ? TState extends Record<string, any>
    ? TState
    : Record<string, any>
  : Record<string, any>;

/** Normalized event payload map for `TContracts`. */
export type ContractEventPayloads<TContracts> = TContracts extends {
  readonly events: infer TEvents;
}
  ? NormalizeContractMap<TEvents, PermissiveEventPayloads>
  : PermissiveEventPayloads;

/** Event IDs accepted by a runtime's dispatch entry points. */
export type ContractEventId<TContracts> = Extract<keyof ContractEventPayloads<TContracts>, string>;

/** Parameters declared for an event, or `any[]` for an undeclared registration. */
export type ContractEventParams<
  TContracts,
  TId extends string,
> = TId extends keyof ContractEventPayloads<TContracts>
  ? ContractEventPayloads<TContracts>[TId] extends readonly any[]
    ? ContractEventPayloads<TContracts>[TId]
    : never
  : any[];

/** One event vector for `TId`. Omitting `TId` produces the dispatch union. */
export type ContractEventVector<
  TContracts,
  TId extends ContractEventId<TContracts> = ContractEventId<TContracts>,
> =
  TId extends ContractEventId<TContracts>
    ? [id: TId, ...params: ContractEventParams<TContracts, TId>]
    : never;

/** Event vectors accepted by dispatch entry points for `TContracts`. */
export type ContractDispatchVector<TContracts> = ContractEventVector<TContracts>;

/** A typed `dispatch-later` payload for one runtime contract. */
export interface ContractDispatchLaterEffect<TContracts> {
  readonly ms: number;
  readonly dispatch: ContractDispatchVector<TContracts>;
}

/** Normalized custom effect payload map for `TContracts`. */
export type ContractEffectPayloads<TContracts> = NormalizeContractMap<
  DeclaredEffectPayloads<TContracts>,
  PermissiveEffectPayloads
>;

/** Custom effects plus the runtime-owned dispatch effects. */
export type ContractAllEffectPayloads<TContracts> = Omit<
  ContractEffectPayloads<TContracts>,
  'dispatch' | 'dispatch-later'
> & {
  readonly dispatch: ContractDispatchVector<TContracts>;
  readonly 'dispatch-later': ContractDispatchLaterEffect<TContracts>;
};

/** Payload for an effect registration, with a permissive undeclared fallback. */
export type ContractEffectParams<
  TContracts,
  TId extends string,
> = TId extends keyof ContractAllEffectPayloads<TContracts>
  ? ContractAllEffectPayloads<TContracts>[TId]
  : any;

/** Effect IDs accepted in an event handler's returned effect list. */
export type ContractEffectId<TContracts> = [keyof DeclaredEffectPayloads<TContracts>] extends [
  never,
]
  ? string
  : Extract<keyof ContractAllEffectPayloads<TContracts>, string>;

/** One effect tuple accepted by an event handler for `TContracts`. */
export type ContractEffectVector<TContracts> = [keyof DeclaredEffectPayloads<TContracts>] extends [
  never,
]
  ? [id: string, value?: any]
  : {
      [TId in Extract<keyof ContractAllEffectPayloads<TContracts>, string>]: EffectTupleFor<
        TId,
        ContractAllEffectPayloads<TContracts>[TId]
      >;
    }[Extract<keyof ContractAllEffectPayloads<TContracts>, string>];

/** Effect list returned by an event handler for `TContracts`. */
export type ContractEffects<TContracts> = ContractEffectVector<TContracts>[];

/** Normalized subscription payload map for `TContracts`. */
export type ContractSubscriptionPayloads<TContracts> = TContracts extends {
  readonly subscriptions: infer TSubscriptions;
}
  ? NormalizeContractMap<TSubscriptions, PermissiveSubscriptionPayloads>
  : PermissiveSubscriptionPayloads;

/** Subscription IDs accepted by query entry points. */
export type ContractSubscriptionId<TContracts> = Extract<
  keyof ContractSubscriptionPayloads<TContracts>,
  string
>;

/** Parameters declared for a subscription, or `any[]` when undeclared. */
export type ContractSubscriptionParams<
  TContracts,
  TId extends string,
> = TId extends keyof ContractSubscriptionPayloads<TContracts>
  ? ContractSubscriptionPayloads<TContracts>[TId] extends {
      readonly params: infer TParams extends readonly any[];
    }
    ? TParams
    : []
  : any[];

/** Result declared for a subscription, or `TFallback` when undeclared. */
export type ContractSubscriptionResult<
  TContracts,
  TId extends string,
  TFallback = any,
> = TId extends keyof ContractSubscriptionPayloads<TContracts>
  ? ContractSubscriptionPayloads<TContracts>[TId] extends { readonly result: infer TResult }
    ? TResult
    : TFallback
  : TFallback;

/** True for `any`, which carries no type to check anything against. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** True only when every branch of a distributed check held. */
type AllTrue<TChecks extends boolean> = [TChecks] extends [true] ? true : false;

/**
 * Keys of `TState`, distributed so every variant of a union contributes.
 *
 * A plain `keyof` over a union keeps only the keys shared by every variant, so
 * a disjoint state like `{ count: number } | { label: string }` would read as
 * having no keys at all rather than two. Numeric keys are kept rather than
 * filtered to strings, so a state like `{ 0: string }` reads as declared.
 */
type DistributedStateKeys<TState> = TState extends unknown ? keyof TState : never;

/**
 * True when the state section declares no keys at all.
 *
 * An empty section reads as "not declared yet" for the same reason an empty map
 * does in `NormalizeContractMap`: `createReflexRuntime({ initialState: {} })` is
 * the untyped entry point, and it must not reject every key.
 */
type HasOpenState<TContracts> = [DistributedStateKeys<ContractState<TContracts>>] extends [never]
  ? true
  : false;

/**
 * The declared key that a string source names on `TState`.
 *
 * `sourceKey` is always a string, but a state may declare a numeric key, and
 * the runtime's `state[sourceKey]` reads the same property either way — `'0'`
 * and `0` are one property in JavaScript. Mapping the numeric-string form onto
 * the declared numeric key keeps the check aligned with that. Resolves to
 * `never` when the state declares no such key.
 */
type ResolveStateKey<TState, TKey extends string> = TKey extends keyof TState
  ? TKey
  : TKey extends `${infer TNumeric extends number}`
    ? `${TNumeric}` extends TKey
      ? TNumeric extends keyof TState
        ? TNumeric
        : never
      : never
    : never;

/** Whether one state value satisfies a declared result. `any` carries no check. */
type StateValueAccepts<TValue, TResult> =
  IsAny<TValue> extends true ? true : TValue extends TResult ? true : false;

/**
 * Whether every variant of `TState` holds `TKey` with a value satisfying
 * `TResult`.
 *
 * A union state is only ever one of its variants at runtime, and the root
 * subscription publishes that key whichever one is current. So the key has to
 * be present in all of them — a key missing from one variant would read as
 * `undefined` under it — and each variant's value has to satisfy the result.
 */
type StateVariantsAccept<TState, TKey extends string, TResult> = TState extends unknown
  ? [ResolveStateKey<TState, TKey>] extends [never]
    ? false
    : StateValueAccepts<TState[ResolveStateKey<TState, TKey> & keyof TState], TResult>
  : never;

/**
 * Whether a query for a subscription may be issued with no arguments at all.
 *
 * An unbounded `readonly any[]` — the shape an absent or permissive
 * subscription section carries — reads as open. A typed array or a tuple with
 * any declared position still permits a query that carries an argument, which
 * a root subscription would reject at runtime. Only a fixed empty tuple is
 * eligible alongside the permissive fallback.
 */
type ParamsAllowRootSub<TParams extends readonly any[]> = TParams extends readonly []
  ? true
  : [Exclude<keyof TParams, keyof any[]>] extends [never]
    ? IsAny<TParams[number]> extends true
      ? true
      : false
    : false;

/**
 * Subscription IDs that declare no parameters.
 *
 * A root subscription reads one state key straight through, so it cannot serve
 * a parameterized subscription: the runtime throws when a query for one arrives
 * carrying arguments. Narrowing to the parameterless ids moves that failure to
 * the registration site.
 *
 * An open id set is not an unchecked one, exactly as with state keys. An absent
 * or permissive section declares unbounded params and keeps every id available,
 * but a typed index signature declares what every id it admits accepts — so
 * `Record<string, { params: [factor: number]; … }>` yields no root-eligible id
 * at all rather than every one.
 *
 * Unlike state keys, a contract that declares subscriptions but no parameterless
 * one resolves to `never` rather than falling back: there really is no id
 * `regRootSub` can accept.
 */
export type ContractRootSubscriptionId<TContracts> =
  string extends ContractSubscriptionId<TContracts>
    ? ParamsAllowRootSub<ContractSubscriptionParams<TContracts, string>> extends true
      ? string
      : never
    : {
        [TId in ContractSubscriptionId<TContracts>]: ParamsAllowRootSub<
          ContractSubscriptionParams<TContracts, TId>
        > extends true
          ? TId
          : never;
      }[ContractSubscriptionId<TContracts>];

/**
 * The `id` parameter of `regRootSub`, checked against its own declaration.
 *
 * The id set above resolves an open subscription section through its index
 * signature, which hides a narrower named entry the same way a state's index
 * signature hides a named property. Resolving `TId` here reads that entry, so a
 * parameterized id declared alongside an open index signature is still
 * rejected.
 */
export type ContractRootSubscriptionSubject<TContracts, TId extends string> = TId &
  (AllTrue<
    TId extends string ? ParamsAllowRootSub<ContractSubscriptionParams<TContracts, TId>> : never
  > extends true
    ? unknown
    : never);

/**
 * Whether `TKey` may back a root subscription for `TId`.
 *
 * The subscription publishes `state[sourceKey]` unchanged, so the state's type
 * at that key must satisfy the subscription's declared result. The key is
 * resolved through an ordinary indexed access, which is what keeps a narrower
 * named property visible: `{ [key: string]: number | string; count: number }`
 * reads `number` at `count` and `number | string` everywhere else, so a `count`
 * subscription declaring `number` accepts the named key and rejects the rest.
 * Enumerating valid keys instead cannot express that, because `keyof` collapses
 * literal keys into `string` as soon as an index signature is present.
 *
 * The id, the key, and the state's own variants are all distributed, and every
 * combination must hold. So a union-typed id — `'count' | 'label'` from an id
 * variable, say — is accepted only with a key valid for each of its members,
 * and a union state is accepted only with a key every variant declares.
 *
 * `any` on either side carries nothing to check: an `any` state value stays
 * permissive, as does an undeclared result.
 */
type ContractRootSourceIsValid<TContracts, TId extends string, TKey extends string> =
  HasOpenState<TContracts> extends true
    ? true
    : AllTrue<
        TId extends string
          ? TKey extends string
            ? StateVariantsAccept<
                ContractState<TContracts>,
                TKey,
                ContractSubscriptionResult<TContracts, TId>
              >
            : never
          : never
      >;

/**
 * The `sourceKey` parameter of `regRootSub`, checked against `TId`.
 *
 * Written as an intersection rather than a conditional so `TKey` stays in an
 * inferable position: the compiler still reads the literal the caller passed,
 * and the guard collapses the parameter to `never` when that literal cannot
 * back `TId`.
 */
export type ContractRootSubscriptionSource<
  TContracts,
  TId extends string,
  TKey extends string,
> = TKey & (ContractRootSourceIsValid<TContracts, TId, TKey> extends true ? unknown : never);

/** One subscription vector for `TId`. Omitting `TId` produces the query union. */
export type ContractSubscriptionVector<
  TContracts,
  TId extends ContractSubscriptionId<TContracts> = ContractSubscriptionId<TContracts>,
> =
  TId extends ContractSubscriptionId<TContracts>
    ? [id: TId, ...params: ContractSubscriptionParams<TContracts, TId>]
    : never;

/** Subscription vectors accepted by public query entry points. */
export type ContractSubscribeVector<TContracts> = ContractSubscriptionVector<TContracts>;

/** Result produced by one declared dependency vector. */
type DependencyValue<TContracts, TDependency> = TDependency extends readonly [
  infer TId extends string,
  ...unknown[],
]
  ? ContractSubscriptionResult<TContracts, TId>
  : any;

/**
 * The dependency values a `regSub` compute function receives, as one tuple in
 * declaration order.
 *
 * `TDependencies` is inferred from the dependency function's returned tuple, so
 * reordering dependencies changes the compute signature and surfaces as a type
 * error at the registration site. A dependency list the compiler cannot see as
 * a fixed tuple — built with `map`, `slice`, or a widening annotation — stays a
 * plain array instead of failing to compile.
 */
export type ContractSubscriptionDependencyValues<
  TContracts,
  TDependencies extends readonly unknown[],
> = {
  -readonly [TIndex in keyof TDependencies]: DependencyValue<TContracts, TDependencies[TIndex]>;
};

/** Idempotent cleanup returned by watches and module installation. */
export type ReflexDisposer = () => void;

/** Options for a non-React subscription watch. */
export interface WatchSubscriptionOptions {
  readonly emitInitial?: boolean;
  readonly label?: string;
}

/** Listener invoked with the latest and previously published subscription values. */
export type WatchSubscriptionListener<TValue> = (
  value: TValue,
  previousValue: TValue | undefined,
) => void;

/** Synchronous feature installer accepted by `runtime.registerModule`. */
export type ReflexModule<TRegistrar> = (registrar: TRegistrar) => void | ReflexDisposer;
