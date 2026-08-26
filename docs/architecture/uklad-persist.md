# Uklad Persist architecture (compact spec)

`@ukladjs/persist` attaches one persistence module to one explicit
`UkladRuntime`. It is an ordinary external consumer of Uklad: application
state changes only through events, storage calls only happen in effects, and
the module owns no private runtime hooks.

Each configured state root is stored independently in a versioned envelope.
Synchronous storage is supported for browser and SQLite key-value stores;
promise-based storage is supported for React Native and Expo.

```text
<prefix>/<encoded-root-key> -> {"v": <version>, "data": <JSON data>}
```

## Scope and boundary

The package owns configuration validation, storage adapters, codecs,
migrations, lifecycle barriers, diagnostics, and the persistence protocol. It
uses only documented Uklad APIs:

- `registerModule()` for attachment-scoped installation and cleanup;
- events, effects, coeffects, subscriptions, and one global interceptor;
- interceptor context snapshots to capture the committed root value represented
  by each post-commit write effect.

It does **not** import Uklad internals, mutate a runtime's state head directly,
register watches, or require a persistence-specific core hook. There is one
attachment per runtime in the initial release; duplicate attachments and protocol ID
collisions fail before installation.

## End-to-end flows

### Sync hydration

```text
persist(runtime, options)
  │
  ├─ validate static configuration and protocol availability
  ├─ register module: status sub, events, effects, optional snapshot coeffect,
  │  and the writer interceptor
  └─ dispatch internal ATTACH → publish attachment-scoped "idle"

handle.hydrate()
  │
  ├─ dispatchSync(HYDRATE)
  ├─ SNAPSHOT coeffect → synchronously read every configured storage entry
  ├─ HYDRATE handler → parse → validate → migrate → deserialize → stage values
  │                    → overlay valid roots and set terminal status
  └─ do-fx → commit the state, then REPORT / migration WRITE / COMPLETE effects
                 │
                 └─ COMPLETE settles whenHydrated() waiters
```

Each entry is staged before it reaches `draftState`. A failed entry does not stop
valid staged roots from publishing, but makes the terminal status `failed`,
keeps normal writes closed, and suppresses **all** migration rewrites. This is
the fail-closed storage policy: original entries are never partially migrated.

### Post-commit root writes

```text
dispatch(['todos/add', ...])
  │
  ├─ event handler produces context.newState
  ├─ persist writer (global after interceptor)
  │    ├─ ignores persistence protocol events
  │    ├─ requires both lifecycle state and newState status to be "hydrated"
  │    └─ compares newState with context.previousState by configured root and Object.is
  │          → appends WRITE effects for changed roots
  └─ do-fx
       ├─ commits newState
       └─ WRITE serializes its captured committed snapshot and calls storage
```

The writer contributes intent only; it never calls storage. This prevents
hydration echoing its just-read values back to storage and makes every write
effect attributable to the domain event that changed its root. If a configured
root is `undefined`, the write effect removes its storage entry instead.

For async storage, writes are queued per key. Independent roots can progress
concurrently, while an older write for one root cannot complete after a newer
write for that same root and overwrite it. Writes that have not started use
last-write-wins coalescing; active calls and non-write ordering barriers are
never replaced. Every accepted ticket remains attached to the resulting work,
so `handle.flush()` still covers writes accepted before the call even when a
later snapshot replaces their queued operation. `runtime.flush()` only drains
the Uklad event queue. A failed write remains visible to the durability barrier
until a later successful operation for that root supersedes it.

### Application hydration barrier

Persistence deliberately does not queue or reject application events during
hydration. While status is not `hydrated`, the writer gate is closed: domain
events still commit runtime state, but configured-root changes are not stored
and the hydration snapshot may later replace them. Applications must withhold
domain actions that can change persisted roots until `whenHydrated()` resolves
or the status subscription publishes `hydrated`. Independent non-persisted UI
roots may continue to update.

### Purge and disposal

`handle.purge()` dispatches `PURGE`, which changes the observable status to
`hydrating` and contributes a `REMOVE` effect. That effect removes every
configured entry, then an authenticated `PURGED` completion publishes either
`hydrated` or `failed` and settles accepted purge waiters after the commit.
Purge does not mutate persisted roots in state; after a successful purge, the
current state is the source of future writes.

`dispose()` and runtime disposal share the `registerModule()` cleanup path.
Cleanup rejects outstanding hydration and purge barriers, removes the module's
registrations and interceptor, and cancels queued async work. A native storage
call that already started cannot be cancelled, so runtime ownership remains
fenced until it settles. `await handle.dispose()` is the deterministic
reattachment boundary; the next attachment starts from a fresh closed `idle`
gate.

