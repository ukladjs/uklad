# @ukladjs/persist

Versioned persistence for [Uklad](https://github.com/ukladjs/uklad). Hydration is an event, storage operations are effects/coeffects, status is a subscription, and one global interceptor contributes post-commit writes to the events that changed configured roots.

Both synchronous storage (for example `localStorage`) and promise-based storage (for example React Native AsyncStorage or Expo SQLite's key-value store) are supported. Async writes are serialized per storage key, coalesce only while they have not started, preserve the latest committed snapshot, and can be awaited with `flush()`.

## Install

```sh
pnpm add @ukladjs/persist@0.1.0
```

The package requires `@ukladjs/core@^0.2.0` as a peer dependency.

## Usage

```ts
import { createUkladRuntime } from '@ukladjs/core';
import { localStorageAdapter, persist } from '@ukladjs/persist';

const runtime = createUkladRuntime({
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

`hydrate()` starts an attachment-scoped attempt. Repeated calls are idempotent while an attempt is active or already hydrated; after a failed attempt, calling it again retries. Status is available at `['uklad-persist']`:

```ts
import { PERSIST_IDS } from '@ukladjs/persist';

// In React, read this with useSubscription([PERSIST_IDS.STATUS]).
// Non-React reads are intentionally limited to the explicit testing harness.
// 'idle' | 'hydrating' | 'hydrated' | 'failed'

await persistence.whenHydrated(); // rejects when hydration failed or was disposed
await persistence.flush(); // await this at a lifecycle boundary when durability matters
```

Writes remain closed until status is `hydrated`. Hydration events are excluded from the writer, so reading a stored root never echoes it back to storage.
If an async write fails, `flush()` continues to reject until a later successful
operation for that root supersedes the failed write.
Queued writes for one root use last-write-wins coalescing. Active storage calls
and non-write ordering barriers such as `purge()` are never replaced.

### Hydration barrier

Persistence does not block application events while status is `idle`,
`hydrating`, or `failed`. Such events still commit normal Uklad state, but
changes to configured roots are not written and a later successful hydration
may replace them with stored values. Applications must therefore gate domain
actions that can change persisted roots until status is `hydrated` (or
`whenHydrated()` resolves). Independent, non-persisted UI roots may continue to
change during hydration.

### React Native and Expo

The package does not import a native storage implementation. Pass any
AsyncStorage-compatible object through `asyncStorageAdapter`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { asyncStorageAdapter, persist } from '@ukladjs/persist';

const persistence = persist(runtime, {
  storage: asyncStorageAdapter(AsyncStorage),
  keys: ['todos'],
});

persistence.hydrate();
await persistence.whenHydrated();
```

For Expo SQLite's synchronous key-value API, use `syncStorageAdapter` with its
`getItemSync`/`setItemSync`/`removeItemSync` methods from
`expo-sqlite/kv-store`. The Expo fixture uses this synchronous route; the bare
React Native fixture exercises `asyncStorageAdapter()` and `flush()`.

## Storage layout

Each configured root owns one entry:

```text
<prefix>/<encoded-root-key> -> {"v":<configured-version>,"data":...}
```

The prefix defaults to `uklad`, and the configured version defaults to `1`. Root-key components are percent-encoded. A change writes only roots whose identities changed according to `Object.is`. Deleting a configured root (or setting it to `undefined`) removes its storage entry.

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
import { createUkladRuntime } from '@ukladjs/core';
import { localStorageAdapter, persist } from '@ukladjs/persist';

type Todo = { id: number; title: string; done: boolean };

const runtime = createUkladRuntime({
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

`dispose()` removes the module's handlers, status subscription, and writer
interceptor. Runtime disposal uses the same cleanup path, and pending barriers
reject. Queued async storage work is cancelled; already-started storage calls
cannot be cancelled, so attachment ownership remains fenced until they settle.
Await disposal before reattaching:

```ts
await persistence.dispose();
const nextPersistence = persist(runtime, nextOptions);
```

The next attachment starts from a fresh `idle` gate even if state still
contains an older terminal status.

`PersistHandle` is the primary typed API. Applications that intentionally dispatch the public hydrate/purge events or query status on a strict runtime can compose its contract:

```ts
import { createUkladRuntime } from '@ukladjs/core';
import { PERSIST_IDS } from '@ukladjs/persist';
import type { PersistContracts } from '@ukladjs/persist';

// AppContracts is the application's existing strict Uklad contract.
type AppWithPersist = PersistContracts<AppContracts>;

const runtime = createUkladRuntime<AppWithPersist>({ initialState });
runtime.dispatch([PERSIST_IDS.HYDRATE]);
// React consumers can read status with useSubscription([PERSIST_IDS.STATUS]).
```

Internal completion/effect IDs are exported for diagnostics but are not part of `PersistContracts` and must not be dispatched by applications. Library-owned payloads are authenticated at runtime; forged or malformed internal work is rejected without opening the write gate.

For the package [architecture](https://github.com/ukladjs/uklad/blob/main/docs/architecture/uklad-persist.md), safety invariant, and native-app integration notes, see the [uklad-persist RFC](https://github.com/ukladjs/uklad/blob/main/docs/rfcs/persistence.md).

## License

MIT
