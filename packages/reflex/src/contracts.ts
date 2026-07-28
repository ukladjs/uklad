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
