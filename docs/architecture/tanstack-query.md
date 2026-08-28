# TanStack Query integration

`@ukladjs/tanstack-query` is Uklad's headless integration for TanStack Query
v5. The cache-owned `regQuerySub` API is the normal path for server data:
TanStack Query owns the cache and Uklad exposes a mapped, read-only result
through the ordinary subscription graph.

The adapter uses `@tanstack/query-core`, not `@tanstack/react-query`. It does
not install `QueryClientProvider`, provide a React context, or add a query hook
to views. Views use the application's existing Uklad provider and
`useSubscription`.

For package installation and the complete migration example, see the
[package guide](../../packages/tanstack-query/README.md). The generic lifecycle
primitive is documented in [the subscription runtime guide](subscription-runtime.md).

## Ownership boundary

Keep one Uklad runtime and one TanStack `QueryClient` per execution owner. The
two systems have different responsibilities:

| Concern                                                                     | Owner                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------- |
| Request deduplication, retries, invalidation, hydration, and cache lifetime | TanStack Query                                     |
| Query observers and fetch policy                                            | TanStack Query, configured by the platform adapter |
| Local/UI state, events, effects, and reactive graph                         | Uklad                                              |
| Domain-level query read model                                               | `regQuerySub` mapped result                        |

`regQuerySub` never writes its mapped result into Uklad state. The mutable
TanStack observer result stays inside the adapter, and query cache changes do
not create application-state revisions.

```text
Uklad state dependencies ──► external query subscription ──► QueryObserver
       (declared vectors)                 │                    │
                                          │ invalidate          │ cache/fetch
                                          ▼                    ▼
                               mapped QuerySnapshot ◄──── TanStack cache
                                          │
                                          ▼
                               ordinary subscriptions ──► views
```

Use a normal Uklad state root for local input such as a selected ID, filter,
or region. Do not add a result root, loading sentinel, aggregate result map,
or query revision counter merely to mirror TanStack data.

## Composition and placement

Install the adapter and its required peer, create the client in the platform
composition layer, and attach it to the runtime:

```sh
pnpm add @ukladjs/tanstack-query@0.2.0 @tanstack/query-core@^5.0.0
```

```ts
import { createUkladRuntime } from '@ukladjs/core/vanilla';
import { QueryClient, attachQueryClient } from '@ukladjs/tanstack-query';

const runtime = createUkladRuntime({ initialState: { selectedTodoId: 42 } });
const queryClient = new QueryClient();

// Mounts QueryClient with the runtime module lifecycle. It does not install
// React Query context.
const detachQueryClient = attachQueryClient(runtime, queryClient);
```

Attach one client to one runtime. The attachment mounts the client when its
module is registered and unmounts it when the attachment/runtime is disposed.
Query subscriptions and cache coeffects must be registered against an attached
client; this catches accidental duplicate or unowned clients early.

Keep query keys, query functions, observer options, and result mapping in
`src/platform/<target>/queries.ts` (or the equivalent platform adapter). Keep
feature state, events, derived subscriptions, and views feature-local. Keep
mutations and commands in effects.

## Registering a cache-owned query subscription

The registration has five pieces:

1. the subscription ID;
2. a function returning its declared dependency vectors;
3. a function building `QueryObserverOptions` from dependency values and query
   parameters;
4. a synchronous mapper from the read-only `QuerySnapshot`; and
5. an optional equality/observation configuration.

```ts
import { regQuerySub } from '@ukladjs/tanstack-query';

runtime.registerModule((registrar) => {
  registrar.regRootSub('ui/selected-todo-id', 'selectedTodoId');

  regQuerySub(
    registrar,
    queryClient,
    'todos/selected',
    () => [['ui/selected-todo-id']],
    ([id]) => ({
      queryKey: ['todos', id],
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
});
```

The mapper is pure and synchronous. It receives a frozen `QuerySnapshot`, not
the mutable `QueryObserverResult` or an imperative observer. Its return value
is the result of `['todos/selected']` and can be consumed by ordinary
`regSub`, `useSubscription`, DevTools, and headless tests.

### Dependencies and parameters

The vectors returned by `signals` are real Uklad graph dependencies. When a
dependency changes for an active consumer, the external node is re-read in that
same publication wave and its observer receives the resulting options through
`QueryObserver.setOptions()`. The dependency function does not run a fetch or
read a client directly.

Parameters are compact scalar coordinates for a subscription vector. Each
parameterized vector has an independent external node and observer:

```ts
regQuerySub(
  registrar,
  queryClient,
  'todos/by-id',
  () => [],
  (_signals, id) => ({
    queryKey: ['todos', id],
    queryFn: () => api.getTodo(id),
  }),
  (query) => query.data,
);

registrar.regSub(
  'todos/title',
  (id) => [['todos/by-id', id]],
  ([todo]) => (todo === undefined ? undefined : todo.title),
);
```

