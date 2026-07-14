# Subscription registry (registrar)

`registrar.ts` is the framework's bookkeeping layer. It holds every handler
definition, the canonical cache of built subscription graphs, and the metadata
that governs their lifecycle. It owns no reactive semantics: stamps, epochs,
publication waves, and dependency evaluation live in the runtime. The registrar
only answers "what is registered" and "which instances currently exist".

## Two layers: definitions and instances

The registrar separates two things that are easy to conflate:

- **Definitions** — `id → handler function`. Written once at registration
  (`regSub`, `regEvent`, …), read whenever an instance is built or an event is
  handled. Static for the lifetime of the app unless explicitly cleared.
- **Instances** — `serialized query key → built subscription graph`. Created
  lazily on first read of a query vector, evicted when their last consumer
  leaves. One definition (`['todos-by-id']`) produces many instances
  (`['todos-by-id', 1]`, `['todos-by-id', 2]`, …).

Everything else in the file is metadata supporting the instance lifecycle:
root anchoring, cascade invalidation, and provisional cleanup.

Two architectural facts explain why the instance-side metadata exists at all:

1. **Subscription nodes are opaque.** The registry cannot ask a node for its
   dependencies, its kind, or whether it is a root. Any structural fact the
   registrar needs, it must record itself at creation time.
2. **Computed instances are terminal.** They are evicted when unused rather
   than revived. Eviction of one instance must correctly invalidate every
   dormant cached parent that references it, so the registrar tracks reverse
   edges the old revival machinery made unnecessary.

## Store summary

| Store | Shape | Purpose |
| --- | --- | --- |
| `kindToIdToHandler` | `Kind → id → handler` | All handler definitions |
| `rootSubIdBySource` | `sourceKey → subId` | DB wake-up: changed db key → owning root |
| `rootSubSourceById` | `subId → sourceKey` | Is this id a root; what key it reads |
| `rootSubscriptionKeys` | `Set<serializedKey>` | Persistence guard for root cells |
| `subscriptionCache` | `key → {node, subId, dependencyKeys}` | Canonical built instances |
| `dependentSubscriptionKeys` | `key → Set<dependentKey>` | Reverse edges for cascade invalidation |
| `provisionalCurrent` / `provisionalPrevious` | `key → node` | Two-generation sweep of aborted renders |
| `interceptorsRegistry` | `eventId → Interceptor[]` | Per-event interceptor chains |
| `subConfigRegistry` | `subId → SubConfig` | Per-subscription options (equality check) |

## Handler definitions — `kindToIdToHandler`

One nested record keyed by `Kind` (`event`, `fx`, `cofx`, `sub`, `subDeps`,
`error`) then by id. `regSub` writes two entries for a computed subscription:
the compute function under `sub` and the dependency function under `subDeps`.
A root subscription registers a `sub` handler that reads one top-level db key
and a `subDeps` handler returning `[]`.

This is the only registry devtools reads directly (`getHandlers`) to enumerate
what the app declares. Overwriting an existing id warns; it is allowed for
non-subscription kinds but rejected for subscriptions while cached instances of
that id exist (see clearing rules).

## Root source registry — three stores

Root subscriptions are the DB wake-up anchors, and the registrar tracks them in
three complementary structures because three different questions are asked on
three different hot paths.

- **`rootSubIdBySource` (`sourceKey → subId`)** answers the flush question:
  a top-level db key changed identity — which root subscription owns it? The
  DB flush diff walks changed keys and looks the owner up here.
- **`rootSubSourceById` (`subId → sourceKey`)** is the reverse. Subscription
  construction asks "is this id a root?" to decide the node's kind and to
  reject parameters on roots. With opaque nodes this fact cannot come from the
  node, so it is read here.
- **`rootSubscriptionKeys` (`Set` of `JSON.stringify([subId])`)** is the
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
the structural facts the registrar records because the node will not surrender
them later.

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
- These are **registry metadata, not the live DAG**. The runtime keeps its own
  `dependents` sets on active cells for publication. The reverse edges here
  additionally cover *dormant* cached graphs, which the runtime's live edges do
  not track. The invariant they enforce: a canonical cache entry never retains
  a terminal dependency node.

`evictCachedSubscription` is the single-instance entry point used when a
computed cell's last consumer leaves. It is root-guarded (roots persist) and
identity-checked (`cache.get(key)?.node === subscription`) so a stale eviction
request for an already-replaced key is a no-op, then delegates to the same
closure removal.

## Provisional subscriptions — two stores

Instances are created during render (`getSnapshot`), but a render may never
commit: concurrent rendering, StrictMode, Suspense, or an aborted transition.
Such an instance is never watched and never becomes a dependency, so the normal
unsubscribe path can never dispose it. The provisional registers catch these.

`provisionalCurrent` and `provisionalPrevious` implement a two-generation
grace period. A newly created computed instance is marked in `current`. A sweep
(scheduled independently of db updates, so an idle app still cleans up) promotes
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

## Interceptors and subscription config

Two small independent maps, unrelated to the subscription graph:

- **`interceptorsRegistry` (`eventId → Interceptor[]`)** — the interceptor
  chain applied around an event handler.
- **`subConfigRegistry` (`subId → SubConfig`)** — per-subscription options,
  currently a custom `equalityCheck`. Read once when an instance is built and
  baked into the node's spec.

## Clearing and lifecycle rules

Clearing spans several stores, so the operations are centralized:

- **`assertSubscriptionsCanBeCleared`** (from the runtime) rejects any
  subscription-affecting clear while a graph is active. Mounted stores must not
  be orphaned. It guards `clearHandlers` (for `sub`/`subDeps`) and
  `clearSubscriptionCache`.
- **`clearHandlers('sub', id)`** removes the definition *and* cascades into the
  instance cache via `clearSubscriptionCacheEntriesForId`, because leaving
  instances of a removed handler would strand them.
- **`clearSubs`** clears the instance cache, both handler kinds, and configs —
  the full public reset, subject to the active-graph guard.
- **`clearSubsForHotReload`** is the internal HMR path. It bypasses the guard
  and clears eagerly because HMR immediately remounts the owning React tree by
  key; the guard would otherwise refuse while that tree is still mounted.
- **`clearAllRegistries`** resets everything for a clean-slate teardown.

## Why this lives in the registrar, not the runtime

The split is deliberate. The runtime owns graph semantics — stamps, epochs,
waves, evaluation — and knows nothing about serialized keys, root persistence,
provisional leases, or handler ids. All of that is caching policy, and it lives
here. The previous engine spread this policy across the nodes themselves
(dependency resolvers, revival, relinking); the current design replaces it with
a few honest side indexes. There is more registry data, but each subscription
node carries fewer invariants — and the structural facts a node would no longer
tell you are recorded, once, at the moment it is cached.
