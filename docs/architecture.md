# Reflex architecture (compact spec)

One central db. Events are pure functions that describe a new db plus effects.
Effects are the only side effects. Subscriptions are a cached, reactive DAG
derived from the db. React reads subscriptions through `useSyncExternalStore`.

## End-to-end flow

```
dispatch(['todos/add', 'milk'])
  │
  ├─ router.ts        EventQueue (FSM) queues, runs on next tick, chunked
  ├─ events.ts        handle(): builds interceptor chain for this event id
  ├─ interceptor.ts   execute(): before phase (queue→stack), after phase (unwind)
  │     cofx inject → global interceptors → custom → event handler
  ├─ events.ts        handler(coeffects, ...params) runs inside immer produce
  │                   → context.newDb   (pure, no side effects)
  │                   → context.effects  [['http', {...}]]  (data, not calls)
  ├─ fx.ts            doFx (after phase): updateAppDb(newDb), then run effect handlers
  ├─ db.ts            appDb advances; flush scheduled (coalesced, rAF)
  │        ~~~~~~~~~~ window: appDb ahead, renderDb behind; ALL subs still read renderDb
  ├─ db.ts            flushSubscriptions(): renderDb advances, diff top-level keys
  ├─ runtime          publishWave(): roots refresh → rank-ordered settle → freeze → notify
  └─ hook.ts          listeners fire → React re-renders → getSnapshot (cache-only)
```

`dispatchSync` runs the same path inline (handler + flush) instead of queueing.

## Module map

| File | Responsibility |
| --- | --- |
| `router.ts` | Event queue (FSM), `dispatch` / `dispatchSync` |
| `events.ts` | `regEvent`, chain assembly, pure handler inside immer |
| `interceptor.ts` | Generic before/after interceptor machine |
| `fx.ts` | `regEffect`, `doFx` — commits db, executes effects |
| `cofx.ts` | `regCoeffect` — injects inputs (now, random) into handlers |
| `db.ts` | `appDb` (write head), `renderDb` (read head), flush + root diff |
| `subscription-runtime.ts` | The reactive graph: push waves, pull reads, lifecycle |
| `subs.ts` | `regSub`, graph construction from the registry, query keys |
| `registrar.ts` | All registries: handlers, subscription cache, lifecycle metadata |
| `hook.ts` | `useSubscription` — the React binding |
| `schedule.ts` | `scheduleAfterRender` (rAF + fallback), `scheduleNextTick` |
| `trace.ts` | Trace pipeline consumed by devtools |
| `settings.ts` | Global interceptors, global equality check |
| `equality.ts` `immer-utils.ts` `debounce.ts` `loggers.ts` `env.ts` `hot-reload.ts` | Support |

## Event side

**`router.ts`**

| Item | What / why |
| --- | --- |
| `EventQueue` | FSM (`idle → scheduled → running → paused`). Chunks processing across ticks so a burst can't block the frame |
| `dispatch(event)` | Async: queue the event, return immediately |
| `dispatchSync(event)` | Run handler + flush before returning. Rejected inside a handler, a computation, or a listener |

**`events.ts`**

| Item | What / why |
| --- | --- |
| `regEvent(id, handler, cofx?, interceptors?)` | Register a pure handler; cofx specs become inject-interceptors |
| `handle(eventV)` | Assemble the chain: `doFx → globals → custom → handler`, run it |
| `eventHandlerInterceptor` | Runs the handler inside `produce`; captures `newDb` + `effects`. Patches only produced when tracing is on |
| `getHandlingEventId` / `getRunningHandlerEventId` | Reentrance guards (`dispatchSync` refusal, dev `dispatch`-in-handler warning) |
| `regEventErrorHandler` | Single catch-all for exceptions in the chain |

**`interceptor.ts`** — `execute(eventV, interceptors)`; `Context = { coeffects, effects, queue, stack, newDb }`. `before` walks queue→stack, `after` unwinds the stack.

**`fx.ts`** — `regEffect(id, handler)`. `doFxInterceptor` (after phase) commits `newDb` via `updateAppDb`, then invokes each effect handler; failures are isolated and tagged onto the event's trace. Built-ins: `DISPATCH`, `DISPATCH_LATER`.

**`cofx.ts`** — `regCoeffect(id, handler)`. `getInjectCofxInterceptor(id, value?)` injects into `context.coeffects` before the handler runs. Built-ins: `NOW`, `RANDOM`.

## State

**`db.ts`**

| Item | What / why |
| --- | --- |
| `appDb` | Live write head. Events commit new generations here |
| `renderDb` | Published read head. Every subscription reads this, never `appDb` |
| `updateAppDb(newDb)` | Commit + schedule a flush. Consecutive events coalesce into one |
| `flushSubscriptions()` | Promote `renderDb`, diff top-level keys with `Object.is`, publish changed roots |
| `initAppDb(value)` / `getAppDb()` / `getRenderDb()` | Bootstrap and accessors |

