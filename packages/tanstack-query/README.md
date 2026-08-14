# `@ukladjs/tanstack-query`

Headless TanStack Query integration for Uklad. TanStack Query owns server
cache, retries, invalidation, and garbage collection. Uklad owns local/UI state
and exposes the feature's clean remote read model through ordinary root and
derived subscriptions.

This package uses `@tanstack/query-core`, not `@tanstack/react-query`. There is
no `QueryClientProvider` and no `useQuery` in a view.

`@tanstack/query-core` is a required peer dependency. Install it in the
application so the adapter, the application, and any TanStack framework adapter
all use one compatible Query Core instance. `@ukladjs/tanstack-query` currently
supports Query Core v5 (`^5.0.0`); a new major requires an adapter release that
explicitly declares and verifies support for it.

For the architecture, ownership boundary, and application-placement rules, see
the central [TanStack Query integration guide](../../docs/architecture/tanstack-query.md).

## Setup

```sh
pnpm add @ukladjs/tanstack-query@0.1.0 @tanstack/query-core@^5.0.0
```

The package requires `@ukladjs/core@^0.2.0` as a peer dependency.

```ts
import { createUkladRuntime } from '@ukladjs/core/vanilla';
import { UkladProvider, useSubscription } from '@ukladjs/core/react';
import { QueryClient, attachQueryClient, regQuerySub } from '@ukladjs/tanstack-query';

const queryClient = new QueryClient();
const runtime = createUkladRuntime({
  initialState: {
    selectedTodoId: 42,
    selectedTodo: { kind: 'loading' as const },
  },
});

// Replaces QueryClientProvider's mount/unmount responsibility. It does not
// install React context.
attachQueryClient(runtime, queryClient);

runtime.registerModule((registrar) => {
  registrar.regRootSub('ui/selected-todo-id', 'selectedTodoId');
  registrar.regRootSub('todos/selected', 'selectedTodo');

  regQuerySub(
    registrar,
    queryClient,
    'todos/selected',
    {
      stateKey: 'selectedTodo',
      update: (_current, value) => value,
    },
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

`todos/selected` is both the lifecycle subscription and the explicit storage
root in this example. `regQuerySub` attaches a generic `regSubExt` lifecycle
driver; it does not turn the subscription into a special Query type. The
initial root value belongs in `initialState`, usually a domain-level `loading`
or `idle` value.

After the first consumer commits, the driver passively reads its declared
**signals** and starts one `QueryObserver`. When `selectedTodoId` changes, it
switch-maps from the old observer to the new query key. Sampling a signal does
not add a dependency edge or keep its Uklad subscription active. The final
consumer destroys the observer; TanStack's `gcTime` remains the authority for
cache retention.

```text
signal state → Query extension → QueryObserver → internal event → state.selectedTodo → root subscription
```

The observer never publishes directly into the Uklad graph. The extension maps
TanStack's read-only result, then applies the target's `update` function to the
latest value of `stateKey` through a protected runtime event. Normal Uklad STATE
publication updates the ordinary root and every derived subscription that
depends on it.

The lifecycle subscription and storage root may differ. This is what makes one
`regQuerySub` work for parameterized derived subscriptions as well:

```ts
registrar.regRootSub('todos/by-id-state', 'todoById');
registrar.regSub(
  'todos/by-id',
  () => [['todos/by-id-state']],
  ([todoById], id) => todoById[id],
);

regQuerySub(
  registrar,
  queryClient,
  'todos/by-id',
  {
    stateKey: 'todoById',
    update: (todoById, value, id) => ({ ...todoById, [id]: value }),
  },
  () => [],
  (_signals, id) => ({
    queryKey: ['todos', id],
    queryFn: () => api.getTodo(id),
  }),
  (query) => query.data,
);
```

Each `['todos/by-id', id]` instance owns its own QueryObserver lifecycle. Its
mapped result is merged into the shared root using the latest root value, so
concurrent parameter instances cannot overwrite each other.

`QuerySnapshot` is deliberately read-only. It is the mapper's input and
exposes data, error, status, and fetch metadata, but not imperative observer
methods such as `refetch`. Only the mapper's return value is written to Uklad
state.

By default, `regQuerySub` observes only `data` and `error`. TanStack's default
structural sharing retains the previous `data` reference for a structurally
equal JSON response, so an unchanged background refetch produces no Uklad
event or state update. A mapper that exposes lifecycle information must opt in
to the fields it needs:

```ts
regQuerySub(
  registrar,
  queryClient,
  'todos/selected',
  { stateKey: 'selectedTodo', update: (_current, value) => value },
  () => [],
  () => ({ queryKey: ['todos', 42], queryFn: () => api.getTodo(42) }),
  (query) => ({ todo: query.data, refreshing: query.isFetching }),
  { observe: ['data', 'error', 'isFetching'] },
);
```

Use `{ observe: 'all' }` only when the mapper intentionally exposes the full
lifecycle. Put commands and mutations in effects, then call
`queryClient.invalidateQueries()` there. For a narrow synchronous cache read in
an event, register a coeffect around `readQueryData(queryClient, key)` rather
than passing the QueryClient into event handlers.

Every Query integration uses `regQuerySub`: it follows Uklad state and every
observer update crosses the common event → state → subscription boundary.
