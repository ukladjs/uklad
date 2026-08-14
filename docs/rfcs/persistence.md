# RFC: `@ukladjs/persist` — persistence as Uklad primitives

- **Status:** `0.1.0` release candidate implemented in [packages/persist](../../packages/persist) (unpublished) and dogfooded in [examples/todomvc]; the release gates below are authoritative
- **Last updated:** 2026-08-10
- **Depends on:** the instance-scoped runtime ([instance-scoped-runtime.md](instance-scoped-runtime.md)) plus the generic post-handler/effect guarantees shipping in `@ukladjs/core@0.2.0`; Uklad must be published before this initial release
- **Roadmap slot:** Phase 3, "Persistence + versioned migrations" ([Uklad roadmap](../roadmaps/uklad.md))

Two earlier drafts (method-driven, then dispatch-driven with a whole-state envelope and `partialize`) are superseded. An expert review of the second draft surfaced six findings; rather than patch each one, the scope was reset to the actual problem, which dissolves most of them — the rest are tracked under **Beyond the async release** below.

## The whole spec

1. When the caller explicitly hydrates (normally before the first render), overlay stored root entries onto state.
2. Configured root keys are written to storage when they change.

## Architectural boundary

`@ukladjs/persist` is an ordinary external consumer of Uklad, not a privileged integration. It may own persistence-specific machinery such as adapters, migrations, queues, retries, barriers, and its public handle API, but every interaction with a runtime goes through documented public `@ukladjs/core` APIs: events, effects, coeffects, global interceptors, subscriptions, and `registerModule()` lifecycle. It must not import Uklad internals, access private registries or pipeline state, mutate internal state heads, or require persistence-specific behavior in Uklad core.

If persistence exposes a missing capability, Uklad may add a generic public primitive useful to any library; it must not add a special `uklad-persist` hook. `PersistHandle` is the primary typed and lifecycle-aware API, while public persist event IDs remain an optional low-level protocol for direct dispatch, DevTools, MCP, and composition. Both routes must produce the same observable Uklad state transitions.

## Design: integration through public primitives

The library expresses its observable work through primitives Uklad already ships — ordinary handlers plus one registered global interceptor, with no private pipeline hooks:

| Kind        | Id                        | Role                                                                                                    |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| event       | `uklad-persist/attach`   | internal: publishes a fresh attachment-scoped `'idle'` gate                                             |
| event       | `uklad-persist/hydrate`  | public: sync storage uses a coeffect-injected snapshot and publishes roots + terminal status atomically |
| event       | `uklad-persist/purge`    | public recovery control; removes configured entries through an effect                                   |
| event       | `loaded` / `failed`       | authenticated internal completions for the experimental async route; excluded from the public contract  |
| interceptor | `uklad-persist/writer`   | global `after`: contributes a write effect per configured root the causing event changed                |
| effect      | `uklad-persist/write`    | serializes one root from the committed state and calls `storage.setItem` — post-commit by construction  |
| effect      | `complete` / `settle`     | authenticated internal lifecycle effects; make handle and raw-dispatch barriers equivalent              |
| coeffect    | `uklad-persist/snapshot` | catches all synchronous reads and injects a staged success/failure snapshot                             |
| sub         | `uklad-persist`          | status root: `'idle' \| 'hydrating' \| 'hydrated' \| 'failed'`                                          |

**Keys are state root keys — and the writer is an interceptor, not a watch.** The first dogfood iteration watched each key's subscription and dispatched a `store` event on change. That design had a causality hole found immediately in TodoMVC's traces: hydration itself changes the keys, the watches fire, and the just-read snapshot is echoed straight back to storage — a value watch knows _that_ a key changed but never _why_. The writer interceptor sees `coeffects.event`, so it skips persistence protocol events by identity, detects root changes with `Object.is` against the not-yet-committed previous state head, and contributes `['uklad-persist/write', { key }]` effects to the causing event. Effects execute in `do-fx` after the commit, and the write effect serializes from the committed state — so writes stay post-commit, a serialization error cannot abort an application event, and each write is attributed to the event that caused it in the trace log. Keys do not need registered subscriptions.

```ts
const handle = persist(runtime, {
  storage: localStorageAdapter(),
  keys: ['todos', 'settings'], // state root keys
  version: 2,
  migrate: (key, data, from) => …,
});

runtime.dispatchSync(['uklad-persist/hydrate']); // terminal before this returns
// handle.hydrate() is the primary typed form; repeated calls are no-ops

useSubscription(['uklad-persist']); // status, like any other state
```