Releasing `['todos/by-id', 1]` does not dispose the observer for ID 2 and does
not leave a second Uklad result map retaining ID 1. TanStack's `gcTime` remains
the authority for whether the cache entry itself is retained.

## First read, activation, and disposal

The external driver has separate read and activation phases:

```text
render/read       → QueryObserver.getOptimisticResult() (synchronous)
first commit     → observer.subscribe() (may start an enabled fetch)
cache callback   → external invalidation → graph publication
final unsubscribe→ observer destroy() → external node eviction
```

A dormant read constructs only the source needed to obtain the current
optimistic snapshot. It does not subscribe or fetch. Therefore a hydrated
cache value is visible in the first render. An uncached query returns the
mapper's loading result until the first committed consumer activates the
observer and TanStack Query fetches it.

This is also the SSR rule: hydrate QueryClient before rendering, read through
Uklad, and do not subscribe or fetch during the server render. In React, the
Uklad hook subscribes after commit, so an aborted render does not leak an
observer.

Observer callbacks only call the opaque external invalidation capability. Uklad
then re-reads the current optimistic snapshot, runs the mapper, compares the
mapped value, and publishes through normal dependents. Equal mapped values stop
downstream work.

## Observation and equality

`regQuerySub` observes `data` and `error` by default. This is intentionally
narrow: TanStack structural sharing can preserve a data reference across an
unchanged JSON refetch, and intermediate `stale`/`fetching` transitions do not
need to invalidate a domain result that does not expose them.

If the mapper returns lifecycle fields, list exactly the fields it exposes:

```ts
regQuerySub(
  registrar,
  queryClient,
  'todos/selected-status',
  () => [],
  () => ({ queryKey: ['todos', 42], queryFn: () => api.getTodo(42) }),
  (query) => ({ data: query.data, refreshing: query.isFetching }),
  { observe: ['data', 'error', 'isFetching'] },
);
```

`observe: 'all'` is available for a mapper that deliberately exposes the full
query lifecycle. `QuerySubscriptionConfig` also inherits the subscription
`equalityCheck`; use it when the mapped domain value needs a policy different
from the runtime default.

The snapshot fields are read-only `data`, `error`, `status`, `fetchStatus`,
timestamps, failure metadata, and the standard TanStack boolean lifecycle
fields (`isPending`, `isFetching`, `isStale`, `isSuccess`, and so on). Commands
such as `refetch`, invalidation, and mutation are not part of the snapshot.

## Event-time cache reads (coeffects)

Events sometimes need a synchronous cache hint or a cached domain value. Do
not close over `QueryClient` in an application event and do not register one
global coeffect for every query. Configure the narrow read capability as part
of the QueryClient attachment:

```ts
interface AppContracts extends UkladContracts {
  readonly coeffects: {
    readonly 'todos/cached-list': {
      readonly arg: void;
      readonly value: readonly Todo[] | undefined;
    };
  };
}

attachQueryClient(runtime, queryClient, {
  cacheCoeffects: [
    {
      id: 'todos/cached-list',
      read: (cache) => cache.getData<readonly Todo[]>(['todos', 'list']),
    },
  ],
});

runtime.registerModule((registrar) => {
  registrar.regEvent(
    'todos/use-cached',
    ({ coeffects: { cachedTodos } }) => {
      // Synchronous hit or undefined on a miss; no fetch or mutation.
      void cachedTodos;
    },
    { coeffects: { cachedTodos: 'todos/cached-list' } },
  );
});
```

`QueryCacheReader` is frozen and exposes only synchronous `getData()` and
`getState()` methods. A reader may accept the declared coeffect argument and a
read-only event context; it cannot fetch, mutate, invalidate, remove queries,
or access the client. `readQueryData()` and `readQueryState()` remain exported
for platform code and tests, but attachment-managed coeffects are the event
boundary.

Coeffect IDs are still declared in `AppContracts`, and each event binds the
IDs it needs explicitly. A cache miss injects `undefined`; a reader exception
uses normal coeffect error semantics and aborts the event before its state
transition commits. Disposing the attachment removes its coeffect providers.

## Mutations and invalidation

An event expresses intent and returns an effect. The platform effect executes a
TanStack `MutationObserver` (or another command) and invalidates the relevant
query key after success:

```text
view → Uklad event → effect → mutation → invalidate query key
                                      ↓
                           active regQuerySub observer
                                      ↓
                           mapped subscription update
```

The mutation client is therefore not part of event or subscription code. A
successful invalidation may refetch an active observer; only the mapped result
that the subscription observes can notify its dependents.

## The three supported playground patterns

