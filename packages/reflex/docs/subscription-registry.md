# Subscription bookkeeping

Paths in this document are relative to `src/`.

Framework bookkeeping is split by ownership. `RuntimeRegistry` in
`runtime/registry.ts` stores handler definitions, while `SubscriptionRuntime`
in `runtime/subscriptions/cache.ts` owns subscription definitions, graph
construction, the canonical cache, and its lifecycle metadata.
`runtime/subscriptions/keys.ts` owns canonical query-key serialization and its
development validation.
Event handlers and interceptor lists are one immutable definition in
`RuntimeRegistry`; `runtime/reset.ts` coordinates clears that span services.
Reactive semantics—stamps, epochs, publication waves, and dependency
evaluation—live in the `SubscriptionEngine` owned eagerly by
`SubscriptionRuntime`.

## Two layers: definitions and instances

The handler and subscription-cache modules separate two things that are easy to
conflate:

- **Definitions** — `id → handler function`. Written at registration
  (`regSub`, `regEvent`, …), read whenever an instance is built or an event is
  handled. Re-registering an event replaces its definition; a subscription can
  be replaced only while none of its queries is cached. Clears remove either a
  selected definition or the complete registry.
- **Instances** — `serialized query key → built subscription graph`. Created
  lazily on first read of a query vector, evicted when their last consumer
  leaves. One definition (`['todos-by-id']`) produces many instances
  (`['todos-by-id', 1]`, `['todos-by-id', 2]`, …).

The remaining state in the cache module supports the instance lifecycle: root
anchoring, cascade invalidation, and provisional cleanup.

Two architectural facts explain why the instance-side metadata exists at all:

1. **Subscription nodes are opaque.** The cache cannot ask a node for its
   dependencies, its kind, or whether it is a root. Any structural fact the
   cache needs, it must record itself at creation time.
2. **Computed instances are terminal.** They are evicted when unused rather
   than revived. Eviction of one instance must correctly invalidate every
   dormant cached parent that references it, so the cache tracks reverse
   edges the old revival machinery made unnecessary.

## Store summary

| Store                                        | Owner                 | Purpose                                           |
| -------------------------------------------- | --------------------- | ------------------------------------------------- |
| `handlers`                                   | `RuntimeRegistry`     | Public typed handler projections                  |
| `eventDefinitions`                           | `RuntimeRegistry`     | Atomic event handler + immutable interceptor list |
| `systemHandlers`                             | `HandlerRecord`       | Framework handlers restored after clears          |
| `rootSubIdBySource`                          | `SubscriptionRuntime` | Changed STATE key → owning root                   |
| `rootSubSourceById`                          | `SubscriptionRuntime` | Is this id a root; what key it reads              |
| `rootSubscriptionKeys`                       | `SubscriptionRuntime` | Persistence guard for root cells                  |
| `subscriptionCache`                          | `SubscriptionRuntime` | Canonical built instances                         |
| `dependentSubscriptionKeys`                  | `SubscriptionRuntime` | Reverse edges for cascade invalidation            |
| `provisionalCurrent` / `provisionalPrevious` | `SubscriptionRuntime` | Two-generation aborted-render sweep               |
| `subConfigById`                              | `SubscriptionRuntime` | Per-subscription equality options                 |

## Handler definitions — `HandlerRecord`

`RuntimeRegistry` exposes one typed `HandlerRecord` property per handler kind:
`event`, `fx`, `cofx`, `sub`, `subDeps`, and `error`. Internal callers operate
on these properties directly instead of passing handler-kind strings. Each
record stores ids in a null-prototype object, so valid string ids such as
`constructor` and `__proto__` cannot collide with `Object.prototype`. `regSub`
writes to both `registry.sub` and `registry.subDeps`. A root subscription
registers a `sub` handler that reads one top-level state key and a `subDeps`
handler returning `[]`.

This is the only registry devtools reads directly (`getHandlers`) to enumerate
what the app declares. Overwriting an existing id warns; it is allowed for
non-subscription kinds but rejected for subscriptions while cached instances of
that id exist (see clearing rules).

Framework-owned effects, coeffects, and the default event error handler are also
recorded in `systemHandlers`. They may be overridden through the normal
registration APIs, but clearing an override restores the framework
implementation. A full `clearHandlers()` does the same, so reset/test helpers
cannot silently remove `dispatch`, `dispatch-later`, `now`, `random`, or the
default error handler for the rest of the process lifetime.

## Root source registry — three stores

Root subscriptions are the STATE wake-up anchors, and the cache module tracks them
in three complementary structures because three different questions are asked
on three different hot paths.

- **`rootSubIdBySource` (`sourceKey → subId`)** answers the flush question:
  a top-level state key changed identity — which root subscription owns it? The
  STATE flush diff walks changed keys and looks the owner up here.
- **`rootSubSourceById` (`subId → sourceKey`)** is the reverse. Subscription
  construction asks "is this id a root?" to decide the node's kind and to
  reject parameters on roots. With opaque nodes this fact cannot come from the
  node, so it is read here.
- **`rootSubscriptionKeys` (`Set` of `getRootSubKey(subId)`)** is the
  persistence guard. Root cells are immune to eviction and to the provisional
  sweep — they stay registered while dormant so no publication is ever missed.
  The guard sits on the hottest paths (`evictCachedSubscription`,
  `markProvisionalSubscription`), so the serialized keys are precomputed into a
  `Set` for O(1) checks instead of restringifying on every call.

Keeping all three consistent is the job of `setRootSubSource` /
`clearRootSubSource`, which also unwind a previous binding when a source key or
sub id is reassigned.

## Subscription instance cache — two stores

### `subscriptionCache` — the canonical instances

