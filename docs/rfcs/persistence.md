# RFC: `@ukladjs/persist` — persistence as Uklad primitives

- **Status:** sync and async implementation complete in [packages/persist](../../packages/persist); native dogfood fixtures live in [examples/react-native-persist](../../examples/react-native-persist) and [examples/expo-persist](../../examples/expo-persist)
- **Last updated:** 2026-08-26
- **Depends on:** the instance-scoped runtime ([instance-scoped-runtime.md](instance-scoped-runtime.md)) plus the generic post-handler/effect guarantees shipping in `@ukladjs/core@0.2.0`; Uklad must be published before this initial release
- **Roadmap slot:** Phase 3, "Persistence + versioned migrations" ([Uklad roadmap](../roadmaps/uklad.md))

Two earlier drafts (method-driven, then dispatch-driven with a whole-state envelope and `partialize`) are superseded. An expert review of the second draft surfaced six findings; rather than patch each one, the scope was reset to the actual problem, which dissolves most of them — the rest are tracked under **Beyond the async release** below.

## The whole spec

1. When the caller explicitly hydrates (normally before the first render), overlay stored root entries onto state.
2. Configured root keys are written to storage when they change.

## Architectural boundary

`@ukladjs/persist` is an ordinary external consumer of Uklad, not a privileged integration. It may own persistence-specific machinery such as adapters, migrations, queues, retries, barriers, and its public handle API, but every interaction with a runtime goes through documented public `@ukladjs/core` APIs: events, effects, coeffects, global interceptors, subscriptions, and `registerModule()` lifecycle. It must not import Uklad internals, access private registries or pipeline state, mutate internal state heads, or require persistence-specific behavior in Uklad core.

If persistence exposes a missing capability, Uklad may add a generic public primitive useful to any library; it must not add a special `uklad-persist` hook. Uklad therefore exposes the bounded `getRuntimeIntegration()` facade for libraries that own runtime-wide interceptors and synchronous lifecycle dispatch without widening the application runtime client. `PersistHandle` is the primary typed and lifecycle-aware API, while public persist event IDs remain an optional low-level protocol for direct dispatch, DevTools, MCP, and composition. Both routes must produce the same observable Uklad state transitions.

## Design: integration through public primitives

The library expresses its observable work through primitives Uklad already ships — ordinary handlers plus one registered global interceptor, with no private pipeline hooks:

| Kind        | Id                       | Role                                                                                                                               |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| event       | `uklad-persist/attach`   | internal: publishes a fresh attachment-scoped `'idle'` gate                                                                        |
| event       | `uklad-persist/hydrate`  | public: sync storage uses a coeffect-injected snapshot and publishes roots + terminal status atomically                            |
| event       | `uklad-persist/purge`    | public recovery control; removes configured entries through an effect                                                              |
| event       | `loaded` / `failed`      | generation-authenticated internal completions for async hydration; excluded from the public contract                               |
| interceptor | `uklad-persist/writer`   | global `after`: contributes a write effect per configured root the causing event changed                                           |
| effect      | `uklad-persist/write`    | serializes the exact committed root snapshot captured by the interceptor and calls `storage.setItem` — post-commit by construction |
| effect      | `complete` / `settle`    | authenticated internal lifecycle effects; make handle and raw-dispatch barriers equivalent                                         |
| coeffect    | `uklad-persist/snapshot` | catches all synchronous reads and injects a staged success/failure snapshot                                                        |
| sub         | `uklad-persist`          | status root: `'idle' \| 'hydrating' \| 'hydrated' \| 'failed'`                                                                     |

**Keys are state root keys — and the writer is an interceptor, not a watch.** The first dogfood iteration watched each key's subscription and dispatched a `store` event on change. That design had a causality hole found immediately in TodoMVC's traces: hydration itself changes the keys, the watches fire, and the just-read snapshot is echoed straight back to storage — a value watch knows _that_ a key changed but never _why_. The writer interceptor sees `coeffects.event`, so it skips persistence protocol events by identity, detects root changes with `Object.is` against the not-yet-committed previous state head, captures the new root value, and contributes `['uklad-persist/write', { key }]` effects to the causing event. Effects execute in `do-fx` after the commit, and the write effect serializes that captured snapshot — so writes stay post-commit, a serialization error cannot abort an application event, and each write is attributed to the event that caused it in the trace log. Keys do not need registered subscriptions.