The DevTools playground demonstrates the supported shapes without mirrored
remote-data state:

| Pattern        | Registration                                      | Lifecycle guarantee                                                                                              |
| -------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Polling clock  | Parameterless `regQuerySub`, with polling options | Polling starts with the card's first consumer and stops after its final consumer leaves                          |
| Item by ID     | Parameterized `regQuerySub`                       | IDs own independent observers and cache vectors; releasing one does not release another                          |
| Region summary | `regQuerySub` with a selected-region dependency   | A state selection change switches options/key in the same graph publication; cached destinations are synchronous |

See the [playground README](../../examples/devtools-playground/README.md) and
its [server-query adapter](../../examples/devtools-playground/src/platform/web/server-queries.ts)
for a complete composition.

## Explicit state projections (compatibility window)

Some workflows intentionally materialize a remote value in Uklad state—for
example, an editable draft, a snapshot for offline editing, or a deliberate
handoff from server data to a local reducer. Use the separately named
`regQueryProjection` API for that ownership transfer:

```ts
import { regQueryProjection } from '@ukladjs/tanstack-query';

registrar.regRootSub('todos/selected-projection', 'selectedTodo');
regQueryProjection(
  registrar,
  queryClient,
  'todos/selected-projection',
  { stateKey: 'selectedTodo', update: (_current, value) => value },
  () => [],
  () => ({ queryKey: ['todos', 42], queryFn: () => api.getTodo(42) }),
  (query) => query.data,
);
```

`regQueryProjection` keeps the old `regSubExt` state-update lifecycle and must
name an ordinary root subscription plus its state updater. It is a compatibility
and ownership-transfer API, not an alias or overload of `regQuerySub`; it is
deprecated for ordinary server-state reads. Do not use it merely to make a
cached value available on first render.

### Direct migration

Remove the query result root, state key, initial loading value, update event,
and aggregate parameterized result map. Change the old target-bearing call:

```ts
// Before: state-backed bridge.
regQuerySub(
  registrar,
  queryClient,
  'todos/selected',
  { stateKey: 'selectedTodo', update: (_current, value) => value },
  () => [],
  () => ({ queryKey: ['todos', 42], queryFn: () => api.getTodo(42) }),
  (query) => query.data,
);
```

to the cache-owned call:

```ts
// After: TanStack cache is the sole remote-data owner.
regQuerySub(
  registrar,
  queryClient,
  'todos/selected',
  () => [],
  () => ({ queryKey: ['todos', 42], queryFn: () => api.getTodo(42) }),
  (query) => query.data,
);
```

If the state projection is intentional, keep the root and use the explicit
`regQueryProjection` name instead. This makes the ownership decision visible in
code review and prevents an overloaded API from silently choosing a retention
model.

## Diagnostics, testing, and release checks

DevTools identifies a cache-owned query as an `external` subscription node. A
query result should not appear as an application-state root, a private bridge
event, or an aggregate result map. Diagnostics are read-only and do not
activate a dormant observer.

Focused tests should cover:

- hydrated first reads and SSR reads without fetch/subscription;
- activation after the first consumer and disposal after the final consumer;
- uncached loading followed by mapped success/error;
- dependency-driven key changes and same-key option changes (`enabled`,
  `queryFn`, `select`, `staleTime`, and observed lifecycle fields);
- independent parameter vectors, cache retention, and rapid churn;
- structural sharing/equality suppression and mapper errors;
- attachment coeffect hit/miss, arguments, frozen readers, disposal, and
  normal coeffect failure semantics; and
- ESM, CJS, declaration, and packed-package consumer checks.

The repository's [TodoMVC example](../../examples/todomvc-query/README.md)
contains the end-to-end list query and event coeffect, while the
[TanStack Query package guide](../../packages/tanstack-query/README.md) is the
API-facing reference.

## API summary

| API                                                                             | Use                                                                                |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `attachQueryClient(runtime, queryClient, options?)`                             | Mount one headless client and optionally register attachment-owned cache coeffects |
| `regQuerySub(registrar, queryClient, id, signals, options, mapResult, config?)` | Default cache-owned external subscription                                          |
| `regQueryProjection(...)`                                                       | Explicit, deprecated state projection for an intentional ownership transfer        |
| `QuerySnapshot`                                                                 | Frozen read-only mapper input                                                      |
| `QueryCacheReader`                                                              | Frozen event coeffect capability with `getData`/`getState`                         |
| `readQueryData` / `readQueryState`                                              | Direct synchronous cache helpers for platform code/tests                           |

The lower-level `regExternalSub` primitive lives in `@ukladjs/core`; use it
when integrating another external source with the same read/activate/sync/
dispose lifecycle. Do not build a second Uklad state store around TanStack
Query.