The runtime argument is mandatory: `persist(runtime, options)`. Applications pass
the explicit runtime they own. Making it explicit keeps the attachment target
visible at the call site and prevents persistence from depending on ambient
process-global state.

`whenHydrated()` involves no subscription watch either. Every terminal hydration event returns an internal completion effect, which runs after the state commit and settles waiters created through either the handle or direct-dispatch route. `dispose()` and runtime disposal use the module installer's same cleanup callback, deterministically reject pending waiters, and ignore late experimental async completions. The library uses `watchSubscription` nowhere.

## Storage layout

One entry per key: `<prefix>/<percent-encoded-root-key>` → `{"v":<configured-version>,"data":…}` (prefix defaults to `uklad`; version defaults to `1`). The envelope is a non-null object with own `v` and `data` fields; `v` is a positive safe integer. Consequences:

- A change to `todos` writes only `todos` — no whole-state blob, no `partialize` concept.
- The envelope carries `v` from day one. `migrate(key, data, fromVersion)` runs on serialized data only when `fromVersion < version`; future versions fail without calling it. Current-version `deserialize` runs afterward.
- Hydration stages every entry before publication. Corrupt or unmigratable entries are skipped and good keys may still overlay their roots, but status becomes `'failed'`, writes stay closed, and **no** migration rewrite runs when any entry failed. A migrated rewrite that itself fails is reported and retries next boot.
- Deleting a configured root or setting it to `undefined` removes its entry; a serializer returning `undefined` is an error.
- Transform output is recursively checked for lossless JSON data, and the encoded envelope is parsed and validated again before storage is touched. `toJSON`, sparse arrays, cycles, non-finite numbers, and non-plain objects fail closed.

## Boot flows

- **Supported initial-release flow — browser CSR + sync storage**: attach publishes `'idle'`; `dispatchSync(['uklad-persist/hydrate'])` reads, validates, migrates, overlays roots, and reaches `'hydrated'` or `'failed'` before returning. Applications must hydrate before domain events that may change persisted roots.
- **Failure**: read/parse/validate/migrate/deserialize failure publishes `'failed'`, rejects `whenHydrated()`, preserves every original storage entry, and keeps writes closed. `await handle.purge()` removes configured entries and changes the current state into the source for future writes only when every removal succeeds.
- **Not an initial-release product claim**: async storage and SSR integration remain experimental/deferred. The generic async path requires the explicit `experimentalAsync: true` opt-in for continued development, but it has no ordering or durability guarantee until a later minor release.

## What the idiom buys

- **Persistence intent is in the log and attributed to its cause.** Hydration is an event, and each write effect rides on the event that changed the key — the trace answers "this `todos/add` requested a write of `todos`" directly. Storage success or failure is reported separately through sanitized diagnostics.
- **Post-commit writes by construction.** The writer interceptor only contributes effects; effects execute in `do-fx` after the commit, and the write effect serializes from the committed state. Persistence can neither abort an application event nor capture uncommitted state — the strongest expert finding, resolved structurally.
- **The write gate is deliberately dual**: observable post-event status must be `'hydrated'`, and the attachment-scoped lifecycle must also be hydrated. The latter prevents a disposed attachment's stale state status from opening writes after reattach.
- **Write coalescing later is contained**: a per-key trailing debounce inside the write effect, invisible to the rest of the design.

## Feature parity: Redux Persist and Zustand persist

