# Reflex architecture

Each `ReflexRuntime` is the sole owner of one application state and its event
and subscription machinery. Events are pure functions that describe a state
candidate plus effects. Effects are the only side effects. Subscriptions form a
cached reactive DAG over the runtime's published state.

## Runtime ownership

The internal runtime has one stable, eagerly constructed shape:

```text
RuntimeCore
├── identity
├── state: StateStore
├── registry: RuntimeRegistry
├── events: EventRuntime
├── subscriptions: SubscriptionRuntime
└── probe: RuntimeProbe | undefined
```

The four mandatory services always exist. `probe` is the only optional
hot-path capability and is `undefined` in an uninstrumented runtime.

| Owner                 | State and policy it owns                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `StateStore`          | Live and published state heads, flush scheduling, and primitive committed/published revisions                     |
| `RuntimeRegistry`     | Handler stores, immutable event definitions, global interceptors, system baselines, and registration generations  |
| `EventRuntime`        | Event queue, execution guards, current effect lineage, dispatch timers, rate limits, and global injection         |
| `SubscriptionRuntime` | Definitions, root indexes, canonical cache, reverse edges, provisional leases, equality options, and graph engine |
| `RuntimeProbe`        | Optional passive execution facts requested by tracing or DevTools; it owns no application semantics               |

`runtime/api.ts` owns the public runtime contract. `runtime/runtime.ts`
implements that façade: it validates public input, delegates to the owning
service, tracks module registration tokens, owns watches, and coordinates
terminal disposal. It is not a second store for engine state.

## Event flow

```text
core.events.dispatch(event)
  │
  ├─ validate and take ownership of caller input
  ├─ create ExecutionEnvelope { event, tracking? }
  ├─ EventQueue schedules the envelope
  └─ executeEventEnvelope
       ├─ runEvent
       │    global interceptors → event interceptors → pure handler
       │    returns candidate state + effect intents
       ├─ commitTransition
       │    advances StateStore once
       ├─ executeEffects
       │    invokes declared effects after commit
       │    synchronous child dispatch inherits exact effect causality
       └─ StateStore publication
            changed roots → SubscriptionRuntime.publish
            → settled subscription graph → listeners
```

`dispatchSync` uses the same runner → commit → effects path inline and then
publishes. It is rejected while another event, subscription computation, or
listener publication owns the synchronous lane. `flush()` waits for the event
queue to reach its next idle boundary and publishes the current state head.

### Queue work

`ExecutionEnvelope` contains only an event vector and optional probe tracking:

```ts
interface ExecutionEnvelope {
  readonly event: EventVector;
  readonly tracking?: RuntimeTrackingContext;
}
```

Ordinary events carry no operation IDs, timestamps, snapshots, retained
records, or trace objects. The queue uses a head index instead of repeated
`Array.shift()` calls.

### Event definitions

`RuntimeRegistry` stores an event handler and its interceptor list as one
immutable `RuntimeEventDefinition`. Re-registering an event atomically replaces
both. Omitting registration options therefore clears a previous interceptor
chain instead of accidentally retaining it.

Global interceptors are registry-owned. `EventRuntime` owns the interceptor
that injects the registry's current global list into a running chain.

### Commit and effect ordering

The runner never commits or invokes effects. `events/execution.ts` makes one
commit decision and only then calls the effect executor. State revisions stay
as primitive fields inside `StateStore`; only `getStateRevisions()` allocates a
public DTO.

Effect reporting is conditional. Timing and effect fact objects are constructed
only when the accepted event has a probe callback for them. The active-effect
slot is populated only for tracked work, so uninstrumented effects do not pay
for causality bookkeeping.

## Optional instrumentation

`RuntimeProbe` is the only instrumentation channel. Its capability flags
control expensive evidence:

- `needsPatches` selects Immer `produceWithPatches`; otherwise handlers use
  ordinary `produce`.
- `needsSubscriptionEvidence` requests diagnostic DTOs for recalculated
  subscriptions; otherwise publication retains none.
- `needsSpans` enables trace span construction.
- `tracksOperations` marks a probe capable of accepting explicit DevTools
  operation dispatch.

Probe callbacks are passive. Their return values cannot reject an event, abort
a coeffect, change a commit, or affect effect policy. Callback failures are
isolated and logged. Attaching a probe returns an idempotent disposer; removing
the final attachment restores `core.probe` to `undefined`.

Multiple optional consumers are composed behind the single slot. Each accepted
event carries opaque tokens only for probes that accepted that exact
occurrence. Parent tokens are inherited directly from the active envelope, with
the source effect id and index when a synchronous effect dispatches a child.

The legacy lifecycle and trace APIs are compatibility adapters over this probe
boundary. They keep their collector state in `WeakMap`s keyed by `RuntimeCore`;
they do not add lifecycle or trace stores to the core shape. Lifecycle boolean
returns remain type-compatible but are ignored.

### DevTools operations

Core emits execution facts; DevTools owns the retained model.
`events/execution-observer.ts` adapts the independently published DevTools
observer contract to one operation-capable probe. DevTools assigns operation
and event IDs, snapshots diagnostic values, retains the bounded ledger, formats
receipts, and handles delivery.

An ordinary dispatch does not enter the operation ledger. An explicit DevTools
operation dispatch must be accepted by an operation-capable probe or it fails
admission. Synchronous child events inherit the exact parent event/effect token;
DevTools does not reconstruct causality from a global active-event stack.

## State publication

`StateStore` owns two state heads:

| Field         | Meaning                                        |
| ------------- | ---------------------------------------------- |
| `state`       | Live write head advanced by event commits      |
| `renderState` | Published read head used by every subscription |

