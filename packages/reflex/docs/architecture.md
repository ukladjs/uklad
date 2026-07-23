# Reflex architecture (compact spec)

Each `ReflexRuntime` owns one central state. Events are pure functions that
describe a new state plus effects. Effects are the only side effects.
Subscriptions are a cached, reactive DAG derived from that runtime's state. React
reads subscriptions through `useSyncExternalStore` and the nearest explicit
`ReflexProvider`.

## End-to-end flow

```
dispatch(['todos/add', 'milk'])
  │
  ├─ events/router.ts         EventQueue<ExecutionEnvelope> queues one owned occurrence
  ├─ events/execution.ts      coordinates runner → commit → effects for that envelope
  ├─ events/runner.ts         interceptor chain + handler produce a TransitionOutcome
  │     cofx inject → global interceptors → custom → event handler
  ├─ events/committer.ts      commits the candidate state once
  ├─ events/effect-executor.ts executes declared effects only after the commit
  ├─ events/outcomes.ts       immutable queue, transition, commit, effect records
  ├─ events/operation-coordinator.ts exact root/child operation projection
  ├─ runtime/state.ts         state advances; flush scheduled (coalesced, rAF)
  │        ~~~~~~~~~~ window: state ahead, renderState behind; ALL subs still read renderState
  ├─ runtime/state.ts        flushSubscriptions(): renderState advances, diff top-level keys
  ├─ runtime/subscriptions/engine.ts
  │                           roots refresh → rank-ordered settle → freeze → notify
  └─ react/use-subscription.ts
                              listeners fire → React re-renders → cache-only snapshot
```

`dispatchSync` runs the same path inline (handler + flush) instead of queueing.

## Module map

Paths in this document are relative to `src/`.

| Path                                                                 | Responsibility                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `index.ts`                                                           | Combined explicit-runtime entrypoint                                                   |
| `vanilla.ts` / `react.ts`                                            | React-free runtime and React-only public entrypoints                                   |
| `contracts.ts`                                                       | Store-local runtime contract extraction and vector/result types                        |
| `types.ts`                                                           | Public contracts and module-augmentation anchors                                       |
| `runtime/runtime.ts`                                                 | `createReflexRuntime`, modules, watches, restore/flush                                 |
| `runtime/kernel.ts`                                                  | Instance-owned runtime kernel, identity, and terminal lifecycle                        |
| `core/*`                                                             | Environment, equality, Immer, logging, scheduling, tracing, and validation             |
| `runtime/state.ts`                                                   | `state`/`renderState`, coalesced flush, changed-root publication, publication outcomes |
| `runtime/handlers.ts`                                                | Typed handler definitions and framework-owned handler baselines                        |
| `runtime/event-metadata.ts`                                          | Per-event interceptor metadata                                                         |
| `runtime/reset.ts`                                                   | Cross-store clear coordination                                                         |
| `runtime/subscriptions/engine.ts`                                    | Reactive graph semantics: push waves, pull reads, and live lifecycle                   |
| `runtime/subscriptions/cache.ts`                                     | Root metadata, canonical instances, reverse edges, leases, and sub config              |
| `runtime/subscriptions/keys.ts`                                      | Canonical query-key serialization and development validation                           |
| `events/router.ts`                                                   | FIFO queue of execution envelopes and legacy dispatch entrypoints                      |
| `events/execution.ts`                                                | Composes runner, committer, effect executor, and execution records                     |
| `events/runner.ts`                                                   | Interceptors and pure event-handler evaluation                                         |
| `events/committer.ts`                                                | One state commit decision for a transition outcome                                     |
| `events/effect-executor.ts`                                          | Post-commit effect execution and effect outcomes                                       |
| `events/outcomes.ts`                                                 | Runtime-owned identities and passive immutable outcome projection                      |
| `events/operation-coordinator.ts`                                    | Mandatory exact projection of outcomes into operation state                            |
| `events/registration.ts`, `events/coeffects.ts`, `events/effects.ts` | Legacy registration and built-in effect support                                        |
| `subscriptions/registration.ts`                                      | Root and computed subscription definitions                                             |
| `subscriptions/queries.ts`                                           | Graph construction, cache lookup, and imperative reads                                 |
| `react/*`                                                            | `useSubscription` and hot-reload bindings; the only React-dependent modules            |

See [`code-conventions.md`](./code-conventions.md) for ownership and dependency
rules for this tree.

## Event side

**`events/router.ts`**