Why two heads: between a commit and the flush, cached subscriptions and newly
mounting components must serve the **same** db generation. `renderDb` advances
only inside a publication, which is what makes the flush the single publication
boundary.

## Subscription runtime

**`subscription-runtime.ts`** — owns graph semantics only (no keys, no registry).

`SubscriptionCell` fields:

| Field | What / why |
| --- | --- |
| `value` / `error` / `hasValue` / `hasError` | Cached result. Errors are retained state, rethrown on read |
| `outputStamp` | Bumped only on an observable change. The unit of staleness |
| `dependencyStamps` | Stamps seen at last compute → recompute only if one moved |
| `rank` | `0` for roots, else `1 + max(dep ranks)`. Fixed at construction; drives wave order |
| `active` | Has listeners or active dependents. Inactive cells get zero work in a wave |
| `disposed` | Terminal computed cell. Reads/subscribes throw; reacquire by key |
| `listeners` / `dependents` | Live edges, maintained by activation/release |
| `validatedEpoch` / `lastPullEpoch` / `queuedWave` | Memoization and dedup markers |

`SubscriptionRuntime` operations:

| Op | What / why |
| --- | --- |
| `publishWave(roots)` (push) | Refresh changed roots, settle the live graph in rank order (dedup by `queuedWave`), freeze listener lists, notify. Every listener sees one settled generation |
| `pull(target)` | Iterative post-order read path for dormant/fresh cells. Stops at any active+validated cell. Epoch-memoized → repeated reads are O(1) between publications |
| `activate(cell)` | Bottom-up, transactional. Links dependency edges, fires `onActive`; rolls back fully if a hook throws |
| `releaseUnused(cell)` | Cascade down; stops at any cell that still has listeners or dependents. Computed → disposed + evicted; roots → deactivated only |
| `phase` (`idle`/`settling`/`notifying`) | Guards: no reads, creates, or publications during computation; no publication during listener delivery |
| `inspectSubscription(node)` | Cache-only DTO for devtools. Never computes |

Public ops: `createSubscription`, `readSubscription`, `getSubscriptionSnapshot`,
`subscribeToSubscription`, `publishSubscriptions`. Nodes are opaque
(`SubscriptionNode<T>`) — the runtime never hands out mutable cells.

**`subs.ts`**

| Item | What / why |
| --- | --- |
| `regSub(id)` / `regSub(id, 'dbKey')` | Root: reads one top-level db key from `renderDb`. No parameters allowed |
| `regSub(id, computeFn, depsFn, config?)` | Computed: static dependency vectors from `depsFn(...params)` |
| `getOrCreateSubscription(vector)` | Builds (or reuses) the whole graph. Iterative — `frames` is an explicit DFS stack, so depth can't blow the JS stack. `buildingKeys` detects cycles |
| `getSubVectorKey(vector)` | `JSON.stringify` — the canonical cache key. Dev-warns on params that don't survive serialization |
| `getSubscriptionValue(vector)` | Imperative one-shot read (services, headless, devtools) |

**`registrar.ts`** — every registry, plus the caching policy the runtime knows
nothing about: handler definitions, root anchoring, the instance cache with
reverse edges, and provisional leases. See
[`subscription-registry.md`](./subscription-registry.md).

**`hook.ts`** — `useSubscription(vector, componentName?)`. Wraps
`useSyncExternalStore`; store bindings are memoized on the serialized key, and
the node is **re-resolved by key** on every `subscribe`/`getSnapshot` (never
captured), which is what makes terminal computed cells safe under StrictMode,
Suspense, and remounts.

## Support

| Item | What / why |
| --- | --- |
| `scheduleAfterRender(f)` | rAF, with a 100 ms timeout fallback — a hidden tab must not stall flushes forever |
| `scheduleNextTick(f)` | `setImmediate` (RN) / `MessageChannel` (web) — splits event processing into chunks |
| `withTrace` / `mergeTrace` / `registerTraceCb` | Trace pipeline. opTypes: `event`, `sub/create`, `sub/run`, `sub/dispose`, `render`. Tag `subscriptionKey` identifies the instance |
| `setGlobalEqualityCheck` / `regGlobalInterceptor` | App-wide defaults |
| `shallowEqual` | Opt-in equality check; default is deep equality |
| `debounceAndDispatch` / `throttleAndDispatch` | Rate-limited dispatch |
| `IS_DEV` | Gates dev warnings and patch generation |

## Invariants

- `renderDb` advances **only** inside a publication. The flush is the single publication boundary.
- One canonical node per serialized query key. Duplicates are an error.
- Roots are persistent db anchors; computed cells are terminal and evicted when unused.
- A cached entry never retains a terminal dependency node.
- Compute and equality functions are pure. Reads, creates, and publications are rejected while the runtime is settling.
- Listeners are zero-argument invalidation signals; they read a settled snapshot themselves.
- Each publication: every changed root reads once, every affected cell computes at most once, every listener fires at most once.
