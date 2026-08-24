# Re-frame parity tradeoffs

Uklad keeps re-frame's durable ideas, but JavaScript does not have
ClojureScript's persistent values, structural equality, value-semantic vectors,
or Reagent reactions. This document records the mechanisms Uklad currently
uses to close those gaps and where each mechanism helps or hurts.

This is a decision aid for the current 0.x implementation, not a promise that
every mechanism should survive 1.0.

| Direction   | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| **Keep**    | The benefit is architectural and worth preserving.            |
| **Tune**    | The choice is sound, but its cost or boundary needs work.     |
| **Isolate** | Retain it for compatibility, not as the preferred future API. |
| **Rework**  | Decide on a simpler or stricter contract before 1.0.          |

## At a glance

| Re-frame goal                    | Current Uklad mechanism                                                     | Main benefit                                                | Main cost                                                                        | Direction                               |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------- |
| One immutable application state  | One state per runtime, updated through Immer                                | Ergonomic immutable transitions and structural sharing      | Proxy/value-model constraints and update cost                                    | **Keep, tune**                          |
| Reactive derived data            | A custom cached subscription DAG                                            | Coherent, selective recomputation                           | Considerable lifecycle and cache complexity                                      | **Keep, measure**                       |
| Structural subscription equality | Safe shallow structural comparison by default                               | Stops propagation for allocated shallow views               | O(immediate result width); nested allocations propagate                          | **Keep, measure**                       |
| Value-semantic query vectors     | `JSON.stringify(query)` cache keys                                          | Simple, inspectable canonical keys                          | Unsupported values collide or throw                                              | **Rework**                              |
| Immutable data events            | String-ID arrays with an immutable contract; cloning at external boundaries | Agent-generated events stay cheap and predictable           | The contract needs type/dev enforcement; cloning still costs at trust boundaries | **Rework, isolate cloning**             |
| Serialized event handling        | Async FIFO queue plus `dispatchSync`                                        | Deterministic ordering and reentrancy protection            | Two timing models and no per-event completion                                    | **Rework**                              |
| Cross-cutting event behavior     | Generic before/after interceptor context                                    | Flexible composition and re-frame familiarity               | Implicit authority and difficult static analysis                                 | **Isolate**                             |
| Pure handlers and external work  | Effects/coeffects represented as data                                       | Testable, portable logic with commit-before-effect ordering | Weak runtime contracts and detached async work                                   | **Keep, evolve**                        |
| Batched rendering                | Separate committed and published state heads                                | One coherent subscription generation per render wave        | Temporary read disagreement and headless latency                                 | **Rework**                              |
| Dynamic registration             | Runtime-owned string registries and disposable modules                      | Isolation, lazy loading, SSR, and safe cleanup              | The callable catalog is dynamic and only partly self-describing                  | **Keep ownership, evolve registration** |

## 1. One state per runtime, updated with Immer — Keep, tune

- **Description:** Each runtime owns one state object. Event handlers receive an
  Immer draft; normal execution uses `produce`, while observed execution uses
  `produceWithPatches` only when patches are requested. See
  [`runner.ts`](../../packages/core/src/events/runner.ts), [`immer.ts`](../../packages/core/src/core/immer.ts), and
  [`state.ts`](../../packages/core/src/runtime/state.ts).
- **Why:** This approximates re-frame's immutable `app-db` while letting
  JavaScript authors write direct-looking mutations.
- **Pros:** Structural sharing makes top-level `Object.is` checks cheap; no-op
  recipes preserve the old state identity; recipes do not mutate old
  snapshots; and optional patches support tracing and future history features.
- **Cons:** Proxies add work and have escape hazards; draft-derived values must
  be converted with `current()` before entering effects; `Map` and `Set`
  support is opt-in and process-wide; and supported state value types need a
  clear contract.
- **Alternatives:** Manual immutable reducers, a persistent-data-structure
  library, a reducer that returns a complete next state, or a different
  copy-on-write engine.
- **Direction:** Keep the immutable transition boundary and Immer for now.
  Publish a supported-value policy and benchmark large/deep updates on both
  V8 and Hermes. Keep patch generation demand-driven and keep the executor
  boundary open to another state engine.

## 2. Custom subscription DAG — Keep, measure

- **Description:** Registered subscriptions form a static DAG per serialized
  query. Active graphs update in one topological push wave; dormant graphs use
  a memoized pull; unused computed nodes are evicted. See
  [`subscription-runtime.ts`](../../packages/core/src/runtime/subscriptions/subscription-runtime.ts)
  and [`engine.ts`](../../packages/core/src/runtime/subscriptions/engine.ts).