| Item                  | What / why                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EventQueue`          | Per-runtime FSM (`idle → scheduled → running → paused`) carrying `ExecutionEnvelope`s. Events added during a run move to the next tick; idle waiters implement `flush()` |
| `dispatch(event)`     | Async: queue the event, return immediately                                                                                                                               |
| `dispatchSync(event)` | Run the same envelope coordinator + flush inline. Rejected inside a handler, a computation, or a listener                                                                |

**`events/execution.ts`, `events/runner.ts`, `events/committer.ts`, and `events/effect-executor.ts`**

| Item                                              | What / why                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regEvent(id, handler, options?)`                 | Register a pure handler. Prefer `{ coeffects, interceptors }`; coeffect specs become inject-interceptors. Legacy positional arrays remain supported |
| `executeEventEnvelope(envelope)`                  | Compose runner, commit, effects, lifecycle compatibility, traces, and immutable outcomes                                                            |
| `runEvent(eventV)`                                | Assemble and run `globals → custom → handler`; return state candidate and final effect intents without committing or executing effects              |
| `createEventHandlerInterceptor`                   | Builds the interceptor that runs the handler inside `produce`, captures a state candidate + effects, and emits patches only while tracing           |
| `commitTransition(envelope, candidateState)`      | Make one commit decision before any external effect executes                                                                                        |
| `executeEffects(envelope, effects)`               | Invoke effects after commit; return one outcome per effect and attach child-envelope parentage for synchronous dispatch                             |
| `OperationCoordinator`                            | Applies canonical records before passive observers, retaining root/child membership and terminal operation status                                   |
| `getHandlingEventId` / `getRunningHandlerEventId` | Reentrance guards (`dispatchSync` refusal, dev `dispatch`-in-handler warning)                                                                       |
| `regEventErrorHandler`                            | Override the framework-owned catch-all for exceptions in the chain; clearing the override restores the default                                      |

Event registration is replacement-based: re-registering an id replaces both
its handler and its event-specific interceptor list. Omitting options clears
metadata from the previous registration. The explicit form avoids the legacy
empty-array ambiguity:

```ts
regEvent('todos/load', handler, {
  coeffects: [['now']],
  interceptors: [auditInterceptor],
});
```

Coeffects such as `now` must be registered by the application before the event
is dispatched.

**`events/interceptors.ts`** — `execute(eventV, interceptors)`; `Context = { coeffects, previousState, effects, queue, stack, newState }`. `previousState` is the immutable state generation captured at event start; `newState` is the final Immer generation after the handler, or unset until it runs. `before` walks queue→stack and `after` unwinds the stack. Every `after` hook may compare the read-only state generations and append to the shared `effects` list. The runner returns the final candidate and effect intents to the coordinator, which commits once and then invokes the post-commit effect executor. Event traces record that final list, including effects contributed by interceptors.

**`events/effects.ts`** — `regEffect(id, handler)` plus legacy built-ins:
`DISPATCH` and `DISPATCH_LATER`. `events/effect-executor.ts` performs the
post-commit lookup, invocation, failure isolation, and outcome projection. The
router injects its dispatch function when installing built-ins, so the write
path has no `effect executor → router → effect executor` module cycle.

**`events/coeffects.ts`** — `regCoeffect(id, handler)`. `getInjectCofxInterceptor(id, value?)` injects into `context.coeffects` before the handler runs. Coeffects are application-owned and must be registered explicitly.

## State

**`runtime/state.ts`** — every operation receives the explicit runtime kernel
that owns its state.

| Item                                                   | What / why                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `state`                                                | Live write head. Events commit new generations here                                |
| `renderState`                                          | Published read head. Every subscription reads this, never `state`                  |
| `updateState(newState)`                                | Commit + schedule a flush. Consecutive events coalesce into one                    |
| `flushSubscriptions()`                                 | Promote `renderState`, diff top-level keys with `Object.is`, publish changed roots |
| `initState(value)` / `getState()` / `getRenderState()` | Bootstrap and accessors                                                            |

Why two heads: between a commit and the flush, cached subscriptions and newly
mounting components must serve the **same** state generation. `renderState` advances
only inside a publication, which is what makes the flush the single publication
boundary.

## Subscription runtime

**`runtime/subscriptions/engine.ts`** — owns graph semantics only (no keys, no registry).

`SubscriptionCell` fields:

| Field                                             | What / why                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `value` / `error` / `hasValue` / `hasError`       | Cached result. Errors are retained state, rethrown on read                         |
| `outputStamp`                                     | Bumped only on an observable change. The unit of staleness                         |
| `dependencyStamps`                                | Stamps seen at last compute → recompute only if one moved                          |
| `rank`                                            | `0` for roots, else `1 + max(dep ranks)`. Fixed at construction; drives wave order |
| `active`                                          | Has listeners or active dependents. Inactive cells get zero work in a wave         |
| `disposed`                                        | Terminal computed cell. Reads/subscribes throw; reacquire by key                   |
| `listeners` / `dependents`                        | Live edges, maintained by activation/release                                       |
| `validatedEpoch` / `lastPullEpoch` / `queuedWave` | Memoization and dedup markers                                                      |

