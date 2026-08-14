# Subscription runtime

Uklad has one subscription runtime built around an opaque `SubscriptionNode`.
React, the STATE, the registry, and devtools never receive mutable runtime nodes.
They use narrow operations for reads, subscriptions, STATE publication, lifecycle,
and cache-only diagnostics.

## Execution model

The runtime has two evaluation paths:

- A live graph is pushed once from all changed STATE roots in topological-rank
  order. Every cache settles before the first listener runs. Subscription
  extensions sample their separate signal tuple when a real consumer activates
  them. After later STATE publications they schedule one passive, coalesced
  tuple check, but never publish a graph wave themselves.
- A dormant read uses an iterative post-order pull. State-only paths memoize
  between STATE waves and serve their cached snapshot without starting any
  extension lifecycle.

STATE commits enter one synchronous settlement wave. There is no per-subscription
task queue, dirty propagation, notification debt, dependency resolver, or node
revival.

## Subscription extensions

`regSubExt` attaches an explicit lifecycle controller to an already-registered
root or derived subscription. It does not change that subscription's pure data
definition: roots still read one STATE key, and derived subscriptions still
compute from only their declared data dependencies.

An extension declares its own **signals**. A signal is an ordinary subscription
vector sampled without creating a dependency edge. `SubscriptionExtension.sync`
runs only after a live downstream consumer has activated the lifecycle target
and receives the latest signal tuple; `dispose()` runs when the final consumer
leaves. The first sync is immediate for that activation. Later STATE
publications schedule one coalesced sample on the next host task, and `sync`
runs only if a signal value changed. Signal nodes remain dormant and may be
swept and recreated normally; extension observation is never a liveness reason.

This is the generic switch-map mechanism: an extension can replace an external
observer when a signal changes. Any extension may update an
explicitly named top-level state key through the runtime-supplied `updateRoot`
capability. The runtime requires that key to back a registered root
subscription and applies the updater to its latest value through a protected
event; it never calls subscription publication directly:

```text
signal state → extension sync → external observer → event → STATE root → ordinary subscription
```

The lifecycle target and storage root are independent. A parameterized derived
subscription can therefore own one external observer per parameter vector and
merge every result into a shared backing root. Because each update is applied
to the latest root value, concurrent instances do not overwrite one another.

The signal resolver, factory, and first sync run only from consumer activation,
never from subscription computation or a dormant read. An extension must
therefore keep its factory declarative and start external work from `sync`.

## Per-publication budgets

For one STATE publication:

- Each changed root is read exactly once.
- Each affected computed node runs at most once.
- Equality runs at most once after a successful recomputation.
- Descendants behind an equality-stable result receive zero work.
- Multi-root and unequal-depth fan-in runs only after every changed input has
  settled.
- Each listener runs at most once and reads a coherent cache-only snapshot.
- Rank scheduling is proportional to queued ranks rather than maximum graph
  depth.

The contract suite makes these budgets executable with wide fan-out,
diamonds, equality cutoffs, duplicate edges, sparse unequal-depth fan-in,
active/dormant boundaries, and deep registered graphs.

## Lifecycle and correctness rules

- Root cells are persistent STATE anchors and never accept query parameters.
  Under a declared contract `regRootSub` rejects a parameterized id at compile
  time, and rejects a source key whose state type does not satisfy the
  subscription's declared result. Both the id and the key are resolved through
  an indexed access rather than matched against a precomputed set, so an index
  signature on either section constrains what it admits while a narrower named
  entry still wins at its own name. The id, the key, and the state's own
  variants are checked together, so a union-typed id is accepted only with a
  key valid for every member, and a union state only with a key every variant
  declares. The runtime keeps throwing on a parameterized root query, which is
  what an undeclared contract still relies on.
- Computed dependencies are static for one serialized subscription key.
- Computed nodes have a terminal live lifecycle.
  Their last consumer evicts them; a later key lookup creates a fresh graph.
- Evicting or explicitly clearing a cached dependency also invalidates every
  dormant cached parent through iterative reverse registry edges. Canonical
  cache entries therefore never retain a terminal dependency node.
- Hook closures retain serialized query keys, not runtime nodes.
- Provisional graphs created by aborted renders receive a short graph-wide
  lease and are swept if they never become active.
- Activation is transactional. A failing lifecycle hook rolls back every new
  edge; release-hook and listener failures cannot interrupt other cleanup or
  delivery.
- Direct publication and `dispatchSync` are rejected during computation or
  listener delivery before `state` or `renderState` can advance. Ordinary async
  `dispatch` remains safe because its flush runs later while the runtime is
  idle.
- Computation errors are retained. A dependency publication or subsequent
  snapshot request retries them, including Suspense-style transient throws.
  The first successful result never compares against a missing previous value.
- `regRootSub` and `regSub` cannot replace a handler while cached queries for
  that id exist.
- Registry and subscription-handler clearing is rejected while a graph is
  active and cascades through cached dependents. HMR uses an internal reset
  followed by a keyed remount.