- **Why:** This recreates re-frame's derived reactions without depending on
  React and guarantees that every listener sees a settled generation.
- **Pros:** Shared dependencies run once, fan-in sees coherent inputs,
  equality-stable branches stop downstream work, and the same graph works in
  React, React Native, SSR, tests, and headless processes.
- **Cons:** Activation rollback, aborted-render leases, reverse invalidation,
  terminal eviction, HMR, error retention, and reentrancy guards make this a
  substantial custom engine. Static dependencies also rule out convenient
  data-dependent graphs.
- **Alternatives:** Per-hook selectors, Reselect-style memoization, signals,
  proxy-based dependency tracking, or an observable library.
- **Direction:** Keep the DAG because it is a real differentiator. Protect it
  with contract tests, property tests, memory tests, and budgets for wide,
  deep, and mount-heavy graphs. Add compute/equality timing before adding more
  graph features.

## 3. Safe shallow subscription cutoffs — Keep, measure

- **Description:** Root subscriptions compare by `Object.is`; computed
  subscriptions use `shallowEqual` by default and retain the previous result
  object when equal. Arrays, plain objects, `Map`, `Set`, and typed arrays
  compare their immediate contents. Nested values use identity semantics;
  distinct unsupported instances compare unequal. A runtime or individual
  subscription can instead use `Object.is` or a custom comparator. See
  [`equality.ts`](../../packages/core/src/core/equality.ts) and
  [`cell.ts`](../../packages/core/src/runtime/subscriptions/cell.ts).
- **Why:** JavaScript selectors commonly allocate a new outer array, object, or
  collection around identity-stable values produced through structural
  sharing. Shallow comparison catches that common case without recursively
  walking every nested result.
- **Pros:** There is no equality runtime dependency; cycles are safe; inspection
  failures propagate as changes instead of hiding them; `Map` and `Set`
  behavior is independent of Immer's opt-in plugin; and equality still cuts
  off work for the whole downstream graph.
- **Cons:** Comparing a large flat result is still O(immediate width); a selector
  that recreates nested values needs memoization or a deliberate custom
  comparator; and an incorrect custom comparator can hide real changes.
- **Alternatives:** `Object.is` plus memoized selectors, domain-specific version
  stamps, an explicit deep comparator, or immutable result types.
- **Direction:** Keep shallow equality as the framework fallback. Measure wide
  arrays, objects, maps, sets, and typed arrays on V8 and Hermes, and document
  explicit identity or domain comparators where their cost model is better.

## 4. JSON-serialized subscription identity — Rework

- **Description:** A query such as `['todo/by-id', 42]` is cached and rebound in
  React under `JSON.stringify(query)`. Development mode warns about values
  known not to survive that encoding. See
  [`keys.ts`](../../packages/core/src/runtime/subscriptions/keys.ts) and
  [`use-subscription.ts`](../../packages/core/src/react/use-subscription.ts).
- **Why:** Re-frame vectors have value semantics and can be map keys. JavaScript
  arrays do not, so Uklad needs a stable primitive key.
- **Pros:** The key is simple, deterministic for JSON-safe inputs, readable in
  diagnostics, and reusable by both the graph cache and React binding.
- **Cons:** `undefined`, functions, symbols, non-finite numbers, `Map`, `Set`,
  and other values can collide; `BigInt` and cycles can throw; equivalent
  objects with different property insertion order can create different keys;
  and warnings do not enforce correctness.
- **Alternatives:** Enforce scalar/JSON-safe parameters, use a tagged canonical
  serializer, accept a per-subscription key function, or derive keys from
  validated descriptors.
- **Direction:** First make invalid parameters fail at the public boundary.
  Then choose either a small tagged canonical serializer or descriptor-defined
  keying before 1.0. A cache key must never silently alias a different query.

## 5. String-ID event vectors with an immutable contract — Rework, isolate cloning

- **Description:** Events are `[id, ...params]`. The intended agent-first
  contract is that the vector and all payload values are immutable after
  `dispatch()` is called. The current 0.x implementation gives queued and
  delayed work structured-clone ownership; `dispatchSync` consumes its vector
  immediately. See
  [`event-runtime.ts`](../../packages/core/src/runtime/event-runtime.ts) and
  [`types.ts`](../../packages/core/src/types.ts).
- **Why:** Re-frame events are immutable data values. Agent-authored code can
  follow that contract directly, so copying every event is defensive overhead
  rather than required application logic.
- **Pros:** Immutable-by-contract dispatch avoids deep-copy CPU and memory cost;
  event values remain simple and portable; and agent instructions, readonly
  types, and development checks can make violations visible at their source.