Between a commit and publication, `state` may be ahead of `renderState`. This
ensures cached subscriptions and newly mounting components observe the same
generation. Publication promotes the head, compares top-level keys with
`Object.is`, resolves changed root subscriptions, and asks
`SubscriptionRuntime` to settle them.

Committed and published revisions are monotonic primitive counters. Consecutive
asynchronous commits coalesce behind one scheduled publication.

## Subscription runtime

`SubscriptionRuntime` owns definition registration, graph construction,
imperative reads, subscriptions, publication, diagnostics, and cache policy.
Callers use this service directly rather than crossing module boundaries
through wrapper functions.

Its `SubscriptionEngine` owns graph semantics:

| Mechanism                      | Purpose                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Output/dependency stamps       | Skip computation and equality checks when dependencies did not produce observable work |
| Fixed topological rank         | Settle active dependents after every dependency                                        |
| Pull epochs                    | Iterative, memoized reads for dormant graphs                                           |
| Publication waves              | Deduplicate active push propagation and notify from one settled generation             |
| Transactional activation       | Link dependencies bottom-up and roll back completely if activation fails               |
| Terminal computed-cell release | Evict unused computed graphs; persistent root cells remain publication anchors         |

The surrounding service owns:

- root source indexes in both directions;
- one canonical cached node per serialized query;
- forward and reverse cache edges for safe closure invalidation;
- two-generation provisional leases for aborted React renders;
- per-definition equality configuration;
- subscription registration ownership tokens.

Diagnostic subscription snapshots are created only for an inspector request or
when an attached probe sets `needsSubscriptionEvidence`.

## Registration ownership

Every mutable registration returns an opaque `RegistrationOwnership` token.
The token knows whether it still owns the current generation and can release
that generation without deleting a newer replacement. Version counters remain
private to `RuntimeRegistry`.

`registerModule()` records these tokens. Disposal first asks every token to
validate destructive release, runs user cleanup, and releases tokens in reverse
order. Subscription tokens reject release while an affected graph is active.
This removes handler-version probing from the public runtime façade.

## Module map

Paths are relative to `src/`.

| Path                                  | Responsibility                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `runtime/core.ts`                     | Stable service shape, identity, composition, and terminal marker                  |
| `runtime/api.ts`                      | Public runtime contract, handler types, and state revision DTO                    |
| `runtime/runtime.ts`                  | Public runtime façade, modules, watches, restore, flush, and disposal             |
| `runtime/validation.ts`               | Strict public runtime boundary assertions                                         |
| `runtime/state.ts`                    | `StateStore` and the single state-publication boundary                            |
| `runtime/handler-types.ts`            | Registry, event-definition, and ownership-token contracts                         |
| `runtime/handlers.ts`                 | `RuntimeRegistry`, system baselines, and registration generations                 |
| `runtime/probe-types.ts`              | Passive instrumentation contracts and fact DTOs                                   |
| `runtime/probe.ts`                    | Sole optional passive instrumentation capability                                  |
| `runtime/lifecycle-types.ts`          | Compatibility lifecycle observer contract                                         |
| `runtime/lifecycle.ts`                | Compatibility lifecycle observer projected onto `RuntimeProbe`                    |
| `runtime/reset.ts`                    | Cross-service clear coordination                                                  |
| `runtime/subscriptions/types.ts`      | Opaque graph handles, specs, listener metadata, and diagnostics                   |
| `runtime/subscriptions/validation.ts` | Subscription registration option validation                                       |
| `runtime/subscriptions/cache.ts`      | `SubscriptionRuntime`: definitions, construction, cache, leases, and engine owner |
| `runtime/subscriptions/cell.ts`       | Cached node values, errors, stamps, and listener delivery                         |
| `runtime/subscriptions/engine.ts`     | Reactive graph activation, traversal, publication, and release                    |
| `runtime/subscriptions/keys.ts`       | Canonical query-key serialization                                                 |
| `runtime/events.ts`                   | `EventRuntime`, dispatch orchestration, timers, rate limits, and event lineage    |
| `events/router.ts`                    | `EventQueue` and event scheduling primitive                                       |
| `events/execution.ts`                 | Runner → commit → effects coordinator and probe fact emission                     |
| `events/runner.ts`                    | Interceptor chain and pure handler evaluation                                     |
| `events/committer.ts`                 | State transition commit primitive                                                 |
| `events/effect-executor.ts`           | Post-commit effects and exact synchronous child causality                         |
| `events/execution-observer-types.ts`  | Structural DevTools observer contract                                             |
| `events/execution-observer.ts`        | DevTools observer-to-probe adapter                                                |
| `core/tracing-types.ts`               | Public trace and trace-error DTOs                                                 |
| `core/tracing.ts`                     | Optional compatibility trace collector backed by a probe                          |
| `inspector-types.ts`                  | Public inspector and DevTools runtime-port contracts                              |
| `inspector.ts`                        | Runtime-bound structural inspection adapter                                       |
| `react/types.ts`                      | Public React provider and typed-hook contracts                                    |
| `react/*`                             | Provider, `useSyncExternalStore` binding, and hot reload                          |

## Invariants

- Every mutable service belongs to exactly one explicit runtime.
- Mandatory services are eager; only `probe` is optional.
- Hot runtime state never lives in a generic extension map.
- `renderState` advances only at the publication boundary.
- Events commit at most once and effects execute only after that decision.
- Instrumentation is passive and absent from ordinary queue work.
- Event handler plus interceptor metadata is one registry definition.
- One canonical subscription node exists per serialized query key.
- A cached subscription never retains a terminal dependency.
- Each publication computes an affected active cell at most once and notifies
  listeners from a fully settled graph.
