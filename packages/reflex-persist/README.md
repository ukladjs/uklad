# @flexsurfer/reflex-persist

Sync-safe, versioned persistence for [Reflex](https://github.com/flexsurfer/reflex). Hydration is an event, storage operations are effects/coeffects, status is a subscription, and one global interceptor contributes post-commit writes to the events that changed configured roots.

`0.1.0-beta.1` supports browser CSR with synchronous storage such as `localStorage`, one attachment per runtime, root-key persistence, synchronous migrations, and per-key transforms. Async storage, SSR integration, custom merge, and multiple configurations per runtime are not supported in this beta. The async type surface requires an explicit `experimentalAsync: true` opt-in and has no write-ordering or durability guarantee.

## Install

```sh
pnpm add @flexsurfer/reflex-persist@beta
```

The package requires `@flexsurfer/reflex@^0.1.27` as a peer dependency.

## Usage

```ts
import { createReflexRuntime } from '@flexsurfer/reflex';
import { localStorageAdapter, persist } from '@flexsurfer/reflex-persist';

const runtime = createReflexRuntime({
  initialState: { todos: [], settings: {} },
  runtimeId: 'my-app',
});

const persistence = persist(runtime, {
  storage: localStorageAdapter(),
  keys: ['todos', 'settings'],
});

// localStorage hydration is terminal before this returns. Do this before the
// first render and before dispatching events that change persisted roots.
persistence.hydrate();
```

The runtime is explicit. Attach only once per runtime; a second attachment and
persistence protocol collisions fail loudly.

`hydrate()` performs one attachment-scoped attempt. Repeated calls are idempotent no-ops. Status is available at `['reflex-persist']`:

```ts
import { PERSIST_IDS } from '@flexsurfer/reflex-persist';

// In React, read this with useSubscription([PERSIST_IDS.STATUS]).
// Non-React reads are intentionally limited to the explicit testing harness.
// 'idle' | 'hydrating' | 'hydrated' | 'failed'

await persistence.whenHydrated(); // rejects when hydration failed or was disposed
```

Writes remain closed until status is `hydrated`. Hydration events are excluded from the writer, so reading a stored root never echoes it back to storage.

## Storage layout

Each configured root owns one entry:

```text
<prefix>/<encoded-root-key> -> {"v":<configured-version>,"data":...}
```

The prefix defaults to `reflex`, and the configured version defaults to `1`. Root-key components are percent-encoded. A change writes only roots whose identities changed according to `Object.is`. Deleting a configured root (or setting it to `undefined`) removes its storage entry.

Use `prefix` to isolate applications or runtimes that share a storage backend:

```ts
persist(runtime, {
  storage: localStorageAdapter(),
  prefix: 'my-app',
  keys: ['settings'],
});
```

## Non-JSON roots

Transforms are typed to their selected root and run synchronously. Their result is recursively constrained to JSON data and validated again at runtime. For a `Map`:

```ts
import { createReflexRuntime } from '@flexsurfer/reflex';
import { localStorageAdapter, persist } from '@flexsurfer/reflex-persist';

type Todo = { id: number; title: string; done: boolean };

const runtime = createReflexRuntime({
  initialState: { todos: new Map<number, Todo>() },
});

persist(runtime, {
  storage: localStorageAdapter(),
  keys: [
    {
      key: 'todos',
      serialize: (todos) => Array.from(todos.entries()),
      deserialize: (data) => new Map(data as [number, Todo][]),
    },
  ],
});
```

## Versioned migrations

Migrations receive serialized data before the current `deserialize` transform:

```ts
persist(runtime, {
  storage: localStorageAdapter(),
  keys: ['todos'],
  version: 2,
  migrate: (_key, data, fromVersion) => upgradeTodos(data, fromVersion),
});
```

Envelopes and positive integer versions are validated. Future versions are rejected and never migrated backwards. Migration rewrites run post-commit only when every configured entry staged successfully; any hydration error leaves all original storage entries untouched.

## Failure and recovery

Valid entries may still overlay their roots when another entry fails, but status becomes `failed`, all normal writes remain closed, and no migrations are rewritten. `onError` receives only sanitized key/phase/code metadata—never stored values or user-thrown error messages:

```ts
const persistence = persist(runtime, {
  storage: localStorageAdapter(),
  keys: ['todos'],
  onError: ({ key, phase, code }) => {
    reportPersistenceHealth({ key, phase, code });
  },
});

try {
  persistence.hydrate();
  await persistence.whenHydrated();
} catch {
  await persistence.purge(); // remove configured entries and reopen writes
}
```

`purge()` does not reset state roots. After a successful purge, the current state becomes the source for later writes. A failed removal leaves status `failed` and rejects the purge promise.

Serialization and storage-write failures are reported through `onError` without aborting the application event that caused them.

## Lifecycle and strict contracts

`dispose()` removes the module's handlers, status subscription, and writer interceptor. Runtime disposal uses the same cleanup path, and pending barriers reject. Disposing and reattaching starts from a fresh `idle` gate even if state still contains an older terminal status.

`PersistHandle` is the primary typed API. Applications that intentionally dispatch the public hydrate/purge events or query status on a strict runtime can compose its contract:

```ts
import { createReflexRuntime } from '@flexsurfer/reflex';
import { PERSIST_IDS } from '@flexsurfer/reflex-persist';
import type { PersistContracts } from '@flexsurfer/reflex-persist';

// AppContracts is the application's existing strict Reflex contract.
type AppWithPersist = PersistContracts<AppContracts>;

const runtime = createReflexRuntime<AppWithPersist>({ initialState });
runtime.dispatch([PERSIST_IDS.HYDRATE]);
// React consumers can read status with useSubscription([PERSIST_IDS.STATUS]).
```

Internal completion/effect IDs are exported for diagnostics but are not part of `PersistContracts` and must not be dispatched by applications. Library-owned payloads are authenticated at runtime; forged or malformed internal work is rejected without opening the write gate.

For the package [architecture](./docs/architecture.md), safety invariant, and roadmap to async support, see the [reflex-persist RFC](https://github.com/flexsurfer/reflex/blob/main/docs/reflex-persist-rfc.md).

## License

MIT
