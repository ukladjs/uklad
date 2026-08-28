# RFC: cache-owned TanStack Query subscriptions

- **Status:** implemented
- **Last updated:** 2026-08-27
- **Packages:** `@ukladjs/core`, `@ukladjs/tanstack-query`
- **Replaces:** the state-backed `regQuerySub` design in
  [TanStack Query integration](../architecture/tanstack-query.md)
- **Related runtime design:**
  [Subscription runtime](../architecture/subscription-runtime.md) and
  [Subscription bookkeeping](../architecture/subscription-registry.md)

## Decision

TanStack Query remains the sole owner of server-state data, observer policy,
cache lifetime, and garbage collection. Uklad exposes that data through an
ordinary subscription ID backed by a new generic external-subscription source
in `@ukladjs/core`; it does not mirror the mapped result into application
state.

`@ukladjs/tanstack-query` implements `regQuerySub` on that primitive:

- a render-time subscription read synchronously returns TanStack's optimistic
  result, including already-cached data;
- the first committed consumer starts one `QueryObserver` per serialized Uklad
  query vector;
- observer notifications invalidate the external Uklad node, which re-reads
  its current snapshot and publishes through the normal subscription graph;
- the final consumer releases the observer and external node, while TanStack's
  `gcTime` remains the only server-cache retention policy; and
- event handlers obtain synchronous cached values through a package-managed,
  read-only coeffect configured when the QueryClient is attached.

The current state-backed bridge remains conceptually valid only when an
application deliberately transfers ownership of a remote projection into
Uklad state. That behavior is not the default query integration.