`key → { node, subId, dependencyKeys }`, where `key` is the serialized query
vector. The node is the opaque runtime handle; `subId` and `dependencyKeys` are
the structural facts the cache records because the node will not surrender them
later.

`cacheSubscription` throws on a duplicate canonical key. Two live instances for
one key would split watchers and publications across them — an invariant
violation, not a recoverable condition, so it fails loudly.

- **`subId`** supports id-scoped operations without parsing JSON keys:
  `hasCachedSubscriptionForId` (used to reject `regSub` re-registration while
  instances exist) and `clearSubscriptionCacheEntriesForId` (a targeted
  `clearHandlers('sub', id)` must drop every parameterized instance of that id).
- **`dependencyKeys`** are the forward edges, walked by
  `renewProvisionalSubscriptionTree` to renew a whole dormant subtree on a
  cache hit.

### `dependentSubscriptionKeys` — reverse edges

`dependencyKey → Set<dependentKey>`, written alongside every `cacheSubscription`
call. This is the store that makes terminal eviction correct.

When a cached dependency is removed — by targeted clear, handler clear,
provisional sweep, or eviction — every cached **parent** that transitively
depends on it must go too. Otherwise a dormant parent would keep a reference to
a dead node: the next lookup of that dependency would build a fresh instance,
and the parent, on activation, would link to the stale one — a stuck graph that
misses publications or throws "disposed". `removeSubscriptionCacheClosure`
walks these reverse edges to delete the exact affected closure.

Two properties matter:

- Invalidation is proportional to the removed subgraph, not to the whole cache.
  Without the reverse index, finding dependents would scan every entry on every
  removal.
- These are **cache metadata, not the live DAG**. The runtime keeps its own
  `dependents` sets on active cells for publication. The reverse edges here
  additionally cover _dormant_ cached graphs, which the runtime's live edges do
  not track. The invariant they enforce: a canonical cache entry never retains
  a terminal dependency node.

`SubscriptionRuntime.evict` is used when a computed cell's last consumer
leaves. It is root-guarded (roots persist) and identity-checked
(`cache.get(key)?.node === subscription`) so a stale eviction request for an
already-replaced key is a no-op, then delegates to the same closure removal.

## Provisional subscriptions — two stores

Instances are created during render (`getSnapshot`), but a render may never
commit: concurrent rendering, StrictMode, Suspense, or an aborted transition.
Such an instance is never watched and never becomes a dependency, so the normal
unsubscribe path can never dispose it. The provisional maps catch these.

`provisionalCurrent` and `provisionalPrevious` implement a two-generation
grace period. A newly created computed instance is marked in `current`. A sweep
(scheduled independently of state updates, so an idle app still cleans up) promotes
`current → previous` and deletes anything still in `previous` that never went
live. Surviving one full cycle without activation is the eviction condition;
sweeping is always safe because a late subscriber simply rebuilds the instance.

These are `Map<key, node>`, not `Set<key>`, to solve an ABA problem introduced
by terminal lifecycles: a key can be evicted and **rebuilt** between mark and
sweep. Sweeping by key alone would kill the innocent new generation. Every
operation therefore checks node identity (`provisionalCurrent.get(key) ===
entry.node`) — "is the lease-holder still the same object?". Root keys are never
marked provisional; they are persistent by design.

`renewProvisionalSubscriptionTree` handles the cache-hit case: reaching a
cached instance renews the lease on its entire dormant dependency subtree
(walked via forward `dependencyKeys`), not just the entry point, so a shared
dependency in an older generation is not swept out from under a fresh parent.

## Event definitions and subscription config

The two domains keep their metadata with the definition it qualifies:

- **`eventDefinitions`** in `RuntimeRegistry` stores each event handler and its
  immutable interceptor list together. Re-registration and ownership-token
  release replace or remove the complete definition.
- **`subConfigById`** lives in `SubscriptionRuntime`. Its custom
  `equalityCheck` is read once when an instance is built and baked into the
  node's spec.

## Clearing and lifecycle rules

Clearing spans several stores. `runtime/reset.ts` coordinates public handler
clears; `runtime/subscriptions/cache.ts` owns subscription-specific clearing:

- **`SubscriptionRuntime.assertClearAllowed`** rejects any
  subscription-affecting clear while a graph is active. Mounted stores must not
  be orphaned. It guards `clearHandlers` (for `sub`/`subDeps`) and
  `clearSubscriptionCache`.
- **`clearHandlers('sub', id)`** removes the definition _and_ cascades into the
  instance cache by subscription id, because leaving
  instances of a removed handler would strand them. The paired `subDeps`
  handler, root-source metadata, and subscription config are cleared in the
  same operation.
- **`clearHandlers('event', id)`** removes both the handler and its interceptor
  metadata, so a later registration cannot inherit a stale chain.
- **`clearHandlers('error', 'event-handler')`** removes a user override and
  restores the framework default error handler.
- **`clearSubs`** clears the instance cache, both handler kinds, and configs —
  the full public reset, subject to the active-graph guard.
- **`clearSubsForHotReload`** is the internal HMR path. It bypasses the guard
  and clears eagerly because HMR immediately remounts the owning React tree by
  key; the guard would otherwise refuse while that tree is still mounted.

## Why cache policy lives outside the engine

The split is deliberate. `SubscriptionEngine` owns graph semantics—stamps,
epochs, waves, and evaluation—and knows nothing about serialized keys, root
persistence, provisional leases, or handler ids. `SubscriptionRuntime` owns
definition coordination and cache policy around that engine; key serialization
remains in `runtime/subscriptions/keys.ts`. The structural facts an opaque node
does not expose are recorded once when the service caches it.