## Module map

Paths below are relative to `src/`. Only the root package entrypoint is public;
the other paths are implementation details and intentionally have no subpath
exports during the initial release.

| Path                   | Responsibility                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `index.ts`             | Stable public re-exports only                                                                                |
| `ids.ts`               | Persistence protocol IDs                                                                                     |
| `types.ts`             | Public storage, option, handle, diagnostic, and strict-contract types                                        |
| `adapters.ts`          | Browser `localStorage`, in-memory, AsyncStorage-compatible, and sync structural adapters                     |
| `async-coordinator.ts` | Per-key async ordering, queued-write coalescing, failure tracking, durability barriers, and disposal         |
| `config.ts`            | Static option validation and frozen normalized key configuration                                             |
| `codec.ts`             | Versioned envelope codec, recursive JSON validation, migrations, and transforms; no Uklad runtime dependency |
| `protocol.ts`          | Registration collision checks and validation of internal event/effect payloads                               |
| `persist.ts`           | Attachment-local state, Uklad registration, lifecycle barriers, writer, and handle implementation            |

The dependency direction is inward: `codec.ts` and `config.ts` are pure
configuration/data code; `protocol.ts` describes boundary messages; only
`persist.ts` assembles them against a runtime. Async ordering lives in its own
attachment-local coordinator, so the codec remains runtime-independent.

## Lifecycle and protocol

The observable status subscription is `[PERSIST_IDS.STATUS]` and has four
values: `idle`, `hydrating`, `hydrated`, and `failed`. The attachment also has
a private terminal `disposed` state.

| Transition    | Result                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| attach        | publish `idle`; writes stay closed                                                                                                            |
| sync hydrate  | publish `hydrated` or `failed` in the same `dispatchSync` transaction                                                                         |
| async hydrate | publish `hydrating`, then generation-authenticated `loaded` or `failed` completion publishes a terminal status; stale completions are ignored |
| purge         | publish `hydrating`, then authenticated purge completion publishes `hydrated` or `failed`                                                     |
| dispose       | reject barriers, cancel queued work, and fence reattachment until active storage calls settle                                                 |

Repeated hydration is an idempotent no-op while active or after success; a
failed attempt may be retried. A purge request while hydration is active is
rejected. Applications must gate domain events that change persisted roots
until hydration succeeds.

Internal lifecycle events and effects carry object identities authorized through
attachment-local `WeakSet`s. Public raw `HYDRATE` and `PURGE` dispatch remains
available for DevTools and composition, but forged completion/effect payloads
cannot open the write gate or settle a handle barrier.

## Data and failure rules

- Serializer and migration outputs must be recursive JSON data. Runtime
  validation rejects cycles, sparse arrays, `toJSON`, non-finite numbers,
  non-plain objects, accessors, and symbol keys.
- Stored envelope versions must be positive safe integers. Future versions are
  rejected rather than migrated backwards.
- Diagnostics expose only `{ code, phase, key? }`; no raw stored value or
  user-thrown message enters a report or trace.
- Storage write/remove errors are reported but cannot abort the domain event
  that caused the write.
- Both lifecycle state and committed status must be `hydrated` before the
  writer can append effects. A stale state status after disposal therefore
  cannot reopen writes after reattachment.

## Async integration boundary

The package intentionally does not import a native storage library. React
Native applications can provide an AsyncStorage-compatible object through
`asyncStorageAdapter()`. Expo SQLite's synchronous key-value API can be wrapped
with `syncStorageAdapter()`; the Expo fixture verifies that route against the
real `expo-sqlite/kv-store` package.

Hydration uses generation-authenticated completions, so a retry after failure
cannot be completed by an older read. Disposal rejects pending barriers,
cancels queued work, and retains the attachment fence until active native
promises settle. SecureStore remains a separate concern: it is appropriate for
small secrets, not general root persistence.

## Invariants

- One attachment owns one runtime and one fixed persistence configuration.
- Storage work is represented by effects and happens only after the causing state
  commit.
- Hydration never writes its own snapshot back through the writer.
- A disposed attachment cannot complete a storage write after a newer
  attachment has started.
- Every hydration/purge barrier either settles at a terminal state or rejects
  on disposal or a dropped lifecycle event.
- No invalid, future-version, or partially migrated entry is silently written
  back to storage.
- A caller can rely on the root package API without depending on internal file
  paths.