- **Cons:** Instructions are not runtime enforcement; aliases held by external
  code can still mutate payloads; deep-freezing changes caller-owned objects and
  needs special handling for `Map`/`Set`; and untrusted integrations still need
  an ownership boundary.
- **Alternatives:** Keep structured cloning as the default, deep-freeze events,
  fingerprint payloads before execution, use descriptor-backed object commands,
  or expose explicit `dispatchCloned()`/trusted-dispatch modes.
- **Direction:** For agent-first application code, make immutable event payloads
  the documented and readonly-typed contract, add a development deep-freeze or
  mutation guard, and prefer a no-copy/freeze path. Retain structured cloning
  as an explicit boundary for external, plugin, or otherwise untrusted inputs;
  preserve vectors as a compact compatibility and internal execution format.

## 6. Async serialized event queue plus `dispatchSync` — Rework

- **Description:** `dispatch()` enters a per-runtime FIFO state machine and
  runs on a later host task. Events added during a run wait for another queue
  cycle; event metadata can pause work until a yield or render boundary.
  `dispatchSync()` is an idle-only escape hatch. See
  [`router.ts`](../../packages/core/src/events/router.ts) and
  [`event-runtime.ts`](../../packages/core/src/runtime/event-runtime.ts).
- **Why:** This follows re-frame's event router, prevents reentrant transitions,
  preserves order, and naturally batches bursts of UI events.
- **Pros:** State transitions are serialized, one failure does not discard
  later accepted events, handler-triggered dispatch cannot mutate midway
  through the current transition, and async dispatch is platform-neutral.
- **Cons:** Fire-and-forget dispatch has no exact result or completion handle;
  `flush()` is a runtime-wide boundary; sync and async dispatch have different
  timing/error behavior; and render/yield scheduling is coupled to event-array
  metadata.
- **Alternatives:** Fully synchronous reducer dispatch, a promise-returning
  command queue, an actor mailbox with per-message handles, or a normalized
  operation executor over a private queue.
- **Direction:** Preserve serialized transitions, not the current queue API.
  Give individual invocations authoritative completion handles, keep queue
  states private, and move timer/render/task scheduling out of event metadata.

## 7. Generic interceptor context — Isolate

- **Description:** Global and event-local interceptors run `before` and `after`
  around a handler through a generic `Context` containing coeffects, effects,
  queue, stack, and transition state. See
  [`interceptors-executor.ts`](../../packages/core/src/events/interceptors-executor.ts).
- **Why:** This mirrors re-frame and provides one extension point for
  coeffects, policy, logging, validation, and other cross-cutting behavior.
- **Pros:** Ordering is explicit, behavior is composable, and applications can
  add middleware without changing the event runner.
- **Cons:** The broad context is implicit authority: behavior, inputs, and
  effects can differ from what a handler or descriptor declares. The
  before/after queue-stack model is hard to analyze, and the implementation
  repeatedly copies contexts and queue arrays.
- **Alternatives:** Narrow phase-specific hooks, handler wrappers, explicit
  input providers, effect policies, or descriptor middleware with declared
  capabilities.
- **Direction:** Do not expose interceptor internals through new APIs. Keep the
  pipeline behind the legacy executor while replacing common uses with narrow,
  enforceable hooks. Promote it only if real applications justify its
  complexity before 1.0.

## 8. Effects and coeffects as data — Keep, evolve

- **Description:** Handlers receive injected environmental inputs and return
  effect tuples. Uklad commits the candidate state before executing effects;
  synchronous failures are isolated, while promises and delayed work are
  currently detached. See [`execution.ts`](../../packages/core/src/events/execution.ts),
  [`effect-executor.ts`](../../packages/core/src/events/effect-executor.ts), and
  [`built-in-effects.ts`](../../packages/core/src/events/built-in-effects.ts).
- **Why:** This is re-frame's main purity boundary: domain transitions describe
  external work instead of performing it directly.
- **Pros:** Handlers are portable and easy to test; effect intent is visible to
  tracing and tools; platform adapters can differ; and commit-before-effect
  gives a clear local transaction boundary.
- **Cons:** Runtime checks validate only tuple shape and registration; effect
  promises are not awaited, cancelled, or retried; an effect failure cannot
  roll back committed state; and a missing or throwing required coeffect aborts
  its event before the handler or state transition runs.
- **Alternatives:** Direct injected service calls, thunks, sagas/observables, or
  typed command outcomes connected to a task supervisor.