## React and STATE timing

`renderState` is the published generation. Async events may advance `state`, but
all subscriptions continue to expose `renderState` until the scheduled flush:

1. `renderState` advances.
2. Changed top-level keys identify persistent root cells with `Object.is`.
3. All changed roots update and the live DAG settles in rank order.
4. Listener lists are frozen.
5. Listeners run and read the settled generation.

If publication occurs between render and subscribe, activation silently
validates the cached render snapshot. `useSyncExternalStore` then performs its
normal post-subscribe comparison; subscribe itself emits no initial callback.

## Contract changes from the previous runtime

Async `dispatch` remains batched and scheduled. Once its flush task begins,
the graph settles and listeners run synchronously before that task returns;
the previous runtime delivered listeners from per-node microtasks.
`dispatchSync` is unchanged: it settles the graph and notifies listeners before
returning.

Terminology is now consistent across the public API, runtime, and tracing:

- `clearReactions` was replaced by `clearSubscriptionCache`; there is no
  compatibility alias.
- The trace tag `tags.reaction` was replaced by `tags.subscriptionKey`.

## Worked examples

All examples share one registered graph. `todos` and `filter` are top-level
state keys. Each cell's rank is fixed at construction: roots are rank 0, a
computed cell is `1 + max(rank of its dependencies)`. A publication wave
processes rank buckets in ascending order, so every dependency settles
before any cell that reads it.

```
[todos] (root, 0)      [filter] (root, 0)
   |         \                   |
   v          v                  |
[count] (1)  [visible] (1) <-----+
    \           /
     v         v
     [stats] (2)
```

`[count]` is `todos.length`, `[visible]` filters todos by the current
filter, `[stats]` combines both.

### One coalesced publication

Components watch `[visible]` and `[stats]`. Two events dispatch within one
frame:

```
dispatch(['add-todo'])     state = G1    renderState = G0
dispatch(['set-filter'])   state = G2    renderState = G0
     every subscription read in this window still serves G0,
     including subscriptions created by components mounting now

scheduled flush (one task):
  renderState = G2; keys changed since G0: todos, filter
  rank 0: [todos] and [filter] each refresh exactly once
  rank 1: [count] runs once; [visible] runs once and sees the new
          todos AND the new filter together - no torn input
  rank 2: [stats] was enqueued by both parents, deduplicated by its
          wave id, runs once against two settled inputs
  listener lists frozen; listeners of [visible] and [stats] fire once
  each; every snapshot they read is G2
```

The intermediate generation G1 is never observable anywhere.
`dispatchSync` runs the same wave inline instead of from the scheduled
task; the wave itself is always synchronous.

### Equality cutoff

An event edits the text of a todo that the current filter hides:

```
flush: changed key: todos (new object identity)
  rank 0: [todos] refreshes, output stamp advances
  rank 1: [count]   recomputes: 5 -> 5, equality-stable,
                    stamp unchanged
          [visible] recomputes: same visible item identities, shallow-equal,
                    stamp unchanged
  rank 2: [stats] is never enqueued - zero work
  changed set is empty: no listener fires, React renders nothing
```

The whole wave cost one root read and two rank-1 recomputations.
Equality-stable results keep their previous object identity, so memoized
children relying on reference equality also stay quiet.

### Screen switch: dormant pull, activation, terminal release

A new screen renders while the old one is still mounted:

```
render (new screen):
  getSnapshot(['stats']) -> cache miss -> cells built from the registry
  dormant pull settles post-order:
    [todos] [filter] [count] [visible] [stats]
  values cached, nothing is active yet; if this render aborts, the
  provisional lease sweeps the unused cells

commit:
  old screen cleanup runs first:
    the release cascade deactivates its exclusive computed cells
    (terminal - evicted from the registry) and stops at any cell that
    still has dependents or listeners; root cells always stay
    registered, warm and inactive
  new screen effects subscribe:
    activation links dependency edges bottom-up and transactionally;
    the first-listener catch-up pull short-circuits at the
    already-validated cell when nothing was published since render

between publications:
  repeated reads of any dormant cached cell are constant-time until
  the next publication epoch
```

### Error retention and recovery

```
flush 1: [visible] throws during recomputation
  the error becomes the cell's state, its stamp advances
  [stats] sees a failed dependency and adopts the same error
  listeners fire once; getSnapshot throws the retained error into the
  component / error boundary

re-render: getSnapshot on the failed cell retries only the failing
  path; re-throwing the identical error object does not advance stamps,
  so descendants are not woken again

flush 2: the underlying data is fixed
  [visible] recovers - recovery is always an observable change, stamps
  advance through [stats], listeners fire, snapshots serve values again
```

## Devtools diagnostics

`getSubscriptionDiagnostics()` returns fresh, read-only DTOs containing a
subscription key/query, root/computed kind, active state, version, and
cached value/error status. It never pulls, recomputes, subscribes, or exposes
listeners/dependencies. Devtools can diff versions and detect disappeared keys
without coupling to runtime internals.