```ts
const handle = persist(runtime, {
  storage: localStorageAdapter(),
  keys: ['todos', 'settings'], // state root keys
  version: 2,
  migrate: (key, data, from) => …,
});

runtime.dispatchSync(['uklad-persist/hydrate']); // terminal before this returns
// handle.hydrate() is primary; active/successful calls are no-ops, failures retry

useSubscription(['uklad-persist']); // status, like any other state
```

The runtime argument is mandatory: `persist(runtime, options)`. Applications pass
the explicit runtime they own. Making it explicit keeps the attachment target
visible at the call site and prevents persistence from depending on ambient
process-global state.

`whenHydrated()` involves no subscription watch either. Every terminal hydration event returns an internal completion effect, which runs after the state commit and settles waiters created through either the handle or direct-dispatch route. `dispose()` and runtime disposal use the module installer's same cleanup callback and deterministically reject pending waiters. Queued storage work is cancelled; already-started native calls retain the attachment fence until they settle, so `await dispose()` is the safe reattachment boundary. The library uses `watchSubscription` nowhere.

## Storage layout

One entry per key: `<prefix>/<percent-encoded-root-key>` → `{"v":<configured-version>,"data":…}` (prefix defaults to `uklad`; version defaults to `1`). The envelope is a non-null object with own `v` and `data` fields; `v` is a positive safe integer. Consequences:

- A change to `todos` writes only `todos` — no whole-state blob, no `partialize` concept.
- The envelope carries `v` from day one. `migrate(key, data, fromVersion)` runs on serialized data only when `fromVersion < version`; future versions fail without calling it. Current-version `deserialize` runs afterward.
- Hydration stages every entry before publication. Corrupt or unmigratable entries are skipped and good keys may still overlay their roots, but status becomes `'failed'`, writes stay closed, and **no** migration rewrite runs when any entry failed. A migrated rewrite that itself fails is reported and retries next boot.
- Deleting a configured root or setting it to `undefined` removes its entry; a serializer returning `undefined` is an error.
- Transform output is recursively checked for lossless JSON data, and the encoded envelope is parsed and validated again before storage is touched. `toJSON`, sparse arrays, cycles, non-finite numbers, and non-plain objects fail closed.

## Boot flows

- **Sync flow — browser CSR or synchronous key-value storage**: attach publishes `'idle'`; `dispatchSync(['uklad-persist/hydrate'])` reads, validates, migrates, overlays roots, and reaches `'hydrated'` or `'failed'` before returning. Applications must hydrate before domain events that may change persisted roots.
- **Async flow — React Native, Expo, or another promise-based adapter**: attach publishes `'idle'`; `handle.hydrate()` publishes `'hydrating'`, reads all entries, and applies a generation-authenticated terminal completion. A failed attempt may be retried; stale completions are ignored. The package does not block domain events during this interval, so applications gate events that change persisted roots until hydration succeeds. Async writes are ordered per key and `handle.flush()` provides a durability barrier; a failed write remains visible until a later successful operation for that root supersedes it.
- **Failure**: read/parse/validate/migrate/deserialize failure publishes `'failed'`, rejects `whenHydrated()`, preserves every original storage entry, and keeps writes closed. `await handle.purge()` removes configured entries and changes the current state into the source for future writes only when every removal succeeds.
- **Outside this contract**: SSR publication semantics, custom merge, and SecureStore-specific secret handling remain deferred. The compatibility `experimentalAsync: true` option is accepted as a no-op for applications that used the earlier prototype.

## What the idiom buys

