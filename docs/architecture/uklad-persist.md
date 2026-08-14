# Uklad Persist architecture (compact spec)

`@ukladjs/persist` attaches one persistence module to one explicit
`UkladRuntime`. It is an ordinary external consumer of Uklad: application
state changes only through events, storage calls only happen in effects, and
the module owns no private runtime hooks.

`0.1.0` is deliberately sync-safe and browser-CSR focused. Each
configured state root is stored independently in a versioned envelope.

```text
<prefix>/<encoded-root-key> -> {"v": <version>, "data": <JSON data>}
```

## Scope and boundary

The package owns configuration validation, storage adapters, codecs,
migrations, lifecycle barriers, diagnostics, and the persistence protocol. It
uses only documented Uklad APIs:

- `registerModule()` for attachment-scoped installation and cleanup;
- events, effects, coeffects, subscriptions, and one global interceptor;
- `getState()` only to read current committed state in a post-commit write
  effect.

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
       └─ WRITE reads the committed root, serializes its envelope, and calls storage
```

The writer contributes intent only; it never calls storage. This prevents
hydration echoing its just-read values back to storage and makes every write
effect attributable to the domain event that changed its root. If a configured
root is `undefined`, the write effect removes its storage entry instead.

### Purge and disposal

`handle.purge()` dispatches `PURGE`, which changes the observable status to
`hydrating` and contributes a `REMOVE` effect. That effect removes every
configured entry, then an authenticated `PURGED` completion publishes either
`hydrated` or `failed` and settles accepted purge waiters after the commit.
Purge does not mutate persisted roots in state; after a successful purge, the
current state is the source of future writes.

`dispose()` and runtime disposal share the `registerModule()` cleanup path.
Cleanup rejects outstanding hydration and purge barriers, removes the module's
registrations and interceptor, and permits a later attachment to start from a
fresh closed `idle` gate.

## Module map

Paths below are relative to `src/`. Only the root package entrypoint is public;
the other paths are implementation details and intentionally have no subpath
exports during the initial release.

| Path          | Responsibility                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `index.ts`    | Stable public re-exports only                                                                                 |
| `ids.ts`      | Persistence protocol IDs                                                                                      |
| `types.ts`    | Public storage, option, handle, diagnostic, and strict-contract types                                         |
| `adapters.ts` | Browser `localStorage` and in-memory synchronous adapters                                                     |
| `config.ts`   | Static option validation and frozen normalized key configuration                                              |
| `codec.ts`    | Versioned envelope codec, recursive JSON validation, migrations, and transforms; no Uklad runtime dependency |
| `protocol.ts` | Registration collision checks and validation of internal event/effect payloads                                |
| `persist.ts`  | Attachment-local state, Uklad registration, lifecycle barriers, writer, and handle implementation            |

The dependency direction is inward: `codec.ts` and `config.ts` are pure
configuration/data code; `protocol.ts` describes boundary messages; only
`persist.ts` assembles them against a runtime. This lets async storage evolve
without changing the public root entrypoint or contaminating the codec with
runtime concerns.

## Lifecycle and protocol

The observable status subscription is `[PERSIST_IDS.STATUS]` and has four
values: `idle`, `hydrating`, `hydrated`, and `failed`. The attachment also has
a private terminal `disposed` state.

| Transition                 | Result                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| attach                     | publish `idle`; writes stay closed                                                                  |
| sync hydrate               | publish `hydrated` or `failed` in the same `dispatchSync` transaction                               |
| experimental async hydrate | publish `hydrating`, then authenticated `loaded` or `failed` completion publishes a terminal status |
| purge                      | publish `hydrating`, then authenticated purge completion publishes `hydrated` or `failed`           |
| dispose                    | reject barriers and ignore late work                                                                |

Repeated hydration after a terminal result is an idempotent no-op. A purge
request while hydration is active is rejected. The initial-release application rule is:
hydrate before first render and before dispatching domain events that change
persisted roots.

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

## Async roadmap boundary

The async storage shape is explicitly experimental in `0.1.0`. Its read path is
kept behind the same protocol, but async writes are fire-and-forget and provide
neither ordering nor durability guarantees.

The next async-capable minor release should add an attachment-local async coordinator rather than a generic
sync/async abstraction. It will own attempt/generation IDs, one write queue per
storage key, snapshots captured at enqueue time, `flush()`, and purge ordering
relative to active or queued writes. `codec.ts`, `config.ts`, and the public
handle surface are deliberately positioned to remain stable while that
coordinator is introduced.

## Invariants

- One attachment owns one runtime and one fixed persistence configuration.
- Storage work is represented by effects and happens only after the causing state
  commit.
- Hydration never writes its own snapshot back through the writer.
- Every hydration/purge barrier either settles at a terminal state or rejects
  on disposal or a dropped lifecycle event.
- No invalid, future-version, or partially migrated entry is silently written
  back to storage.
- A caller can rely on the root package API without depending on internal file
  paths.