Legend: ✅ has it · ⚠️ partial, indirect, or prototype quality · ❌ missing. Baseline checked 2026-07-19 against the [Redux Persist README](https://github.com/rt2zz/redux-persist#readme) and [Zustand persist documentation](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data). This is a behavioral benchmark, not a requirement to copy either API.

| Feature                             | Redux Persist (usual RTK pairing)                  | Zustand `persist`                                     | `uklad-persist` v0                                     | Direction                                                                                      |
| ----------------------------------- | -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Basic persist + rehydrate           | ✅ `persistReducer` + `persistStore`               | ✅ `persist` middleware                               | ✅ root-key writer + hydrate events                     | Keep the Uklad-native protocol; harden failure and lifecycle paths before publishing          |
| Selective / partial persistence     | ✅ allowlist, denylist, nested persists            | ✅ `partialize`                                       | ✅ configured root keys stored as independent entries   | Root keys are the core model; use per-key transforms for deeper projection                     |
| Sync and async storage              | ✅ Promise-based storage engines; web/RN ecosystem | ✅ sync or async custom storage                       | ✅ sync adapters; async requires an experimental opt-in | Add official AsyncStorage only with ordered writes; SecureStore remains deferred               |
| Manual / deferred hydration         | ✅ `manualPersist` + `persistor.persist()`         | ✅ `skipHydration` + `rehydrate()`                    | ✅ `handle.hydrate()` or public hydrate event           | Keep raw dispatch as low-level protocol and `PersistHandle` as the primary API                 |
| Hydration status and barrier        | ✅ callback, `PersistGate`, `bootstrapped`         | ✅ `hasHydrated`, callbacks, lifecycle listeners      | ✅ status subscription + causal `whenHydrated()`        | Add retry/generation semantics with supported async hydration                                  |
| Versioned migrations                | ✅ `version`, `migrate`, `createMigrate`           | ✅ `version` + `migrate`                              | ✅ validated per-entry version, migrate, and rewrite    | Add migration registries only if real schemas demonstrate the need                             |
| Custom merge / reconciliation       | ✅ configurable state reconcilers                  | ✅ `merge`                                            | ❌ hydrated root currently replaces the initial root    | Add per-key custom merge without changing the event/effect architecture                        |
| Serialization transforms            | ✅ inbound/outbound `createTransform`              | ✅ replacer/reviver or custom storage                 | ✅ per-key `serialize` / `deserialize`                  | Keep; add optional validation helpers rather than hiding schema policy                         |
| Multiple / nested configurations    | ✅ nested persists                                 | ✅ one middleware/config per store                    | ❌ fixed IDs; one attachment per runtime                | Reject duplicates now; introduce a runtime coordinator only when multiple configs are required |
| Runtime control API                 | ✅ purge, flush, pause, resume                     | ⚠️ clear, rehydrate, inspect/change options           | ⚠️ hydrate, await, purge, dispose                       | Add durability `flush` with ordered async writes; do not copy mutable options blindly          |
| Async write ordering and durability | ✅ queued writes + `flush()`                       | ⚠️ async writes, no durability barrier                | ❌ writes are currently fire-and-forget                 | Per-key queue/latch is required before async storage becomes a supported product claim         |
| SSR hydration control               | ⚠️ manual start / React gate; adapter-dependent    | ✅ lazy storage + `skipHydration`                     | ❌ explicitly outside the initial-release product contract | Define CSR/SSR publication semantics and add an example before claiming SSR support            |
| Corrupt-data and failure policy     | ⚠️ transform/config dependent                      | ⚠️ callback receives errors; default JSON unvalidated | ✅ partial publication + closed writes + purge recovery | Add retry attempts only after the async attempt model is defined                               |
| Secure storage and redaction        | ⚠️ community adapters/transforms                   | ⚠️ custom storage/transforms                          | ❌                                                      | Add SecureStore only with an opaque/redacted diagnostic design                                 |
| Store isolation and disposal        | ✅ persistor belongs to one Redux store            | ⚠️ store-local, no persist-specific disposer          | ✅ explicit owner, shared cleanup, safe reattach        | Add multiple configurations only behind a coordinator                                          |
| Types across the library boundary   | ⚠️ TypeScript definitions                          | ✅ typed middleware and storage                       | ✅ typed keys/transforms + `PersistContracts`           | Retain packed strict-consumer tests as a release gate                                          |
| DevTools / causal observability     | ⚠️ persistence actions visible in Redux DevTools   | ⚠️ middleware is mostly opaque                        | ✅ final WRITE effect attributed to causing event       | Extend structured durability/error traces with async support                                   |

## Initial delivery plan

The initial release is deliberately scoped to a small sync-safe contract; async support follows only after ordering and durability have defined semantics. Green spike tests prove the public-primitive routing, but release readiness is determined by the exit criteria below.

> **Initial-release safety invariant:** no storage error, corrupt snapshot, migration, repeated hydration, disposal, or reordering of async completions may silently overwrite newer persisted data or leave a hydration barrier unsettled.

### `0.1.0` — sync-safe persistence

Scope: browser CSR, synchronous localStorage, memory storage for tests, one `persist()` attachment per runtime, configured root keys, synchronous migrations, and per-key serialization transforms. Custom merge, supported async adapters, SSR, SecureStore, and multiple configurations remain outside this release.

#### Runtime correctness

- [x] Convert thrown sync `getItem` errors into the normal failed-hydration transition; startup does not throw and every waiter settles.
- [x] Stage every entry through migrate + deserialize and suppress all migration rewrites if any hydration entry failed; rewrites remain post-publication effects.
- [x] Validate envelope ownership/shape and positive safe-integer versions; reject malformed or future-version entries without backward migration.
- [x] Make `handle.hydrate()`, `runtime.dispatch([PERSIST_IDS.HYDRATE])`, and `runtime.dispatchSync([PERSIST_IDS.HYDRATE])` produce the same observable transitions and settle causal waiters.
- [x] Define the `0.1.0` state machine: attach → `idle`; the first hydrate attempt is terminal; repeated/concurrent hydrate requests are idempotent no-ops; successful purge is explicit recovery into `hydrated`.
- [x] Reject duplicate/empty/reserved keys, invalid versions, protocol collisions, and a second attachment before installation.
- [x] Make handle disposal and runtime disposal share module cleanup; pending work settles, late reads are ignored, and reattach publishes a fresh closed `idle` gate.
- [x] Preserve no-hydration-echo and write/remove exactly configured roots whose identities changed according to `Object.is`.
- [x] Authenticate library-owned events/effects, validate completion payloads, and settle handle operations when Uklad drops queued lifecycle work after an earlier event failure.

#### Failure and recovery

- [x] Use a fail-closed storage policy: valid roots may publish, but any read/parse/validate/migrate/deserialize failure leaves all original entries untouched, publishes failed status, and closes writes.
- [x] Expose failed status and `purge()` recovery in TodoMVC instead of remaining silently non-persistent.
- [x] Report sanitized key/phase/code diagnostics without raw values or user-thrown messages.

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

### Future minor — async-safe persistence

This release inherits every `0.1.0` gate. AsyncStorage becomes supported only after the following criteria pass; until then the generic async path is experimental.

#### Hydration state machine

- [ ] Add an explicit attempt/generation ID and define `idle → hydrating → hydrated | failed` transitions.
- [ ] Permit only one active attempt or define latest-attempt-wins; stale `loaded`/`failed` completions must never publish.
- [ ] Bind `whenHydrated()` to a defined current/next attempt, support retry after failure, and ignore late completions after disposal.
- [ ] Choose and document the policy for domain events during hydration. The initial-release default is an application barrier; custom concurrent merge remains a later concern.

#### Ordered writes and durability

- [ ] Serialize writes per storage key so completion order cannot allow an older value to overwrite a newer one; independent keys may progress concurrently.
- [ ] Capture the exact committed snapshot represented by each queued write rather than reading an unrelated future state head.
- [ ] Coalesce only writes that have not started, preserve last-write-wins, and keep the queue usable after an individual write failure.
- [ ] Add `handle.flush(): Promise<void>` that waits for every write accepted before the call; `runtime.flush()` remains only an event-queue boundary.
- [ ] Add structured persist-error reporting and define `dispose()` behavior for queued, active, and awaited writes without an implicit hidden flush.
- [ ] Make async `purge()` ordered relative to pending writes so an older queued write cannot recreate purged data.

#### Adapter and race gates

- [ ] Ship an AsyncStorage-like adapter and cover read, write, and remove rejection. Optional `multiGet` remains additive.
- [ ] Deterministically test reversed write completion, reversed hydration completion, mutation during hydration, failure in the middle of a queue, dispose during read/write, purge with pending writes, and `flush()` racing a new write.
- [ ] Verify two runtimes with different adapters/prefixes remain isolated.
- [ ] Dogfood the async route in a small React Native or controlled headless example before publishing the async-capable release.

## Beyond the async release

| Deferred feature                    | Why it is not an initial-release prerequisite                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Custom per-key merge                | Additive once the default application-barrier publication model is proven                                            |
| SecureStore + redacted diagnostics  | Requires an opaque staging and observability design; persisted secret values must never appear in traces or errors   |
| Full SSR integration + React gate   | The sync initial release is CSR-only; async semantics come first                                                      |
| Multiple configs per runtime        | The initial release rejects duplicates; add a runtime coordinator when a real second-config use case exists           |
| `restoreState` coordination         | Document as unsupported during initial-release persistence activity, then define attempt/write-gate interaction from real usage |
| Pause/resume and mutable options    | Not needed for correctness; avoid copying competitor APIs without a demonstrated Uklad use case                     |
| Throttling and background lifecycle | Additive over the ordered per-key queue after durability is correct                                                  |
| Adapter batching (`multiGet`)       | Performance optimization that must not shape the minimum adapter contract                                            |

## Prototype findings and release hardening

The spike graduated into the package: its scenarios and release regressions live in [packages/persist/src/tests/persist.test.ts](../../packages/persist/src/tests/persist.test.ts), including the Map round trip discovered by TodoMVC. Persistence itself still uses only public Uklad APIs. Release hardening added generic Uklad guarantees—not persistence hooks—for read-only post-handler `newState`, append-only interceptor effects, module cleanup ordering, and final-effect trace capture.

1. Happy-path sync route: one synchronous `dispatchSync` hydrates, overlays roots, migrates, and re-stores migrated keys via post-commit write effects — zero awaits.
2. Per-key writes: changing one configured key writes exactly one storage entry; unconfigured keys never write.
3. Experimental async read route with the gate: a pre-hydration change produces no write, so the stored snapshot survives the read window. This does not prove async write completion ordering and is not a `0.1.0` support claim.
4. Thrown sync reads and rejected experimental async reads both set failed status, reject `whenHydrated()`, report sanitized diagnostics, and keep writes gated.
5. Hydration appears as ordinary events, and the final trace for the causing domain event contains the exact interceptor-contributed WRITE effect.
6. Applications use the explicit runtime API (`runtime.registerModule()` and
   `runtime.dispatch()`); persistence never discovers a runtime implicitly.
7. Handle/runtime disposal share cleanup; pending barriers reject, late reads are ignored, duplicate attachment is rejected, and reattach starts with a closed idle gate.
8. Hydration-echo regression: hydrating stored values performs zero writes — the bug the watch-based writer shipped with (see Dogfood notes) cannot recur silently.

Calibration: the suite now establishes `0.1.0` sync failure atomicity, lifecycle parity, direct-dispatch barriers, recovery, trace finalization, strict typing, and separately packed ESM/CJS consumption with TS6/TS7. It deliberately does not establish async write ordering/durability or SSR integration; the checklists above remain authoritative.

## Dogfood notes (TodoMVC, 2026-07-18)

- Real state values are not always JSON-safe (TodoMVC's `todos` is a `Map`) — config keys accept per-key `serialize`/`deserialize` transforms.
- Replacing the hand-rolled persistence deleted the `local-store-todos` coeffect, the `todos-to-local-store` effect, and a storage-effect return from six event handlers; `INIT_APP` became unnecessary. Handlers now never mention storage.
- Monorepo examples that alias `@ukladjs/core` to source must also alias the `/vanilla` subpath and `@ukladjs/persist` itself — otherwise the bundle carries two uklad copies and persistence attaches to the wrong default runtime ([examples/todomvc/vite.config.ts](../../examples/todomvc/vite.config.ts)).
- Verified in-browser: add todo → per-key envelope written; reload → hydrated before first paint; toggle done → stored with zero storage code in the handler.
- **The watch-based writer shipped with an echo bug**, spotted in the trace log on the first real boot with stored data: hydration changed `todos`, the value watch fired, and a `store` event wrote the just-read snapshot straight back. Value watches lack causality — they see _that_ a key changed, never _why_. The writer became a global interceptor (event identity → hydration skipped by construction), which also moved writes onto the causing event's trace and dropped the extra `store` event and the "keys must be sub ids" requirement.

## `0.1.0` decisions

1. **Hydrate before domain events.** Writes are closed in `idle`, so a pre-hydration root change is not persisted; the one hydration attempt may then replace that root with its stored value. `0.1.0` applications must hydrate before first render and before events that change configured roots. There is no hidden reconcile write.
2. **Storage namespaces are explicit.** Root-key components are percent-encoded. Runtimes intended to be isolated on the same storage backend must use distinct non-empty prefixes; using the same prefix deliberately addresses the same entries.
3. **`restoreState()` is unsupported while persistence is attached.** Restore bypasses events and can forge/remove observable status. Dispose persistence first, restore at a legal runtime boundary, then reattach and hydrate.