The implementation is complete. The merged work follows the [PR checklist](#pr-checklist)
below; the final public surface is linked in [Final public API](#final-public-api).

## Context

The shipping adapter attaches `regSubExt` to an already-registered root or
derived subscription. The extension creates a `QueryObserver`, maps its result,
and calls `SubscriptionExtensionContext.updateRoot()`. Core authenticates that
request, dispatches a private event, applies the updater to a top-level state
key, and publishes the ordinary state-backed subscription graph.

```text
passive Uklad signals → regSubExt → QueryObserver
                                      ↓
Uklad private event ← mapped observer result
        ↓
backing state root → subscriptions → views
```

This design successfully keeps the mutable TanStack observer result out of
application code, uses public Uklad APIs, and gives the observer a consumer
lifecycle. It nevertheless imposes the wrong ownership and timing model for a
cache integration.

## Problems in the current implementation

### A second retention path

`regQuerySub` requires a `stateKey` and updater. Every mapped value is retained
in both TanStack's query cache and a Uklad application-state root. The object
may initially be shared by reference rather than copied byte-for-byte, but
there are still two owners and two independent retention policies.

Parameterized queries make the problem explicit. A subscription such as
`['todos/by-id', id]` merges results into a `todoById` state map. Releasing its
observer does not remove the state-map entry, and TanStack garbage collection
cannot reclaim the Uklad reference. Persist and DevTools may also treat this
mirror as durable application state even though TanStack owns it.

### Cached data misses the first render

React calls Uklad's `getSnapshot()` during render. `regSubExt` intentionally
does not create or synchronize its extension during a dormant read; activation
starts only when `useSyncExternalStore` subscribes after commit. The adapter
therefore reads `QueryObserver.getOptimisticResult()` too late and routes even
that synchronous cached result through an asynchronous private event.

Given cached `{ id: 1, title: 'Cached' }`, the current sequence is:

```text
render: Uklad backing root → loading
commit: activate extension → create observer → read cached value
later:  private event → state publication → rerender cached value
```

The delay comes from the bridge, not TanStack Query. Query Core can return the
cached optimistic result synchronously without fetching.

### Same-key option changes are ignored

The current extension recreates its observer only when `queryHash` changes.
When a Uklad signal changes `enabled`, `queryFn`, `select`, `staleTime`, retry
policy, refetch intervals, or other options while preserving the same query
key, the extension returns early and never calls `QueryObserver.setOptions()`.
For example, changing `enabled` from `false` to `true` currently does not start
the query when its key is unchanged.

### Query inputs are delayed passive signals

Signals are sampled outside the graph on the next host task after every state
publication. A query whose key depends on Uklad state therefore lags the state
generation that selected it. The signal is also a hidden data dependency from
the graph's perspective: diagnostics and liveness do not show that the query
result depends on it.

### Event access is coupled to the state mirror

The mirror makes cached data convenient to read from `draftState`, but that
value can already lag behind the QueryClient while its private update event is
queued. Removing the mirror must preserve synchronous event-time reads without
passing a mutable QueryClient into application event handlers.

### Tests encode the old boundary

The package tests currently prove that observer updates enter state and wait
through repeated extension/event/publication cycles. The tests pass, but they
validate the behavior this RFC replaces rather than the desired cache-owned
invariants.

## Goals

1. Return hydrated, initial, placeholder, or cached query data on the first
   Uklad subscription read.
2. Keep views on ordinary `useSubscription`; do not introduce a query-specific
   React hook or provider.
3. Keep one reactive graph and make query inputs real, inspectable Uklad
   dependencies.
4. Keep TanStack Query as the only server-state cache and garbage-collection
   owner.
5. Preserve parameterized subscriptions with one observer per serialized Uklad
   query vector.
6. Apply every option change, including changes that preserve the query hash.
7. Preserve graph equality cutoffs, derived subscriptions, error retention,
   tracing, provisional-render cleanup, and transactional activation.
8. Give events an explicit synchronous, read-only cache capability through a
   coeffect owned and registered by the TanStack package.
9. Keep query fetching, mutations, invalidation, and cache writes in effects or
   platform adapters.
10. Build the adapter only on documented public `@ukladjs/core` APIs.

## Non-goals

- Replacing TanStack Query's cache, retries, invalidation, hydration, or
  garbage collection.
- Exposing `QueryClient`, `QueryObserver`, `refetch`, or mutation commands to
  application event handlers or views.
- Making arbitrary asynchronous reads legal inside events, coeffects, or
  subscription computation.
- Starting requests during render or server rendering.
- Turning every `regSubExt` integration into an external subscription source.
- Automatically persisting server-state data through `@ukladjs/persist`.
- Solving Suspense or TanStack's experimental render-time prefetching in the
  first implementation.

## Architectural invariants

The implementation is accepted only if all of these remain true:

- `read()` is synchronous and never subscribes, fetches, dispatches, or
  publishes.
- External work starts only after a real render/watch consumer activates the
  node.
- Observer callbacks carry invalidation, not a value payload; Uklad always
  re-reads the latest external snapshot.
- A mapped result never enters application state unless the application opts
  into a separately named materialization API.
- External nodes participate in the same dependency graph, equality policy,
  topological settlement, and listener delivery as state-backed nodes.
- No subscription listener observes a partially settled combination of Uklad
  state and external values.
- External invalidations raised during graph settlement or listener delivery
  are queued and deduplicated rather than re-entering the engine.
- A render that never commits starts no observer and no request.
- Final consumer release and provisional-render eviction cannot leak an
  observer, listener, timer, or driver reference.
- Event cache reads are explicit coeffects and are synchronous snapshots at
  event execution time.

## Core API: `regExternalSub`

Add a generic external-source registration to `UkladRegistrar`. The exact
public names may change during implementation, but the lifecycle split is part
of the contract.

```ts
export interface ExternalSubscriptionContext {
  /** Mark this source as potentially changed; no value crosses the callback. */
  invalidate(): void;
}

export interface ExternalSubscriptionDriver<TInputs extends readonly unknown[], TResult> {
  /**
   * Return the current external snapshot for these dependency values.
   * This runs during dormant pulls and graph settlement. It must be
   * synchronous and must not start external work.
   */
  read(inputs: TInputs): TResult;

  /** Start external observation for the first committed consumer. */
  activate(inputs: TInputs, context: ExternalSubscriptionContext): void;

  /** Apply the latest inputs after an active graph recomputes this node. */
  sync(inputs: TInputs): void;

  /**
   * Release all resources. Core calls this after final release, activation
   * rollback, module clearing, or provisional eviction as applicable.
   */
  dispose(): void;
}

interface UkladRegistrar<TContracts extends UkladContracts> {
  regExternalSub<
    TId extends ContractSubscriptionId<TContracts>,
    TDependencies extends readonly ContractSubscribeVector<TContracts>[],
  >(
    id: TId,
    dependencies: (
      ...params: ContractSubscriptionParams<TContracts, TId>
    ) => readonly [...TDependencies],
    createDriver: (
      ...params: ContractSubscriptionParams<TContracts, TId>
    ) => ExternalSubscriptionDriver<
      ContractSubscriptionDependencyValues<TContracts, TDependencies>,
      ContractSubscriptionResult<TContracts, TId>
    >,
    config?: SubConfig,
  ): void;
}
```

`createDriver` runs once for one canonical serialized subscription vector. It
may allocate a lazy controller, but it must not subscribe or fetch. Core owns
the driver after creation and guarantees one terminal `dispose()` call.

`regExternalSub` is a subscription definition, not an extension attached to a
root or computed definition. Registering the same ID through `regRootSub`,
`regSub`, or `regExternalSub` is a collision.

### Why this is not `regSubExt`

`regSubExt` deliberately leaves a subscription's data definition unchanged and
activates only after commit. Its only publication capability is a protected
state-root update. Making it synchronously supply render data would change all
of those semantics and turn a narrow lifecycle extension into another
subscription kind implicitly.

Keep `regSubExt` for external lifecycles that intentionally publish into
application state. Add `regExternalSub` as an explicit graph source.

## Subscription-engine changes

### Node kind and rank

Add `'external'` to `SubscriptionKind`. An external node has ordinary declared
dependencies, so its rank is `1 + max(dependency rank)` or zero when it has no
dependencies. Unlike a persistent state root, a parameterized or
parameterless external node is terminal after its final consumer and is
evicted from the canonical cache.

DevTools diagnostics report `kind: 'external'`, the ordinary query vector,
active status, version, and cached value/error status. They do not expose the
driver or external client.

### Dormant read

During `getSnapshot()`:

1. Resolve and pull declared dependencies in post-order.
2. Create the per-vector driver if the external node does not exist.
3. Call `driver.read(dependencyValues)`.
4. Store the result or error in the ordinary subscription cell.
5. Apply the node's equality policy on later reads.
6. Do not call `activate()` or `sync()`.

This is the path that makes cached TanStack data available on the first render
and during SSR without starting a request.

### Activation and render-to-commit catch-up

Core activates dependencies before dependents as it does today. For an external
node it then:

1. installs an opaque `invalidate()` capability scoped to that node and
   activation generation;
2. calls `driver.activate(currentInputs, context)`;
3. validates the external snapshot again before returning from the first
   subscription; and
4. relies on `useSyncExternalStore`'s post-subscribe comparison rather than
   issuing an initial listener callback.

An invalidation from a disposed or superseded activation is ignored. A thrown
activation error rolls the graph back transactionally and disposes the driver.

The catch-up read covers an external cache change between render and commit. It
must refresh the external node and active parent path even when Uklad's STATE
publication epoch did not change.

### Uklad dependency changes

External dependencies are real graph edges. When one changes during a STATE
publication:

1. the external cell recomputes with `driver.read(nextInputs)` in topological
   order;
2. the result participates in equality and downstream settlement in the same
   publication wave;
3. the active driver is queued for one `sync(nextInputs)` call even when the
   mapped result compared equal, because observer options may still have
   changed; and
4. queued driver syncs run after graph computation but before listener
   delivery.

Callbacks raised synchronously by `sync()` are added to the external
invalidation queue. They cannot re-enter the current state wave.

This means a query-key change can expose cached data for the new key in the
same Uklad publication while observer rebinding remains outside pure
computation.

### External invalidation wave

`ExternalSubscriptionContext.invalidate()` marks the active source dirty. If
the engine is idle, it begins a source publication wave immediately. If the
engine is computing, reconciling drivers, or notifying listeners, it adds the
node to a deduplicating pending set.

A source wave:

1. calls `driver.read(currentInputs)` once for each invalidated source;
2. retains a thrown mapper/read error in the source cell;
3. applies the source equality check once;
4. propagates observable changes through active dependents in rank order;
5. freezes listener plans after the whole graph settles; and
6. delivers each affected listener at most once.

After the engine returns to idle, it drains invalidations accumulated during
the preceding wave. Invalidations are activation-scoped and deduplicated by
node, so a burst publishes only the latest external snapshot.

### Equality

External subscriptions use `config.equalityCheck` or the runtime default, like
computed subscriptions. Equality belongs to Uklad's mapped result, not the
mutable TanStack observer result.

TanStack's `notifyOnChangeProps` remains a first-stage filter deciding whether
the observer invalidates Uklad. Uklad equality is the second-stage filter
deciding whether the mapped snapshot changes the reactive graph.

### Errors

- A thrown `read()` or mapper error is retained in the source cell and follows
  existing subscription error/recovery semantics.
- `activate()` failures roll back graph activation and dispose the driver.
- A `sync()` failure is reported and retained as a source error through the
  next source refresh; it must not leave a half-switched observer active.
- `dispose()` failures are isolated like existing release-hook failures.
- Observer callbacks never run application mapping code directly, so a mapper
  exception cannot escape through TanStack's notification stack.

### Provisional reads and cleanup

External nodes use the existing provisional lease for render-created graphs.
Sweeping a never-activated external node calls `driver.dispose()` before
eviction. The driver must tolerate disposal before activation.

An activated external node becomes terminal after its final consumer releases
it. Core disposes and evicts it, then releases now-unused dependencies. A later
read recreates a fresh driver and reads the still-authoritative external cache.

## TanStack driver

`@ukladjs/tanstack-query` implements one driver per serialized Uklad query
vector.

### Render-time `read`

`read(inputs)`:

1. creates the latest `QueryObserverOptions` from declared dependency values
   and subscription parameters;
2. applies `notifyOnChangeProps` from `observe`;
3. obtains QueryClient-defaulted options;
4. lazily creates one `QueryObserver` if necessary;
5. stores the latest options for lifecycle reconciliation;
6. calls `observer.getOptimisticResult(defaultedOptions)`; and
7. freezes a `QuerySnapshot` and calls the domain mapper.

Constructing or reading the observer may build an entry in TanStack's cache,
matching TanStack's own optimistic render path. It must not attach the observer
or start a fetch.

### Activation and updates

`activate()` subscribes to the observer. Its listener ignores the supplied
result and calls only `context.invalidate()`. Subscribing is the first point at
which TanStack may fetch.

`sync()` applies the latest defaulted options with
`QueryObserver.setOptions()`. It does this for every changed Uklad dependency
tuple, even when the query hash is unchanged. QueryObserver therefore owns
same-key option changes and query-key switching instead of the adapter
destroying and recreating observers based only on `queryHash`.

`dispose()` unsubscribes and destroys the observer idempotently.

### Observed properties

Preserve the current policy:

- default to `['data', 'error']`;
- require explicit lifecycle fields such as `isFetching` when the mapper
  exposes them; and
- allow `'all'` only as a deliberate opt-in.

The observer callback is only an invalidation signal. The mapper always sees a
fresh read-only snapshot obtained by core's source read.

## Proposed `regQuerySub` API

The query adapter directly registers the external subscription. Applications
no longer register a backing root or supply a `stateKey`/updater.

```ts
regQuerySub(
  registrar,
  queryClient,
  appIds.subscriptions.todoById,
  () => [],
  (_inputs, id) => ({
    queryKey: todoKeys.detail(id),
    queryFn: () => api.getTodo(id),
    staleTime: 30_000,
  }),
  (query) => {
    if (query.error !== null) {
      return { kind: 'error' as const, message: query.error.message };
    }
    if (query.data === undefined) return { kind: 'loading' as const };
    return { kind: 'ready' as const, todo: query.data };
  },
);
```

The fourth argument contains real Uklad dependencies. Query parameters remain
small scalar cache coordinates:

```ts
subscriptions: {
  [appIds.subscriptions.todoById]: {
    params: [id: TodoId];
    result: TodoQueryResult;
  };
}
```

A derived subscription can consume the query normally:

```ts
registrar.regSub(
  appIds.subscriptions.todoTitle,
  (id) => [[appIds.subscriptions.todoById, id]],
  ([query]) => (query.kind === 'ready' ? query.todo.title : undefined),
);
```

No query result or loading sentinel is added to `AppState` or initial state.

## DevTools playground compatibility

All three query patterns in `examples/devtools-playground` remain supported.
They become direct external subscriptions instead of extensions that copy
observer results through state roots.

| Playground case                        | New registration model                                                   | Lifecycle/result behavior                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parameterless polling clock            | External subscription with no Uklad dependencies or parameters           | The first consumer activates the observer and its `refetchInterval`; the last consumer disposes it and stops polling. A cached clock is readable synchronously before activation. |
| React-parameterized item               | One external node per serialized `['server/item-by-id', itemId]` vector  | Each item owns an independent observer while active. Releasing a vector removes the Uklad node; TanStack alone retains or collects its cached item.                               |
| Region query controlled by Uklad state | External subscription with `server/region` as a real declared dependency | Selecting a region recomputes the query snapshot in the same state publication, then `sync()` rebinds the active observer before listeners run.                                   |

The three registrations keep the same conceptual shape without a target:

```ts
// 1. Parameterless polling.
regQuerySub(
  registrar,
  queryClient,
  appIds.subscriptions.serverClock,
  () => [],
  () => ({
    queryKey: playgroundServerKeys.clock(),
    queryFn: ({ signal }) => api.clock(signal),
    refetchInterval: 1_000,
  }),
  (query) => toServerResult<ServerClock>(query),
);

// 2. The subscription parameter is the query coordinate.
regQuerySub(
  registrar,
  queryClient,
  appIds.subscriptions.serverItemById,
  () => [],
  (_inputs, itemId) => ({
    queryKey: playgroundServerKeys.item(itemId),
    queryFn: ({ signal }) => api.item(itemId, signal),
  }),
  (query) => toServerResult<ServerItem>(query),
);

// 3. Application state is a real reactive query input.
regQuerySub(
  registrar,
  queryClient,
  appIds.subscriptions.serverRegionSummary,
  () => [[appIds.subscriptions.serverRegion]],
  ([region]) => ({
    queryKey: playgroundServerKeys.region(region),
    queryFn: ({ signal }) => api.region(region, signal),
  }),
  (query) => toServerResult<ServerRegionSummary>(query),
);
```

The migration removes `serverClock`, `serverItems`, and
`serverRegionSummary` from `stateKeys`, `AppState`, and initial state. It also
removes the `serverItems` aggregate root and the computed
`serverItemById` lookup because the parameterized external subscription now
returns that result directly. `serverRegion` remains application state: it is
user-selected input, not duplicated server data.

For the region case, `read(nextInputs)` uses optimistic options for the newly
selected key before `sync(nextInputs)` mutates the active observer. Therefore a
cached new-region value is visible in the selecting event's publication; an
uncached key publishes `loading`, and the post-computation `sync()` starts its
fetch. Fetch completion later invalidates the external source without another
application-state revision.

## Event-time cache reads

Removing the state mirror must not force events to import a QueryClient or
receive query results in event payloads. Synchronous cached data is an
environmental input and belongs in a coeffect.

### Package-managed cache coeffects

Extend `attachQueryClient` with cache-coeffect definitions. This is the direct
replacement for application-authored registrations such as
`registrar.regCoeffect('todos/cached-list', ...)`:

```ts
attachQueryClient(runtime, queryClient, {
  cacheCoeffects: [
    {
      id: appIds.coeffects.todosCachedList,
      read: (cache) => cache.getData<readonly Todo[]>(todoKeys.list()),
    },
  ],
});
```

The application still declares the coeffect ID and result type, but the
TanStack package owns its registration, QueryClient closure, and disposal.
`attachQueryClient` is generic over `AppContracts`, so every configured ID,
argument, and return value must satisfy the corresponding coeffect contract.

The package passes each definition a frozen read-only cache capability:

```ts
export interface QueryCacheReader {
  getData<TData = unknown, TQueryKey extends QueryKey = QueryKey>(
    queryKey: TQueryKey,
  ): TData | undefined;

  getState<TData = unknown, TError = Error, TQueryKey extends QueryKey = QueryKey>(
    queryKey: TQueryKey,
  ): Readonly<QueryState<TData, TError>> | undefined;
}
```

It exposes no fetch, mutation, invalidation, removal, or QueryClient access.

The implementation in `lifecycle.ts` must perform the registration explicitly
inside the same Uklad module that owns QueryClient mount/unmount:

```ts
export function attachQueryClient<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
  queryClient: QueryClient,
  options: AttachQueryClientOptions<TContracts> = {},
): UkladDisposer {
  const cache = createQueryCacheReader(queryClient);

  return runtime.registerModule((registrar) => {
    for (const definition of options.cacheCoeffects ?? []) {
      registrar.regCoeffect(definition.id, (arg, context) => definition.read(cache, arg, context));
    }

    queryClient.mount();
    rememberAttachment(runtime, queryClient);

    return () => {
      forgetAttachment(runtime, queryClient);
      queryClient.unmount();
    };
  });
}
```

This pseudocode is normative about ownership: application code supplies
declarative definitions in attachment config; only the package calls
`registrar.regCoeffect`. The concrete implementation must preserve the existing
duplicate-attachment checks and make partial installation transactional.

`getState()` returns a frozen shallow snapshot rather than TanStack's mutable
internal state object. Query data remains a read-only external snapshot by
contract and is never copied into Uklad state.

The application contract and event binding remain explicit:

```ts
interface AppContracts extends UkladContracts {
  coeffects: {
    [appIds.coeffects.todosCachedList]: {
      arg: void;
      value: readonly Todo[] | undefined;
    };
  };
}

registrar.regEvent(
  appIds.events.todoUseCached,
  ({ coeffects: { cachedTodos } }) => {
    const todos = cachedTodos ?? [];
    // Synchronous transition based on the event-time cache snapshot.
  },
  {
    coeffects: {
      cachedTodos: appIds.coeffects.todosCachedList,
    },
  },
);
```

The application must still include the coeffect ID and value type in
`AppContracts`. That declaration is intentional: it makes environmental reads
visible per event and lets test/headless composition replace the provider.

### Dynamic domain reader projection

Query keys normally stay in the platform adapter. When an event needs a
dynamic key, configure one coeffect whose value is a frozen domain-specific
reader rather than exposing the generic cache capability to shared events:

```ts
interface TodoCacheReader {
  getList(): readonly Todo[] | undefined;
  getById(id: TodoId): Todo | undefined;
}

attachQueryClient(runtime, queryClient, {
  cacheCoeffects: [
    {
      id: appIds.coeffects.todoCache,
      read: (cache): TodoCacheReader => ({
        getList: () => cache.getData(todoKeys.list()),
        getById: (id) => cache.getData(todoKeys.detail(id)),
      }),
    },
  ],
});
```

Only the composition config sees TanStack query keys. Shared events receive a
narrow domain reader and remain testable.

The package freezes the `QueryCacheReader` capability itself, but it does not
freeze or clone arbitrary values returned by a definition. Uklad's normal
coeffect contract treats the injected value as read-only. Definitions execute
for each injection, so each reader method observes the cache at event time.

### Missing data and asynchronous reads

Returning `undefined` is a successful cache miss. An event that requires data
not already cached returns a custom effect. The effect may call `fetchQuery()`
and dispatch a result event. Events and coeffects never return a promise.

## Explicit state materialization

Some workflows intentionally take ownership of a remote projection: offline
editing, durable snapshots, optimistic local models, or atomic transitions
that must persist independently of the QueryClient. Those cases may use a
separately named API such as `regQueryProjection` built on `regSubExt` and an
explicit state target.

That API must be unmistakably opt-in:

- its name and documentation state that it transfers/duplicates ownership;
- the application declares initial state, target root, merge, cleanup, and
  persistence policy;
- TanStack garbage collection no longer implies projection cleanup; and
- it is not used by the default query subscription or examples.

The first external-subscription release may omit this convenience and leave
`regSubExt` as the lower-level mechanism until a real application requires it.

## Lifecycle attachment

`attachQueryClient(runtime, queryClient, options?)` continues to enforce one
QueryClient per runtime and one runtime per QueryClient. Its module owns, in
order:

1. QueryClient mount;
2. configured cache coeffect registrations;
3. attachment-scoped query-definition bookkeeping needed by the adapter; and
4. reverse-order cleanup followed by QueryClient unmount.

The current `assertAttachedQueryClient(queryClient)` proves only that a client
is attached somewhere; it cannot prove that a registrar belongs to the same
runtime. The implementation should either introduce an attachment-scoped
registration handle or document this remaining limitation. It must not expose
runtime internals merely to strengthen this assertion.

## SSR and hydration

Server rendering creates one QueryClient and one Uklad runtime per request,
hydrates the QueryClient before rendering, attaches it, and registers the same
query definitions. `getSnapshot()` then calls the external driver's `read()`
and returns hydrated data synchronously. Because no consumer commits on the
server, no observer subscribes and no request starts.

Client hydration must construct equivalent query options and mapper results so
`useSyncExternalStore` receives a stable server snapshot. SSR acceptance tests
must cover both cached success and uncached loading values.

## DevTools and tracing

External sources remain visible as Uklad subscription nodes, not state roots or
events.

Add trace operations for:

- external node creation and render-time read;
- activation, option synchronization, and disposal;
- external invalidation receipt and coalesced publication; and
- retained read/mapper errors.

Do not synthesize an application event for observer changes. DevTools should
show the external source version and its downstream recomputations while the
STATE panel remains unchanged.

## Public surface changes

### `@ukladjs/core/vanilla`

- Add `UkladRegistrar.regExternalSub`.
- Export `ExternalSubscriptionContext` and
  `ExternalSubscriptionDriver` types.
- Extend subscription diagnostics with `kind: 'external'`.
- Do not expose direct subscription publication or mutable graph nodes.

### `@ukladjs/tanstack-query`

- Replace the state-target `regQuerySub` signature with the external-source
  signature.
- Keep `QuerySnapshot`, observed-property configuration, `QueryClient`, and
  `readQueryData`.
- Add `QueryCacheReader` and typed `attachQueryClient` cache-coeffect options.
- Consider `readQueryState` as a standalone helper matching the reader method.
- Remove `QuerySubscriptionTarget` from the default API.
- Retain or add `regQueryProjection` only as explicit compatibility/ownership
  transfer, not as the main path.

## Implementation map

### Core

- `packages/core/src/contracts.ts`
  - add dependency/result extraction needed by `regExternalSub` only if the
    existing helpers are insufficient;
- `packages/core/src/types.ts` or a focused external-subscription type module
  - define the public driver and context contracts;
- `packages/core/src/runtime/api.ts`
  - add the typed registrar method;
- `packages/core/src/runtime/runtime.ts`
  - delegate registration and record its module handle;
- `packages/core/src/runtime/subscriptions/types.ts`
  - add the external node kind and lifecycle hooks;
- `packages/core/src/runtime/subscriptions/subscription-runtime.ts`
  - own external definitions, per-vector drivers, provisional cleanup, and
    registration collisions;
- `packages/core/src/runtime/subscriptions/cell.ts`
  - retain current dependency inputs and support external refresh/error state;
- `packages/core/src/runtime/subscriptions/engine.ts`
  - add source invalidation waves, reconciliation, reentrancy deferral, and
    activation catch-up; and
- core unit/type tests
  - execute every lifecycle and graph invariant below independently of
    TanStack Query.

Do not put TanStack-specific behavior in core. The primitive must be usable for
another `useSyncExternalStore`-shaped cache or observable source.

### TanStack package

- replace `StateBackedQueryExtension` with the external driver;
- delete the state target/update path from the default registration;
- change observer callbacks to invalidation-only;
- apply options with `setOptions()` on every input change;
- extend attachment with the read-only coeffect;
- update package types and consumer fixtures;
- replace state-bridge tests; and
- migrate README and architecture documentation after the implementation
  passes acceptance gates.

### Examples

Migrate `examples/todomvc-query`:

- remove the query result from `AppState`, `stateKeys`, and initial state;
- register the query directly as an external subscription;
- keep derived todo subscriptions dependent on the query subscription;
- declare one attachment-managed cache coeffect for an event scenario;
- keep mutations and invalidation in platform effects; and
- prove first-render hydrated data in a focused component/headless test.

Migrate the three `examples/devtools-playground` server queries:

- remove the clock, item-result map, and region-summary query results from
  application state;
- keep the selected region as the declared Uklad dependency;
- register the polling, parameterized, and dependency-controlled queries as
  direct external subscriptions;
- update the UI explanation to describe cache-owned sources instead of state
  bridge events; and
- preserve the existing focused integration test as a required compatibility
  test with stronger lifecycle and state-revision assertions.

## Acceptance tests

### Generic core primitive

- A dormant read returns `driver.read()` synchronously and does not activate.
- Repeated dormant reads memoize under the existing publication rules.
- First consumer activates exactly once; additional consumers share the node.
- Final consumer disposes exactly once and evicts the external node.
- An aborted render is swept and disposed without activation.
- Activation failure rolls back dependencies and disposes the driver.
- A dependency change calls `read()` in the same state wave and `sync()` once,
  even when result equality succeeds.
- External invalidation recomputes active dependents in rank order.
- Equal mapped results notify nobody and stop downstream work.
- Bursts and reentrant invalidations are deduplicated without lost final state.
- A cache change between render and subscribe is visible in the post-subscribe
  snapshot without an initial listener callback.
- Driver/read errors retain and recover like computed-subscription errors.
- Clearing definitions rejects active nodes and disposes dormant drivers.
- Diagnostics are read-only and never activate a driver.

### TanStack adapter

- A fresh seeded cache value is returned on the first subscription read.
- A fresh seeded value with valid `staleTime` does not call `queryFn` after
  activation.
- An uncached first read returns the mapped loading result and fetch starts only
  after activation.
- Query success invalidates the external source and updates derived
  subscriptions without changing Uklad state revisions.
- Parameterized vectors own independent observers and release independently.
- Releasing a parameterized vector leaves no Uklad data map retaining its
  result; TanStack `gcTime` remains authoritative.
- Switching to a new key with cached data exposes that data in the same Uklad
  state publication as the selecting dependency.
- `enabled: false → true` with the same query key starts the query.
- Same-key changes to `queryFn`, `select`, `staleTime`, and observed lifecycle
  fields reach `QueryObserver.setOptions()`.
- Structural sharing plus Uklad equality suppresses an unchanged refetch.
- Mapper failures become retained subscription errors rather than escaping
  `queryClient.setQueryData()` or TanStack notification.
- Observer callbacks from an old/disposed activation cannot invalidate a new
  node.
- SSR reads hydrated data without subscribing or fetching.
- ESM, CJS, TypeScript, and package-consumer fixtures expose the new API.

### Event reader

- `attachQueryClient` registers the configured coeffect and removes it on
  disposal.
- The injected reader is frozen and exposes no mutating client operation.
- `getData` and `getState` return current cache values synchronously.
- Every configured definition receives only the read-only cache reader plus
  its declared coeffect argument/context.
- A cache miss injects `undefined` without aborting the event.
- A thrown domain reader aborts the event before state commit under normal
  coeffect error semantics.
- Test/headless composition can replace the application coeffect contract with
  deterministic values.

### DevTools playground

- The parameterless clock starts polling only when its card has a consumer and
  stops polling after the card is hidden and its final consumer releases.
- A seeded clock value is returned on the first read without waiting for an
  observer callback.
- Item vectors for two IDs own independent observers, and switching back to a
  cached ID returns its current value synchronously without a Uklad item map.
- Releasing one item vector neither disposes another vector nor leaves its
  mapped result retained by Uklad.
- Dispatching `server/region-selected` changes the region query key through a
  declared graph dependency; a cached destination is visible in the same state
  publication and an uncached destination publishes loading before fetching.
- Region fetch completion updates the query subscription without creating a
  second application-state revision after the selection event.
- DevTools reports all three results as external subscription nodes and does
  not report query-result state roots or bridge update events.

## Migration plan

1. Implement and stabilize `regExternalSub` behind core unit and type tests.
2. Implement the TanStack external driver alongside the existing state bridge
   under a temporary internal or experimental name.
3. Add attachment-managed cache coeffects and their contract tests.
4. Migrate `examples/todomvc-query` and prove first-render cache behavior.
5. Migrate all three `examples/devtools-playground` patterns and prove polling,
   parameter, dependency-switching, and release behavior.
6. Replace the public `regQuerySub` signature and remove state targets from the
   default docs.
7. If compatibility is required, expose the old behavior under the explicit
   `regQueryProjection` name for one deprecation window.
8. Rewrite `docs/architecture/tanstack-query.md`, the package README, and the
   server-state agent reference only after the new implementation is shipped.
9. Run core, adapter, example, type-compatibility, package-consumer, and
   coverage release gates.

## Rejected alternatives

### Initialize the Uklad root from QueryClient before rendering

This fixes only one startup path. It still creates a second owner, requires
dual hydration, retains parameterized entries, and leaves observer updates on
the asynchronous state bridge.

### Store only a query revision counter in Uklad state

A computed subscription could synchronously read QueryClient behind a dummy
revision dependency. This removes the large data mirror but introduces fake
application state, hidden external reads, broad recomputation, and the same
event/publication machinery. It is the dirty-subscription workaround this RFC
is intended to avoid.

### Publish directly from `regSubExt`

Adding `invalidateTarget()` or direct publication to `regSubExt` still leaves
the first render without an extension instance and makes the target compute
function read hidden external state. It also weakens the extension's current
state-transfer boundary.

### Add a TanStack-specific React hook

A hook built directly on `QueryObserver` would solve render timing but split
the reactive graph, bypass ordinary Uklad subscriptions and derived data, and
force views to know the server-state implementation.

### Automatically register one coeffect per query

Query IDs and environmental-input IDs serve different roles. Per-query
coeffects create unused global handlers, collide with parameterized/dynamic
keys, and cannot decide whether an event needs raw data, query lifecycle state,
or a domain mapping. One configured read-only capability keeps registration
package-owned while event authorization remains explicit.

### Let events read QueryClient directly

This exposes mutation and fetching APIs, couples shared event logic to a
platform cache, and makes deterministic test implementations harder. A narrow
coeffect preserves synchronous access without transferring the client.

## Completion criteria

This RFC's completion criteria are met: the new source primitive and adapter
ship, the TodoMVC query example contains no mirrored remote-data state, a
seeded cache is visible on first render, all three DevTools playground query
patterns run without mirrored remote-data state, same-key option changes are
covered, event cache reads are package-registered coeffects, all release gates
pass, and the architecture/package/agent documentation describes the
cache-owned design.

## Pull request plan

This is the intended merge order, not only a list of work areas. Every PR must
leave the repository green, and no PR should expose a public API whose runtime
semantics are still incomplete.

### PR checklist

- [x] [PR 1 — External-source node lifecycle in core](#pr-1--external-source-node-lifecycle-in-core)
- [x] [PR 2 — External invalidation, reconciliation, and public core API](#pr-2--external-invalidation-reconciliation-and-public-core-api)
- [x] [PR 3 — TanStack cache-owned subscription driver](#pr-3--tanstack-cache-owned-subscription-driver)
- [x] [PR 4 — Attachment-managed cache coeffects](#pr-4--attachment-managed-cache-coeffects)
- [x] [PR 5 — TodoMVC migration and end-to-end proof](#pr-5--todomvc-migration-and-end-to-end-proof)
- [x] [PR 6 — DevTools playground migration and advanced-pattern proof](#pr-6--devtools-playground-migration-and-advanced-pattern-proof)
- [x] [PR 7 — Public API cutover and compatibility boundary](#pr-7--public-api-cutover-and-compatibility-boundary)
- [x] [PR 8 — Runtime hardening and release gates](#pr-8--runtime-hardening-and-release-gates)
- [x] [PR 9 — Documentation and RFC closure](#pr-9--documentation-and-rfc-closure)

### PR 1 — External-source node lifecycle in core

**Scope**

- Add the internal external-subscription definition and node kinds.
- Add the driver lifecycle needed for dormant synchronous reads, activation,
  final-consumer disposal, provisional-node sweeping, and activation rollback.
- Extend internal diagnostics enough to inspect a node without activating it.
- Add focused engine tests for construction, sharing, ownership, cleanup, and
  failure paths.

**Deliberately excluded**

- External invalidation and downstream publication.
- Public `regExternalSub` exports.
- Any TanStack-specific code.

**Merge gate**

- Existing core behavior and public types are unchanged.
- New lifecycle tests cover dormant reads, one activation for many consumers,
  final disposal, aborted renders, activation failure, and definition clearing.

**Depends on:** nothing.

### PR 2 — External invalidation, reconciliation, and public core API

**Scope**

- Add external-source invalidation to the engine's normal publication wave.
- Reconcile state dependencies and call `sync()` after dependency changes.
- Implement invalidation deduplication, reentrancy handling, rank ordering,
  equality suppression, retained errors, and activation catch-up.
- Expose `regExternalSub`, its driver/context types, registrar support,
  `AppContracts` integration, and vanilla entry-point exports.
- Add tracing and DevTools events that distinguish source invalidation from
  state-driven recomputation.

**Deliberately excluded**

- TanStack observer integration.
- Cache coeffects.

**Merge gate**

- Every generic core acceptance test in this RFC passes.
- Type tests prove valid and invalid driver/contract registrations.
- Core package checks, coverage thresholds, and package-consumer fixtures pass.

**Depends on:** PR 1.

### PR 3 — TanStack cache-owned subscription driver

**Scope**

- Implement the lazy `QueryObserver` driver on top of `regExternalSub`.
- Read with `getOptimisticResult()` before activation so hydrated cache data is
  available synchronously on the first render.
- Subscribe only on activation and convert observer callbacks into source
  invalidations, not Uklad state updates.
- Apply every option change through `QueryObserver.setOptions()`, including
  same-key changes.
- Dispose observers with the external node and guard against callbacks from an
  obsolete activation.
- Keep the existing state-backed `regQuerySub` available while the new adapter
  is exercised under an internal or explicitly experimental name.

**Deliberately excluded**

- Removing query targets from the public API.
- Migrating application state.
- Registering event coeffects.

**Merge gate**

- The TanStack adapter acceptance tests pass, including first-render cache
  visibility, uncached activation, same-key options, parameter isolation,
  mapper errors, disposal, SSR, and no Uklad state revision on query success.
- Existing state-backed adapter tests and consumers remain green.

**Depends on:** PR 2.

### PR 4 — Attachment-managed cache coeffects

**Scope**

- Extend `attachQueryClient` with typed `cacheCoeffects` definitions.
- Add the frozen, read-only `QueryCacheReader` capability with synchronous
  `getData()` and `getState()` operations.
- Register each configured coeffect through the attachment module and dispose
  it with that attachment.
- Support fixed domain readers and readers that use a declared coeffect
  argument/context.
- Preserve direct helpers such as `readQueryData()` for platform code and
  tests; application events should use the configured coeffect boundary.

**Deliberately excluded**

- Automatically registering one coeffect for every query.
- Exposing `QueryClient`, mutation methods, or fetch methods to events.

**Merge gate**

- Event-reader acceptance tests cover registration, synchronous hit/miss,
  query state, arguments, disposal, collisions, thrown readers, and contract
  substitution in headless tests.
- Existing `attachQueryClient` usage remains source-compatible when
  `cacheCoeffects` is omitted.

**Depends on:** PR 3.

### PR 5 — TodoMVC migration and end-to-end proof

**Scope**

- Remove query results from the TodoMVC `AppState`, state keys, initial state,
  and state-update events.
- Register the list query through the cache-owned adapter and keep derived
  subscriptions dependent on it.
- Configure the discussed cached-list coeffect in the TanStack attachment and
  consume it from an event through an explicit `regEvent` coeffect binding.
- Keep mutations and invalidation in platform effects.
- Add a focused hydration test proving that seeded todos render on the first
  render, before any observer callback or event-cycle state update.

**Deliberately excluded**

- Removing the old public adapter path.
- Unrelated TodoMVC refactors.

**Merge gate**

- The example contains no mirrored server-data state.
- Its component, event, headless, and type checks pass.
- A query success changes the rendered subscription value without changing the
  Uklad application-state revision.

**Depends on:** PRs 3 and 4.

### PR 6 — DevTools playground migration and advanced-pattern proof

**Scope**

- Remove `serverClock`, `serverItems`, and `serverRegionSummary` from the
  playground's state catalog, contract, and initial state while retaining the
  user-selected `serverRegion` root.
- Register the polling clock, parameterized item, and region-dependent summary
  as direct cache-owned query subscriptions.
- Delete the aggregate item-result root and its computed lookup subscription.
- Update the playground copy and DevTools expectations to describe external
  source nodes rather than query-extension state bridges.
- Expand the existing server-query integration test with cache seeding,
  lifecycle release, parameter isolation, dependency switching, and
  state-revision assertions.

**Deliberately excluded**

- UI redesign or unrelated playground cleanup.
- Adding cache coeffects where no playground event needs a synchronous cache
  read.

**Merge gate**

- All three documented playground cases pass through ordinary
  `useSubscription` calls.
- Hiding the clock stops its polling observer, parameter changes release the
  previous Uklad node, and region selection rebinds through a declared
  dependency.
- Query-result changes create no Uklad state revisions; the region selection
  event creates only its expected application-state revision.
- Browser, headless-safe composition, type checks, and the focused playground
  test remain green.

**Depends on:** PR 5.

### PR 7 — Public API cutover and compatibility boundary

**Scope**

- Make the cache-owned implementation the public `regQuerySub`.
- Remove the state target from its default signature and exported types.
- If a compatibility window is required, expose the old behavior only as the
  explicit `regQueryProjection`; otherwise remove the state bridge.
- Update public exports, contract inference, ESM/CJS builds, declarations, and
  package-consumer fixtures.
- Add a migration note with before/after registration, state removal, and
  coeffect configuration examples.

**Deliberately excluded**

- An overloaded API that silently selects cache-owned or state-backed behavior
  based on arguments.
- Keeping the old implementation as an undocumented fallback.

**Merge gate**

- No default query path writes results into Uklad state.
- Type compatibility failures are intentional, documented, and covered by
  negative tests.
- All supported module formats and consumer fixtures use the final API names.

**Depends on:** PR 6.

### PR 8 — Runtime hardening and release gates

**Scope**

- Run and stabilize the full core, adapter, example, SSR, package-consumer,
  coverage, and type-check matrix.
- Add stress coverage for invalidation bursts, reentrant invalidation,
  subscribe-time races, rapid parameter churn, and repeated attach/dispose.
- Verify DevTools and tracing output for both state dependency changes and
  external cache invalidation.
- Confirm that dormant reads do not fetch, SSR does not subscribe, and TanStack
  `gcTime` remains the only remote-data retention policy.

**Deliberately excluded**

- New adapter features beyond the behavior approved in this RFC.

**Merge gate**

- Every acceptance test in this RFC passes in CI.
- There are no unexplained timers, listeners, observers, or retained query
  results after disposal.
- Release/package verification passes from a packed artifact, not only the
  monorepo source tree.

**Depends on:** PR 7.

### PR 9 — Documentation and RFC closure

**Scope**

- Rewrite the current TanStack architecture guide and package README around
  cache ownership, synchronous first reads, activation, and event coeffects.
- Update agent-facing server-state guidance where it is maintained by this
  project.
- Add upgrade guidance for both direct migration and the optional
  `regQueryProjection` compatibility window.
- Mark this RFC implemented and link the merged PRs and final public API.

**Deliberately excluded**

- Describing the old state-backed bridge as the recommended architecture.

**Merge gate**

- Documentation examples compile against the packed package.
- The architecture guide, API reference, README, and migration notes describe
  the same ownership and lifecycle semantics.

**Depends on:** PR 8.

## Final public API

The implementation links below are the source of truth for the shipped API:

- [`regQuerySub`](../../packages/tanstack-query/src/query-subscription.ts) —
  cache-owned external subscription registration.
- [`regQueryProjection`](../../packages/tanstack-query/src/query-subscription.ts) —
  explicit, deprecated state projection for an intentional ownership transfer.
- [`attachQueryClient`](../../packages/tanstack-query/src/lifecycle.ts) —
  runtime-scoped client mounting and attachment-owned cache coeffects.
- [`QueryCacheReader`](../../packages/tanstack-query/src/read.ts) — frozen,
  synchronous `getData()`/`getState()` event capability.
- [`regExternalSub`](../../packages/core/src/runtime/api.ts) — generic core
  primitive for other external sources.
- [`package exports`](../../packages/tanstack-query/src/index.ts) — ESM/CJS
  public export boundary.

The [architecture guide](../architecture/tanstack-query.md), [package
README](../../packages/tanstack-query/README.md), and [TodoMVC
example](../../examples/todomvc-query/README.md) use these same names and
ownership semantics.
