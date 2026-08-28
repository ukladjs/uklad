# `@ukladjs/tanstack-query`

Headless TanStack Query v5 integration for Uklad. TanStack Query owns server
cache, retries, invalidation, and garbage collection. Uklad owns local/UI state
and exposes a mapped remote read model through ordinary subscriptions.

This package uses `@tanstack/query-core`, not `@tanstack/react-query`. It does
not install `QueryClientProvider`, provide React context, or add a query hook.
Views use the application's existing Uklad provider and `useSubscription`.

`@tanstack/query-core` is a required peer dependency. Install it in the
application so the adapter, application, and any TanStack framework adapter
share one compatible Query Core instance. The adapter currently supports Query
Core v5 (`^5.0.0`).

For the ownership model and application-placement rules, see the central
[TanStack Query integration guide](../../docs/architecture/tanstack-query.md).

## Install

```sh
pnpm add @ukladjs/tanstack-query@0.2.0 @tanstack/query-core@^5.0.0
```

The package also requires `@ukladjs/core@^0.2.4` as a peer dependency.

## Quick start

Create one `QueryClient`, attach it to one Uklad runtime, and register a
cache-owned query subscription from the platform adapter:

```ts
import { createUkladRuntime } from '@ukladjs/core/vanilla';
import { UkladProvider, useSubscription } from '@ukladjs/core/react';
import { QueryClient, attachQueryClient, regQuerySub } from '@ukladjs/tanstack-query';

const queryClient = new QueryClient();
const runtime = createUkladRuntime({
  initialState: { selectedTodoId: 42 },
});

// Mounts the headless client with the runtime lifecycle. It does not install
// React Query context.
const detachQueryClient = attachQueryClient(runtime, queryClient);

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

function Todo() {
  const todo = useSubscription(['todos/selected']);
  if (todo.kind === 'loading') return 'Loading…';
  if (todo.kind === 'error') return `Could not load: ${todo.message}`;
  return todo.todo.title;
}

function Root() {
  return (
    <UkladProvider runtime={runtime}>
      <Todo />
    </UkladProvider>
  );
}
```

`todos/selected` has no backing state root. TanStack owns the query cache and
`regQuerySub` exposes the mapped result directly. A hydrated cache entry is
available synchronously during the first render; an uncached query reads as the
mapper's loading value until its observer fetch completes.

Dispose `detachQueryClient` (or the runtime) when the execution owner shuts
down. The attachment mounts/unmounts the client and rejects accidental reuse of
one client across runtimes.

## Lifecycle and ownership

Each subscription vector owns one external source and, once active, one
`QueryObserver`:

```text
render/read       → getOptimisticResult() (synchronous)
first commit     → observer.subscribe() and possible fetch
observer callback→ external invalidation → Uklad graph publication
final consumer   → observer destroy() → external node eviction
```

The dormant read does not subscribe or fetch. The first committed consumer
activates the observer; the final consumer releases it. TanStack's `gcTime`, not
Uklad state, controls cache retention. A query callback only invalidates the
external source; it never writes application state or exposes a mutable client
to a mapper.

Declared query signals are real Uklad dependencies. For an active consumer, a
state change re-reads the query in the same publication wave and calls
`QueryObserver.setOptions()` for the active vector. Parameters are scalar
subscription coordinates, so parameterized vectors are isolated and can be
released independently.

## Mapping and observation

The `mapResult` callback receives a frozen, read-only `QuerySnapshot`. It
contains data, error, status, fetch status, timestamps, failure metadata, and
the standard TanStack lifecycle booleans. It does not contain `refetch`, fetch,
mutation, invalidation, or any other imperative operation.

`regQuerySub` observes only `data` and `error` by default. This keeps a
background stale/fetch transition from invalidating a mapper that does not
expose that lifecycle. TanStack structural sharing and the subscription
equality policy suppress unchanged mapped values.

Opt into lifecycle fields that the mapper intentionally returns:

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

Use `{ observe: 'all' }` only when the mapped result deliberately exposes the
full lifecycle. The optional `config` also accepts the normal subscription
`equalityCheck`.

## Event-time cache reads

When an event needs a synchronous cached value, configure a narrow coeffect on
the QueryClient attachment. Do not close over `QueryClient` in event code:

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
      // A synchronous cache hit, or undefined on a miss.
      void cachedTodos;
    },
    { coeffects: { cachedTodos: 'todos/cached-list' } },
  );
});
```

`attachQueryClient` registers each configured ID through the normal Uklad
coeffect registry and removes it with the attachment. `QueryCacheReader` is a
frozen capability with only synchronous `getData()` and `getState()` methods;
it cannot fetch, mutate, invalidate, remove queries, or access the client.
Coeffect readers may also use their declared argument and read-only event
context. A cache miss injects `undefined`, while a thrown reader follows normal
coeffect error semantics and aborts the event before state commit.

`readQueryData()` and `readQueryState()` remain available for platform code and
tests. Application events should use attachment-managed cache coeffects so the
event boundary stays explicit and deterministic.

## Mutations

Keep commands and mutations in Uklad effects. An event returns intent, the
platform effect invokes a TanStack `MutationObserver`, and successful completion
invalidates the relevant query key. Active `regQuerySub` observers then publish
the next mapped value through the ordinary graph.

```text
event → effect → mutation → invalidate query key → active query subscription
```

## Parameterized queries

Use scalar parameters as cache coordinates; do not maintain a Uklad result map:

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

The vectors `['todos/by-id', 1]` and `['todos/by-id', 2]` own independent
observers. Releasing one does not dispose the other or leave a mirrored Uklad
entry that prevents TanStack garbage collection.

## Migration from the old state-backed call

The cache-owned implementation is now the public `regQuerySub`. Remove the
query result root, state key, initial loading value, update event, and aggregate
parameterized result map. The old target-bearing call:

```ts
// Before: every mapped result was retained in Uklad state as well.
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

becomes:

```ts
// After: TanStack Query is the sole remote-data owner.
regQuerySub(
  registrar,
  queryClient,
  'todos/selected',
  () => [],
  () => ({ queryKey: ['todos', 42], queryFn: () => api.getTodo(42) }),
  (query) => query.data,
);
```

If a workflow intentionally needs a durable or editable state projection, use
the separately named compatibility API:

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

`regQueryProjection` deliberately transfers ownership into an explicit Uklad
state root and retains the old `regSubExt` update lifecycle. It is deprecated
for ordinary server-state reads and is not an alias or overload of
`regQuerySub`. Keep it only for the compatibility window or a documented
ownership transfer.

## API

- `attachQueryClient(runtime, queryClient, options?)` mounts one headless client
  and optionally registers attachment-owned cache coeffects.
- `regQuerySub(registrar, queryClient, id, signals, options, mapResult, config?)`
  registers the default cache-owned external subscription.
- `regQueryProjection(...)` registers an explicit, deprecated state projection.
- `QuerySnapshot` is the frozen mapper input.
- `QueryCacheReader` is the frozen coeffect capability with `getData()` and
  `getState()`.
- `readQueryData()` and `readQueryState()` are synchronous cache helpers for
  platform code and tests.

The lower-level `regExternalSub` primitive is exported by
`@ukladjs/core/vanilla` for other external sources. See the [architecture
guide](../../docs/architecture/tanstack-query.md) for SSR, diagnostics,
testing, and the three supported playground patterns.
