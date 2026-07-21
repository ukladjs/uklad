# Reflex architecture (compact spec)

Each `ReflexRuntime` owns one central db. Events are pure functions that
describe a new db plus effects. Effects are the only side effects.
Subscriptions are a cached, reactive DAG derived from that runtime's db. React
reads subscriptions through `useSyncExternalStore` and the nearest explicit
`ReflexProvider`.

## End-to-end flow

```
dispatch(['todos/add', 'milk'])
  │
  ├─ events/router.ts         EventQueue (FSM) queues and runs a snapshot on the next tick
  ├─ events/pipeline.ts       handle(): builds the interceptor chain for this event id
  ├─ events/interceptors.ts   execute(): before phase (queue→stack), after phase (unwind)
  │     cofx inject → global interceptors → custom → event handler
  ├─ events/pipeline.ts       handler(coeffects, ...params) runs inside Immer produce
  │                   → context.newDb   (pure, no side effects)
  │                   → context.effects  [['http', {...}]]  (data, not calls)
  ├─ events/effects.ts        doFx (after phase): updateAppDb(newDb), then run effects
  ├─ runtime/app-db.ts        appDb advances; flush scheduled (coalesced, rAF)
  │        ~~~~~~~~~~ window: appDb ahead, renderDb behind; ALL subs still read renderDb
  ├─ runtime/app-db.ts        flushSubscriptions(): renderDb advances, diff top-level keys
  ├─ runtime/subscriptions/engine.ts
  │                           roots refresh → rank-ordered settle → freeze → notify
  └─ react/use-subscription.ts
                              listeners fire → React re-renders → cache-only snapshot
```

`dispatchSync` runs the same path inline (handler + flush) instead of queueing.

## Module map

Paths in this document are relative to `src/`.

| Path                              | Responsibility                                                              |
| --------------------------------- | --------------------------------------------------------------------------- |
| `index.ts`                        | Combined explicit-runtime entrypoint                                        |
| `vanilla.ts` / `react.ts`         | React-free runtime and React-only public entrypoints                        |
| `contracts.ts`                    | Store-local runtime contract extraction and vector/result types             |
| `types.ts`                        | Public contracts and module-augmentation anchors                            |
| `runtime/runtime.ts`              | `createReflexRuntime`, modules, watches, restore/flush                      |
| `runtime/kernel.ts`               | Instance-owned runtime kernel, identity, and terminal lifecycle             |
| `core/*`                          | Environment, equality, Immer, logging, scheduling, tracing, and validation  |
| `runtime/app-db.ts`               | `appDb`/`renderDb`, coalesced flush, and changed-root publication           |
| `runtime/handlers.ts`             | Typed handler definitions and framework-owned handler baselines             |
| `runtime/event-metadata.ts`       | Per-event interceptor metadata                                              |
| `runtime/reset.ts`                | Cross-store clear coordination                                              |
| `runtime/subscriptions/engine.ts` | Reactive graph semantics: push waves, pull reads, and live lifecycle        |
| `runtime/subscriptions/cache.ts`  | Root metadata, canonical instances, reverse edges, leases, and sub config   |
| `runtime/subscriptions/keys.ts`   | Canonical query-key serialization and development validation                |
| `events/*`                        | Event registration/pipeline, routing, interceptors, effects, and coeffects  |
| `subscriptions/registration.ts`   | Root and computed subscription definitions                                  |
| `subscriptions/queries.ts`        | Graph construction, cache lookup, and imperative reads                      |
| `react/*`                         | `useSubscription` and hot-reload bindings; the only React-dependent modules |

See [`code-conventions.md`](./code-conventions.md) for ownership and dependency
rules for this tree.

## Event side

**`events/router.ts`**

| Item                  | What / why                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `EventQueue`          | Per-runtime FSM (`idle → scheduled → running → paused`). Events added during a run move to the next tick; idle waiters implement `flush()` |
| `dispatch(event)`     | Async: queue the event, return immediately                                                                                                 |
| `dispatchSync(event)` | Run handler + flush before returning. Rejected inside a handler, a computation, or a listener                                              |

**`events/registration.ts` and `events/pipeline.ts`**

| Item                                              | What / why                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regEvent(id, handler, options?)`                 | Register a pure handler. Prefer `{ coeffects, interceptors }`; coeffect specs become inject-interceptors. Legacy positional arrays remain supported |
| `handle(eventV)`                                  | Assemble the chain: `doFx → globals → custom → handler`, run it                                                                                     |
| `createEventHandlerInterceptor`                   | Builds the interceptor that runs the handler inside `produce`, captures `newDb` + `effects`, and emits patches only while tracing                   |
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

**`events/interceptors.ts`** — `execute(eventV, interceptors)`; `Context = { coeffects, previousDb, effects, queue, stack, newDb }`. `previousDb` is the immutable app-db generation captured at event start; `newDb` is the final Immer generation after the handler, or unset until it runs. `before` walks queue→stack, `after` unwinds the stack. Every `after` hook may compare the read-only db generations and append to the shared `effects` list. Hooks must not replace or mutate either db generation, or replace `effects`; `doFx` is the outermost unwind step, so it commits `newDb` before running the final list. Event traces record that final list, including effects contributed by interceptors.

**`events/effects.ts`** — `regEffect(id, handler)`. `doFxInterceptor` (after phase) commits `newDb` via `updateAppDb`, then invokes each effect handler; failures are isolated and tagged onto the event's trace. Built-ins: `DISPATCH`, `DISPATCH_LATER`. The router injects its `dispatch` function when composing these built-ins, so the write path has no `pipeline → effects → router → pipeline` module cycle.

**`events/coeffects.ts`** — `regCoeffect(id, handler)`. `getInjectCofxInterceptor(id, value?)` injects into `context.coeffects` before the handler runs. Built-ins: `NOW`, `RANDOM`.

## State

**`runtime/app-db.ts`** — every operation receives the explicit runtime kernel
that owns its state.

| Item                                                | What / why                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `appDb`                                             | Live write head. Events commit new generations here                             |
| `renderDb`                                          | Published read head. Every subscription reads this, never `appDb`               |
| `updateAppDb(newDb)`                                | Commit + schedule a flush. Consecutive events coalesce into one                 |
| `flushSubscriptions()`                              | Promote `renderDb`, diff top-level keys with `Object.is`, publish changed roots |
| `initAppDb(value)` / `getAppDb()` / `getRenderDb()` | Bootstrap and accessors                                                         |

Why two heads: between a commit and the flush, cached subscriptions and newly
mounting components must serve the **same** db generation. `renderDb` advances
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
| `regSub(id)` / `regSub(id, 'dbKey')`     | Root: reads one top-level db key from `renderDb`. No parameters allowed                                                                            |
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

- Every mutable db, queue, registry, cache, trace, and callback store is keyed
  by an explicit runtime kernel. Scheduled callbacks capture that kernel.
- `renderDb` advances **only** inside a publication. The flush is the single publication boundary.
- One canonical node per serialized query key. Duplicates are an error.
- Roots are persistent db anchors; computed cells are terminal and evicted when unused.
- A cached entry never retains a terminal dependency node.
- Compute and equality functions are pure. Reads, creates, and publications are rejected while the runtime is settling.
- Listeners are zero-argument invalidation signals; they read a settled snapshot themselves.
- Each publication: every changed root reads once, every affected cell computes at most once, every listener fires at most once.