`SubscriptionEngine` operations:

| Op                                      | What / why                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishWave(roots)` (push)             | Refresh changed roots, settle the live graph in rank order (dedup by `queuedWave`), freeze listener lists, notify. Every listener sees one settled generation |
| `pull(target)`                          | Iterative post-order read path for dormant/fresh cells. Stops at any active+validated cell. Epoch-memoized → repeated reads are O(1) between publications     |
| `activate(cell)`                        | Bottom-up, transactional. Links dependency edges, fires `onActive`; rolls back fully if a hook throws                                                         |
| `releaseUnused(cell)`                   | Cascade down; stops at any cell that still has listeners or dependents. Computed → disposed + evicted; roots → deactivated only                               |
| `phase` (`idle`/`settling`/`notifying`) | Guards: no reads, creates, or publications during computation; no publication during listener delivery                                                        |
| `inspectSubscription(node)`             | Cache-only DTO for devtools. Never computes                                                                                                                   |

Internal engine operations: `createSubscription`, `readSubscription`, `getSubscriptionSnapshot`,
`subscribeToSubscription`, `publishSubscriptions`. Nodes are opaque
(`SubscriptionNode<T>`) — the runtime never hands out mutable cells.

**`runtime/subscriptions/keys.ts`, `subscriptions/registration.ts`, and
`subscriptions/queries.ts`**

| Item                                     | What / why                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regSub(id)` / `regSub(id, 'stateKey')`  | Root: reads one top-level state key from `renderState`. No parameters allowed                                                                      |
| `regSub(id, computeFn, depsFn, config?)` | Computed: static dependency vectors from `depsFn(...params)`                                                                                       |
| `getOrCreateSubscription(vector)`        | Builds (or reuses) the whole graph. Iterative — `frames` is an explicit DFS stack, so depth can't blow the JS stack. `buildingKeys` detects cycles |
| `getSubVectorKey(vector)`                | Runtime-owned canonical cache key. Dev-warns on params that don't survive JSON serialization                                                       |
| `getSubscriptionValue(vector)`           | Imperative one-shot read (services, headless, devtools)                                                                                            |

**`runtime/handlers.ts` and `runtime/subscriptions/cache.ts`** — handler
definitions and the caching policy the engine knows nothing about: root
anchoring, the instance cache with reverse edges, and provisional leases. See
[`subscription-registry.md`](./subscription-registry.md).

**`react/use-subscription.ts`** — `useSubscription(vector, componentName?)`.
Wraps `useSyncExternalStore`; store bindings are memoized on the runtime plus
serialized key and use the runtime's read primitive plus its internal render
subscription bridge. Provider changes therefore rebind without crossing
subscription engines.

## Support

| Item                                                 | What / why                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `scheduleAfterRender(f)`                             | rAF, with a 100 ms timeout fallback — a hidden tab must not stall flushes forever                                                 |
| `scheduleNextTick(f)`                                | `setImmediate` (RN) / `MessageChannel` (web) scheduling for queued event work                                                     |
| `withTrace` / `mergeTrace` / `registerTraceCallback` | Trace pipeline. opTypes: `event`, `sub/create`, `sub/run`, `sub/dispose`, `render`. Tag `subscriptionKey` identifies the instance |
| `setGlobalEqualityCheck` / `regGlobalInterceptor`    | Runtime-wide defaults                                                                                                             |
| `shallowEqual`                                       | Opt-in equality check; default is deep equality                                                                                   |
| `debounceAndDispatch` / `throttleAndDispatch`        | Rate-limited dispatch                                                                                                             |
| `enableTracing` / `disableTracing`                   | Hold or release the manual trace owner; inspector subscriptions keep tracing active through independent leases                    |
| `IS_DEV`                                             | Gates development-only diagnostics                                                                                                |

## Invariants

- Every mutable state, queue, registry, cache, trace, and callback store is keyed
  by an explicit runtime kernel. Scheduled callbacks capture that kernel.
- `renderState` advances **only** inside a publication. The flush is the single publication boundary.
- One canonical node per serialized query key. Duplicates are an error.
- Roots are persistent state anchors; computed cells are terminal and evicted when unused.
- A cached entry never retains a terminal dependency node.
- Compute and equality functions are pure. Reads, creates, and publications are rejected while the runtime is settling.
- Listeners are zero-argument invalidation signals; they read a settled snapshot themselves.
- Each publication: every changed root reads once, every affected cell computes at most once, every listener fires at most once.
