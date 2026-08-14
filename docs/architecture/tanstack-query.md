# TanStack Query integration

`@ukladjs/tanstack-query` is the supported server-state pairing for the
experimental Uklad runtime. It uses `@tanstack/query-core` only: applications
do not install `QueryClientProvider` and views do not call `useQuery`.

## Ownership boundary

TanStack Query owns request deduplication, retries, invalidation, cache
lifetimes, and garbage collection. Uklad owns local/UI state and exposes the
feature's domain-level remote read model through ordinary root and derived
subscriptions.

```text
passive Uklad signals → query-subscription extension → QueryObserver
                                                     ↓
Uklad event ← mapped read-only snapshot ← observer result
     ↓
backing state root → ordinary Uklad subscriptions → views
```

The observer never writes to a subscription graph directly. Its mapped value is
applied to the latest explicitly named state root through a runtime-private
event, then reaches views through ordinary STATE publication. The full mutable
TanStack observer result never enters Uklad state; mappers receive a frozen,
read-only `QuerySnapshot` and return only the domain value that belongs there.

## Installation

Install both the Uklad adapter and its required Query Core peer dependency:

```sh
pnpm add @ukladjs/tanstack-query@0.1.0 @tanstack/query-core@^5.0.0
```

The application owns the Query Core version. The current adapter supports v5;
its declared peer range is `^5.0.0`.

At runtime composition, create a `QueryClient` and call
`attachQueryClient(runtime, queryClient)`. This mounts the headless client and
releases it with the Uklad module lifecycle. Attach one client to one runtime.

After the feature has registered its root and derived subscriptions, a platform
adapter calls `regQuerySub`. It specifies:

- the already-registered lifecycle subscription;
- an explicit backing `stateKey` and updater;
- passive signal subscriptions, if query options depend on application state;
- a function that creates `QueryObserver` options; and
- a mapper from `QuerySnapshot` to the subscription's declared result.

The lifecycle subscription may be a root or a parameterized derived
subscription. For a parameterized subscription, each vector owns its own
observer. Its updater receives the latest backing-root value and the vector's
parameters, so multiple observers can safely merge results into one keyed root.

The first live consumer starts the observer. The final consumer disposes it.
Signal changes are sampled after STATE publication and switch the observer only
when the signal tuple changes; sampled signal subscriptions are not graph
dependencies and are never kept active by the extension.

## Update policy

`regQuerySub` observes `data` and `error` by default. With TanStack Query's
structural sharing, an unchanged background refetch therefore creates no Uklad
event or state update. If a feature intentionally exposes status such as
`isFetching`, include that field in `{ observe: [...] }`. Use `observe: 'all'`
only when the mapper deliberately exposes the full query lifecycle.

Keep mutations and commands in Uklad effects. A successful mutation invalidates
the relevant TanStack query keys; active observers then deliver the next mapped
read result through the same boundary. For the rare synchronous cache read in
an event, register a narrow coeffect around `readQueryData` instead of passing
the `QueryClient` into event handlers.

## References

- [`@ukladjs/tanstack-query` package guide](../../packages/tanstack-query/README.md)
- [`TodoMVC with TanStack Query`](../../examples/todomvc-query/README.md)
- [`Subscription runtime`](subscription-runtime.md) — generic `regSubExt`
  lifecycle semantics