- **Persistence intent is in the log and attributed to its cause.** Hydration is an event, and each write effect rides on the event that changed the key — the trace answers "this `todos/add` requested a write of `todos`" directly. Storage success or failure is reported separately through sanitized diagnostics.
- **Post-commit writes by construction.** The writer interceptor only contributes effects; effects execute in `do-fx` after the commit, and the write effect serializes the captured committed snapshot. Persistence can neither abort an application event nor capture uncommitted state — the strongest expert finding, resolved structurally.
- **The write gate is deliberately dual**: observable post-event status must be `'hydrated'`, and the attachment-scoped lifecycle must also be hydrated. The latter prevents a disposed attachment's stale state status from opening writes after reattach.
- **Write coalescing is contained**: the per-key coordinator replaces only
  writes that have not started. Active storage calls and purge barriers remain
  ordered, while every accepted ticket retains its durability semantics.

## Feature parity: Redux Persist and Zustand persist

Legend: ✅ has it · ⚠️ partial, indirect, or prototype quality · ❌ missing. Baseline checked 2026-07-19 against the [Redux Persist README](https://github.com/rt2zz/redux-persist#readme) and [Zustand persist documentation](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data). This is a behavioral benchmark, not a requirement to copy either API.

| Feature                             | Redux Persist (usual RTK pairing)                  | Zustand `persist`                                     | `uklad-persist` v0                                         | Direction                                                                                      |
| ----------------------------------- | -------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Basic persist + rehydrate           | ✅ `persistReducer` + `persistStore`               | ✅ `persist` middleware                               | ✅ root-key writer + hydrate events                        | Keep the Uklad-native protocol; harden failure and lifecycle paths before publishing           |
| Selective / partial persistence     | ✅ allowlist, denylist, nested persists            | ✅ `partialize`                                       | ✅ configured root keys stored as independent entries      | Root keys are the core model; use per-key transforms for deeper projection                     |
| Sync and async storage              | ✅ Promise-based storage engines; web/RN ecosystem | ✅ sync or async custom storage                       | ✅ sync and AsyncStorage-compatible adapters               | Keep the core adapter-neutral; SecureStore remains deferred                                    |
| Manual / deferred hydration         | ✅ `manualPersist` + `persistor.persist()`         | ✅ `skipHydration` + `rehydrate()`                    | ✅ `handle.hydrate()` or public hydrate event              | Keep raw dispatch as low-level protocol and `PersistHandle` as the primary API                 |
| Hydration status and barrier        | ✅ callback, `PersistGate`, `bootstrapped`         | ✅ `hasHydrated`, callbacks, lifecycle listeners      | ✅ status subscription + causal `whenHydrated()`           | Keep generation semantics and retry-after-failure behavior                                     |
| Versioned migrations                | ✅ `version`, `migrate`, `createMigrate`           | ✅ `version` + `migrate`                              | ✅ validated per-entry version, migrate, and rewrite       | Add migration registries only if real schemas demonstrate the need                             |
| Custom merge / reconciliation       | ✅ configurable state reconcilers                  | ✅ `merge`                                            | ❌ hydrated root currently replaces the initial root       | Add per-key custom merge without changing the event/effect architecture                        |
| Serialization transforms            | ✅ inbound/outbound `createTransform`              | ✅ replacer/reviver or custom storage                 | ✅ per-key `serialize` / `deserialize`                     | Keep; add optional validation helpers rather than hiding schema policy                         |
| Multiple / nested configurations    | ✅ nested persists                                 | ✅ one middleware/config per store                    | ❌ fixed IDs; one attachment per runtime                   | Reject duplicates now; introduce a runtime coordinator only when multiple configs are required |
| Runtime control API                 | ✅ purge, flush, pause, resume                     | ⚠️ clear, rehydrate, inspect/change options           | ✅ hydrate, whenHydrated, purge, flush, dispose            | Keep the small explicit handle; do not copy mutable options blindly                            |
| Async write ordering and durability | ✅ queued writes + `flush()`                       | ⚠️ async writes, no durability barrier                | ✅ per-key queues + `flush()`                              | Preserve per-key ordering and independent-key concurrency                                      |
| SSR hydration control               | ⚠️ manual start / React gate; adapter-dependent    | ✅ lazy storage + `skipHydration`                     | ❌ explicitly outside the initial-release product contract | Define CSR/SSR publication semantics and add an example before claiming SSR support            |
| Corrupt-data and failure policy     | ⚠️ transform/config dependent                      | ⚠️ callback receives errors; default JSON unvalidated | ✅ partial publication + closed writes + purge recovery    | Add retry attempts only after the async attempt model is defined                               |
| Secure storage and redaction        | ⚠️ community adapters/transforms                   | ⚠️ custom storage/transforms                          | ❌                                                         | Add SecureStore only with an opaque/redacted diagnostic design                                 |
| Store isolation and disposal        | ✅ persistor belongs to one Redux store            | ⚠️ store-local, no persist-specific disposer          | ✅ explicit owner, shared cleanup, safe reattach           | Add multiple configurations only behind a coordinator                                          |
| Types across the library boundary   | ⚠️ TypeScript definitions                          | ✅ typed middleware and storage                       | ✅ typed keys/transforms + `PersistContracts`              | Retain packed strict-consumer tests as a release gate                                          |
| DevTools / causal observability     | ⚠️ persistence actions visible in Redux DevTools   | ⚠️ middleware is mostly opaque                        | ✅ final WRITE effect attributed to causing event          | Extend structured durability/error traces with async support                                   |

## Initial delivery plan

The implementation keeps one protocol for sync and async storage. The release gates below document the safety guarantees that must remain true as adapters and native fixtures evolve.

> **Initial-release safety invariant:** no storage error, corrupt snapshot, migration, repeated hydration, disposal, or reordering of async completions may silently overwrite newer persisted data or leave a hydration barrier unsettled.

### `0.1.0` — sync foundation

Scope: browser CSR, synchronous localStorage, memory storage for tests, one `persist()` attachment per runtime, configured root keys, synchronous migrations, and per-key serialization transforms. The async-capable implementation below extends this foundation without changing the root-key protocol. Custom merge, SSR, SecureStore, and multiple configurations remain outside this contract.

#### Runtime correctness

- [x] Convert thrown sync `getItem` errors into the normal failed-hydration transition; startup does not throw and every waiter settles.
- [x] Stage every entry through migrate + deserialize and suppress all migration rewrites if any hydration entry failed; rewrites remain post-publication effects.
- [x] Validate envelope ownership/shape and positive safe-integer versions; reject malformed or future-version entries without backward migration.
- [x] Make `handle.hydrate()`, `runtime.dispatch([PERSIST_IDS.HYDRATE])`, and `runtime.dispatchSync([PERSIST_IDS.HYDRATE])` produce the same observable transitions and settle causal waiters.
- [x] Define the hydration state machine: attach → `idle`; active or successful repeated requests are idempotent; failed attempts may retry; successful purge is explicit recovery into `hydrated`.
- [x] Reject duplicate/empty/reserved keys, invalid versions, protocol collisions, and a second attachment before installation.
- [x] Make handle disposal and runtime disposal share module cleanup; pending work settles, late reads are ignored, and active storage calls fence reattachment until `dispose()` resolves.
- [x] Preserve no-hydration-echo and write/remove exactly configured roots whose identities changed according to `Object.is`.
- [x] Authenticate library-owned events/effects, validate completion payloads, and settle handle operations when Uklad drops queued lifecycle work after an earlier event failure.

#### Failure and recovery

- [x] Use a fail-closed storage policy: valid roots may publish, but any read/parse/validate/migrate/deserialize failure leaves all original entries untouched, publishes failed status, and closes writes.
- [x] Expose failed status and `purge()` recovery in TodoMVC instead of remaining silently non-persistent.
- [x] Report sanitized key/phase/code diagnostics without raw values or user-thrown messages.
- [x] Report each failed async purge removal exactly once through the terminal protocol event.

#### Uklad and public API contract

- [x] Document and test the generic Uklad guarantees consumed here: `newState` is read-only after the handler, interceptors append to (not replace) the shared effect list, and `do-fx` commits before executing it.
- [x] Include final interceptor-contributed effects in the causing event's trace and assert the writer's exact WRITE tuple.
- [x] Keep `PersistHandle` primary and ship `PersistContracts<T>` for strict raw hydrate/purge/status use; internal completion events stay outside that contract.
- [x] Enforce the architectural boundary with imports only from the public `@ukladjs/core/vanilla` entrypoint and no persist-specific core hook.

#### Product and release gates

- [x] Scope TodoMVC event and subscription HMR cleanup to module-owned IDs so persistence registrations survive either module's replacement.
- [x] Add a TodoMVC integration flow: preload envelope → hydrate → mutate → one root write → reload restores its `Map`.
- [x] Cover unavailable localStorage, corrupt JSON/deserialize, lossy transforms, migration atomicity, forged internals, queue drops, direct dispatch, duplicate attach, disposal, reattach, purge, and diagnostics in acceptance tests.
- [x] Build `uklad-persist` after Uklad and before TodoMVC; include package checks, coverage, and tarball dry-run in CI.
- [x] Test the actual tarball as ESM and CJS with TS6/TS7 and a separately packed Uklad peer.
- [x] Compile strict contract/key/transform examples against public types and limit README claims to supported `0.1.0` behavior.

### Async-capable implementation gates

#### Hydration state machine

- [x] Add an explicit attempt/generation ID and define `idle → hydrating → hydrated | failed` transitions.
- [x] Permit only one active attempt; stale `loaded`/`failed` completions never publish.
- [x] Bind `whenHydrated()` to the active attempt, support retry after failure, and ignore late completions after disposal.
- [x] Keep domain dispatch available but require an application barrier for events that change persisted roots until hydration succeeds; custom concurrent merge remains a later concern.

#### Ordered writes and durability

- [x] Serialize writes per storage key so completion order cannot allow an older value to overwrite a newer one; independent keys may progress concurrently.
- [x] Capture the exact committed snapshot represented by each queued write rather than reading an unrelated future state head.
- [x] Coalesce only writes that have not started, preserve last-write-wins, and keep the queue usable after an individual write failure.
- [x] Add `handle.flush(): Promise<void>` that waits for every write accepted before the call; `runtime.flush()` remains only an event-queue boundary.
- [x] Add structured persist-error reporting and define `dispose()` behavior for queued, active, and awaited writes without an implicit hidden flush.
- [x] Prune recovered failure windows once no active `flush()` snapshot can observe them, bounding lifetime history by unresolved roots and active barriers.
- [x] Make async `purge()` ordered relative to pending writes so an older queued write cannot recreate purged data.

#### Adapter and race gates

- [x] Ship an AsyncStorage-like adapter and cover read, write, and remove rejection. Optional `multiGet` remains additive.
- [x] Deterministically test ordered writes, failure in the middle of a queue, disposal, purge with pending writes, and `flush()`.
- [x] Verify two native-style runtimes with different adapter instances and prefixes remain isolated in package CI, and production-bundle both Android fixtures in CI.
- [x] Dogfood the async route in small React Native and Expo fixtures.

#### Maintainability

- [x] Keep async storage ordering in a dedicated coordinator and hydration/purge generations and waiters in an explicit lifecycle controller.
- [x] Keep persistence on the public `@ukladjs/core/vanilla` integration surface; the compatibility `internal` re-export is not required by the package.

## Beyond the async release

| Deferred feature                    | Why it is not an initial-release prerequisite                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Custom per-key merge                | Additive once the default application-barrier publication model is proven                                                       |
| SecureStore + redacted diagnostics  | Requires an opaque staging and observability design; persisted secret values must never appear in traces or errors              |
| Full SSR integration + React gate   | The sync initial release is CSR-only; async semantics come first                                                                |
| Multiple configs per runtime        | The initial release rejects duplicates; add a runtime coordinator when a real second-config use case exists                     |
| `restoreState` coordination         | Document as unsupported during initial-release persistence activity, then define attempt/write-gate interaction from real usage |
| Pause/resume and mutable options    | Not needed for correctness; avoid copying competitor APIs without a demonstrated Uklad use case                                 |
| Throttling and background lifecycle | Additive over the ordered per-key queue after durability is correct                                                             |
| Adapter batching (`multiGet`)       | Performance optimization that must not shape the minimum adapter contract                                                       |

## Prototype findings and release hardening

The spike graduated into the package: its scenarios and release regressions live in [packages/persist/src/tests/persist.test.ts](../../packages/persist/src/tests/persist.test.ts), including the Map round trip discovered by TodoMVC. Persistence itself still uses only public Uklad APIs. Release hardening added generic Uklad guarantees—not persistence hooks—for read-only post-handler `newState`, append-only interceptor effects, module cleanup ordering, and final-effect trace capture.

1. Happy-path sync route: one synchronous `dispatchSync` hydrates, overlays roots, migrates, and re-stores migrated keys via post-commit write effects — zero awaits.
2. Per-key writes: changing one configured key writes exactly one storage entry; unconfigured keys never write.
3. Async hydration publishes a closed `hydrating` gate, then a generation-authenticated terminal status; a pre-hydration change produces no write, so the stored snapshot survives the read window.
4. Thrown sync reads and rejected async reads both set failed status, reject `whenHydrated()`, report sanitized diagnostics, and keep writes gated.
5. Hydration appears as ordinary events, and the final trace for the causing domain event contains the exact interceptor-contributed WRITE effect.
6. Applications use the explicit runtime API (`runtime.registerModule()` and
   `runtime.dispatch()`); persistence never discovers a runtime implicitly.
7. Handle/runtime disposal share cleanup; pending barriers reject, late reads are ignored, duplicate attachment is rejected, and reattach starts with a closed idle gate.
8. Hydration-echo regression: hydrating stored values performs zero writes — the bug the watch-based writer shipped with (see Dogfood notes) cannot recur silently.

Calibration: the suite establishes sync failure atomicity, async lifecycle parity, ordered and coalesced writes, exact latest snapshots, multi-runtime native-style isolation, direct-dispatch barriers, recovery, trace finalization, strict typing, and separately packed ESM/CJS consumption with TS6/TS7. React Native and Expo Android production bundles are CI gates; emulator/device execution and SSR publication semantics remain outside this package check.

## Dogfood notes (TodoMVC, 2026-07-18)

- Real state values are not always JSON-safe (TodoMVC's `todos` is a `Map`) — config keys accept per-key `serialize`/`deserialize` transforms.
- Replacing the hand-rolled persistence deleted the `local-store-todos` coeffect, the `todos-to-local-store` effect, and a storage-effect return from six event handlers; `INIT_APP` became unnecessary. Handlers now never mention storage.
- Monorepo examples that alias `@ukladjs/core` to source must also alias the `/vanilla` subpath and `@ukladjs/persist` itself — otherwise the bundle carries two uklad copies and persistence attaches to the wrong default runtime ([examples/todomvc/vite.config.ts](../../examples/todomvc/vite.config.ts)).
- Verified in-browser: add todo → per-key envelope written; reload → hydrated before first paint; toggle done → stored with zero storage code in the handler.
- **The watch-based writer shipped with an echo bug**, spotted in the trace log on the first real boot with stored data: hydration changed `todos`, the value watch fired, and a `store` event wrote the just-read snapshot straight back. Value watches lack causality — they see _that_ a key changed, never _why_. The writer became a global interceptor (event identity → hydration skipped by construction), which also moved writes onto the causing event's trace and dropped the extra `store` event and the "keys must be sub ids" requirement.

## `0.1.0` decisions

1. **Hydrate before domain events.** Writes are closed in `idle`, so a pre-hydration root change is not persisted; the active hydration attempt may then replace that root with its stored value. Applications must hydrate before first render and before events that change configured roots. There is no hidden reconcile write.
2. **Storage namespaces are explicit.** Root-key components are percent-encoded. Runtimes intended to be isolated on the same storage backend must use distinct non-empty prefixes; using the same prefix deliberately addresses the same entries.
3. **`restoreState()` is unsupported while persistence is attached.** Restore bypasses events and can forge/remove observable status. Dispose persistence first, restore at a legal runtime boundary, then reattach and hydrate.