- **Direction:** Keep the data boundary. Add schemas, adapter identity,
  capability policy, and required versus detached completion. Put
  cancellation/retry/concurrency in a supervised task layer rather than in the
  event queue.
- **Deviation from re-frame:** `reg-cofx` hands the handler the whole coeffects
  map and trusts whatever it returns, so the key a coeffect writes is knowable
  only by running it. Uklad instead has the handler return one value under a
  declared provider id. An event may bind that provider to an explicit local
  input name, so the contract still types the provider while the handler avoids
  awkward string-key access. The binding is declared at event registration,
  rather than hidden inside arbitrary handler code. A handler that needs the
  event or a prior coeffect receives a frozen, state-free view as its second
  argument; `draftState` is never exposed.

## 9. Separate committed and published state heads — Rework

- **Description:** Each event advances live `state`, while subscriptions read
  `renderState`. Consecutive commits coalesce behind a render-oriented
  scheduler; publication promotes the latest head, diffs top-level keys with
  `Object.is`, settles the DAG, and then notifies `useSyncExternalStore`.
  `dispatchSync()` publishes inline. See [`state.ts`](../../packages/core/src/runtime/state.ts),
  [`scheduling.ts`](../../packages/core/src/core/scheduling.ts), and
  [`use-subscription.ts`](../../packages/core/src/react/use-subscription.ts).
- **Why:** The design batches renders while ensuring newly mounted and already
  active subscriptions cannot observe different state generations.
- **Pros:** React sees a coherent snapshot, bursts produce one notification
  wave, unchanged top-level branches are cheap to skip, and intermediate
  generations do not cause render churn.
- **Cons:** `getState()` can be newer than every subscription; exact operation
  completion must distinguish committed from published revisions;
  `dispatchSync()` can publish earlier async commits; and browser-oriented
  scheduling adds latency and policy to the headless core.
- **Alternatives:** One synchronously published state head with notification
  batching in the React adapter, microtask publication, or an external-store
  version model whose adapter chooses render priority.
- **Direction:** Re-evaluate this before 1.0. Prefer one synchronous core state
  head and adapter-owned React batching if correctness tests and render-count
  benchmarks show equivalent behavior.

## 10. Runtime-owned dynamic registries and modules — Keep ownership, evolve registration

- **Description:** Every explicit runtime owns its state, queue, handlers,
  subscription graph, tracing, timers, and registry. IDs are registered
  dynamically; duplicates fail; `registerModule()` records opaque handles for
  safe reverse-order disposal. See [`runtime.ts`](../../packages/core/src/runtime/runtime.ts),
  [`registrations.ts`](../../packages/core/src/runtime/registrations.ts), and
  [`uklad-runtime.md`](../architecture/uklad-runtime.md).
- **Why:** Dynamic `reg-*` APIs preserve re-frame's module model, while explicit
  runtime ownership fixes the isolation limits of package-global state.
- **Pros:** SSR requests, tests, widgets, stories, and agent sandboxes can be
  isolated; modules can load lazily; stale handles cannot delete newer
  registrations; and DevTools can route to an exact runtime.
- **Cons:** The callable catalog is known only after code executes; arbitrary
  registration and interceptors can bypass a static manifest; active
  subscription graphs constrain replacement/disposal; and string namespaces
  still need human discipline.
- **Alternatives:** A package singleton, immutable store construction from a
  static module list, generated registries, or descriptor-first module
  installation.
- **Direction:** Keep explicit runtimes and disposable modules. Make validated
  descriptors/modules the preferred authoring contract and generate manifests
  from them. Retain raw dynamic registration as a compatibility and low-level
  escape hatch.

## Recommended improvement order

1. **Close correctness gaps:** enforce safe subscription parameters and make
   every asynchronous event ingress take ownership consistently.
2. **Evolve compatibly before 1.0:** improve vectors, the queue, generic
   interceptors, and dual state heads additively or behind the documented public
   contract; defer an unavoidable break to a future major release.
3. **Strengthen external work:** add enforceable effect/coeffect contracts and
   supervised async completion without weakening effects-as-data.
4. **Measure before changing defaults:** benchmark Immer, structured cloning,
   deep/shallow equality, graph churn, render counts, memory, and Hermes.

The parts worth protecting are one explicit runtime owner, immutable serialized
transitions, effects as visible data, and a coherent derived-state graph. The
parts most likely to improve are the JavaScript compatibility mechanisms around
those principles, not the principles themselves.

## Related documents

- [Uklad architecture](../architecture/uklad-runtime.md)
- [Subscription runtime](../architecture/subscription-runtime.md)
- [Foundation ADR](../architecture/foundation-adr.md)
