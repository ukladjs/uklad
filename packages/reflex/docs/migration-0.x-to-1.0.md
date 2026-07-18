# Migrating from Reflex 0.x to the 1.0 runtime

Reflex 1.0 introduces explicit runtime instances. A runtime owns its database,
event queue, handler registries, subscription graph and cache, tracing state,
schedulers, and DevTools inspector. This makes per-request SSR, isolated tests,
embedded widgets, and multiple applications in one JavaScript realm safe.

The package-root API remains supported as a compatibility facade. Existing
applications can upgrade first and adopt explicit runtimes incrementally.

## Choose a migration path

### Keep the compatibility facade

Existing root imports continue to use one package-owned `defaultRuntime`:

```ts
import { dispatch, initAppDb, regEvent, regSub } from '@flexsurfer/reflex';

initAppDb({ count: 0 });
regEvent('count/increment', ({ draftDb }) => {
  draftDb.count += 1;
});
regSub('count');

dispatch(['count/increment']);
```

No provider is required for this form. `useSubscription` falls back to the
default runtime when there is no `ReflexProvider` above the component. Global
module augmentation for `AppDb`, `EventPayloads`, `EffectPayloads`, and
`SubPayloads` also remains available to compatibility-facade applications.

This is the lowest-risk first step for an existing single-runtime application.
It does not provide isolation between requests, tests, widgets, or agent
sandboxes; use an explicit runtime wherever that isolation matters.

### Adopt an explicit runtime

New applications and applications that need isolation should import the core
runtime from the React-free entrypoint and React bindings from the React
entrypoint:

```tsx
import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import { ReflexProvider, useSubscription } from '@flexsurfer/reflex/react';

const runtime = createReflexRuntime({
  initialDb: { count: 0 },
  runtimeId: 'main-app',
  name: 'Main application',
});

runtime.registerModule((scope) => {
  scope.regEvent('count/increment', ({ draftDb }) => {
    draftDb.count += 1;
  });
  scope.regSub('count');
});

function Counter() {
  const count = useSubscription<number>(['count'], 'Counter');
  return <button onClick={() => runtime.dispatch(['count/increment'])}>Count: {count}</button>;
}

function Root() {
  return (
    <ReflexProvider runtime={runtime}>
      <Counter />
    </ReflexProvider>
  );
}
```

Providers may be nested. A hook always uses the nearest provider, so a widget
or test subtree can have a private runtime without changing the surrounding
application.

## Entrypoint mapping

| 0.x import                                    | 1.0 instance-oriented import                     |
| --------------------------------------------- | ------------------------------------------------ |
| `@flexsurfer/reflex`                          | Compatibility facade and combined public surface |
| Runtime creation and non-React APIs           | `@flexsurfer/reflex/vanilla`                     |
| Provider, hooks, and React hot-reload helpers | `@flexsurfer/reflex/react`                       |

`@flexsurfer/reflex/vanilla` does not load React and is the correct entrypoint
for Node services, SSR request handlers, tests, and headless agent runtimes.
Only the documented entrypoints are public; do not replace old imports with
paths into `dist` or `src`.

## Move initialization into a runtime boundary

In 0.x, a typical `db.ts` initializes module-global state:

```ts
import { initAppDb } from '@flexsurfer/reflex';

initAppDb({ todos: [] });
```

With an explicit runtime, construct the database at the application, request,
story, or test boundary:

```ts
import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

interface AppDb {
  todos: Todo[];
}

export function createAppRuntime(initialDb: AppDb = { todos: [] }) {
  return createReflexRuntime({ initialDb });
}

export type AppRuntime = ReturnType<typeof createAppRuntime>;
```

Do not export one runtime from a server module and reuse it for every request.
Create the runtime inside the request boundary.

## Move registrations into modules

Side-effect imports that call root-level `regEvent`, `regEffect`, `regCoeffect`,
or `regSub` register against the default runtime. For an explicit runtime,
express feature setup as an installer:

```ts
import type { AppRuntime } from './runtime';

export function installTodos(runtime: AppRuntime) {
  return runtime.registerModule((scope) => {
    scope.regSub('todos/list', 'todos');
    scope.regEvent('todos/add', ({ draftDb }, id: string, title: string) => {
      draftDb.todos.push({ id, title, done: false });
    });
  });
}
```

Install it on each runtime that needs the feature:

```ts
const disposeTodos = installTodos(runtime);
```

The returned disposer is idempotent and removes only registrations still owned
by that installation. Unmount React consumers and unsubscribe non-React
watchers before disposing a module: Reflex rejects removal while one of the
module's subscription graphs is active.

For HMR and lazy routes, dispose the old installation before installing the new
one. Do not replace the old global `clearHandlers()` pattern with a runtime-wide
clear; that would remove unrelated features.

## Replace global calls with runtime methods

The instance API supplies the runtime-owned equivalents of the 0.x functions:

```ts
runtime.dispatch(['todos/add', 'todo-1', 'Write migration']);
runtime.dispatchSync(['selection/set', 'todo-1']);

const db = runtime.getAppDb();
const todos = runtime.getSubscriptionValue(['todos/list']);
const inspector = runtime.createInspector();
```

Calls through the package root and calls through `defaultRuntime` deliberately
interoperate because they have the same state owner. Calls on any other runtime
are isolated and must not observe default-runtime state or registrations.

### Unknown ids fail loudly on the instance API

The instance API throws instead of logging and continuing:

- `runtime.dispatch` and `runtime.dispatchSync` throw on a malformed event
  vector and on an event id with no registered handler.
- `runtime.getSubscriptionValue` and `runtime.watchSubscription` throw on a
  malformed query vector and on an unregistered subscription id.

The legacy root functions (`dispatch`, `dispatchSync`, `getSubscriptionValue`)
keep the lenient 0.x behavior: they log a console error and continue. One
behavioral change reaches existing applications: `useSubscription` reads
through the provider (or default) runtime's instance API, so subscribing to an
unregistered id now throws during render instead of rendering `undefined`.
That situation was already a bug; surface it with an error boundary rather
than depending on the silent `undefined`.

Events that are already queued remain lenient by design: if a handler is
removed between `dispatch` and processing (module disposal, `clearHandlers`),
the queue logs and drops that event rather than failing the whole queue.

## Adopt store-local contracts

Global module augmentation remains supported for the compatibility facade, but
an explicit runtime can carry a local contract instead:

```ts
import { createReflexRuntime, type ReflexContracts } from '@flexsurfer/reflex/vanilla';

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

interface AppContracts extends ReflexContracts {
  db: {
    todos: Todo[];
  };
  events: {
    'todos/add': [id: string, title: string];
  };
  effects: {
    'storage/save': Todo[];
  };
  subscriptions: {
    'todos/list': { params: []; result: Todo[] };
  };
}

export function createAppRuntime(initialDb: AppContracts['db'] = { todos: [] }) {
  return createReflexRuntime<AppContracts>({ initialDb });
}

export type AppRuntime = ReturnType<typeof createAppRuntime>;
```

Contracts are compile-time declarations, not runtime validation. Omitted
contract sections retain permissive legacy typing, which allows one feature at
a time to migrate. External messages still need runtime schema validation at
their trust boundary.

## Headless reads, watches, and flushes

Use `getSubscriptionValue` for an imperative read and `watchSubscription` for
continuous non-React consumption:

```ts
const stop = runtime.watchSubscription(['todos/list'], (value, previousValue) => {
  console.log({ value, previousValue });
});

runtime.dispatch(['todos/add', 'todo-2', 'Verify headless flow']);
await runtime.flush();

stop();
```

The watcher emits its current value synchronously by default. Pass
`{ emitInitial: false }` to receive changes only. Both the stop function and
module disposers are safe to call more than once.

`await runtime.flush()` waits for events already accepted by that runtime,
including events synchronously enqueued by their effects, then publishes the
latest database generation and completes listener delivery. It does not wait
for `dispatch-later`, arbitrary promises started by effects, or events
dispatched after the flush call. `dispatchSync` remains the synchronous
handle-and-publish operation.

## Restore state explicitly

Use the runtime-owned restore operation for hydration, fixtures, and intentional
state replacement:

```ts
runtime.restoreAppDb(snapshot);
```

Restore replaces both database heads and publishes changed roots
synchronously. It does not run events or effects and is rejected while event
work is pending or being handled, or during subscription computation or
listener delivery. Await `runtime.flush()` before restoring after asynchronous
dispatch. `initAppDb` remains the bootstrap/compatibility name for the default
runtime; it is not the instance restore API.

## Dispose explicit runtimes

When an explicit runtime's owner is finished, release it terminally:

```ts
runtime.dispose();
```

Disposal cancels runtime-owned scheduled work, watches, tracing callbacks, and
module installations, and is safe to repeat. Unmount React trees and release
other external subscription consumers first. Disposal proactively stops
`runtime.watchSubscription` watches and React render subscriptions, so it
cannot detect every still-mounted component; leaving one mounted is invalid
because a later hook read will reach a disposed runtime.
Reflex does reject disposal when an active graph remains outside those tracked
watches. The compatibility `defaultRuntime` is process-owned and cannot be
disposed.

## SSR and hydration

Create and configure one runtime per server request:

```tsx
export function renderRequest(initialDb: AppContracts['db']) {
  const runtime = createAppRuntime(initialDb);
  installTodos(runtime);
  try {
    const html = renderToString(
      <ReflexProvider runtime={runtime}>
        <App />
      </ReflexProvider>,
    );
    const state = runtime.getAppDb();
    return { html, state };
  } finally {
    runtime.dispose();
  }
}
```

Serialize the database using the application's normal safe serialization
boundary. On the client, create a new runtime with that value as `initialDb`,
install the same modules independently, and hydrate beneath its provider. Do
not serialize or reuse handler registries, queues, caches, or subscription
nodes. Multiple roots on one page may each hydrate with their own runtime.

## DevTools identity

Give long-lived runtimes a stable `runtimeId` and a readable `name`:

```ts
const runtime = createReflexRuntime({
  initialDb,
  runtimeId: 'checkout',
  name: 'Checkout',
});
```

The ID is immutable and scopes DevTools state, traces, handler lists, dispatch,
subscription evaluation, and reconnect behavior. Restore and `sinceId` cursor
tools are not part of this release. If exactly one runtime is connected,
clients may omit selection for compatibility. With multiple runtimes, select a
runtime explicitly before reading or mutating it. Give simultaneous runtimes
distinct IDs: reconnecting with an existing ID is treated as a new DevTools
session of that same runtime and supersedes its older socket. A changed
`sessionEpoch` always invalidates server trace IDs, but a transient reconnect
does not by itself prove that the application database restarted.

## Test isolation

Create a fresh runtime in each test instead of clearing the package-global
facade in shared hooks:

```ts
function setupTestRuntime() {
  const runtime = createReflexRuntime({ initialDb: { count: 0 } });
  const dispose = runtime.registerModule(counterModule);
  return { runtime, dispose };
}
```

Dispose feature modules and external consumers created by the test, then call
`runtime.dispose()` to release the runtime terminally. Runtime-owned watches,
timers, trace callbacks, and remaining module installations are released by
that operation; consumer cleanup functions remain idempotent if called again.

## Incremental migration and rollback

An application can migrate one root at a time:

1. Upgrade while retaining root imports and verify compatibility-facade tests.
2. Introduce a runtime factory and store-local contract without changing every
   feature at once.
3. Convert registrations into modules and install them on the explicit runtime.
4. Wrap one React root or subtree in `ReflexProvider`.
5. Move imperative dispatch, inspection, and headless calls to that runtime.
6. Repeat for other roots, requests, stories, or test suites.

To roll back an incomplete migration, remove the provider and return that
subtree's registrations and calls to the root facade. Do not register the same
feature against both `defaultRuntime` and an explicit runtime and expect their
state to synchronize; they are intentionally independent.

## Migration checklist

- Runtime creation occurs at the correct application or request boundary.
- React roots use the intended `ReflexProvider`.
- Headless code imports from `@flexsurfer/reflex/vanilla`.
- Feature registrations install on the intended runtime.
- Lazy/HMR code retains and invokes its module disposer.
- Active subscription consumers stop before module disposal.
- Store-local contracts cover the IDs and database shape being migrated.
- Tests use fresh runtimes and await `flush()` where asynchronous dispatch is
  under test.
- SSR never reuses a runtime or subscription cache across requests.
- Hydration creates a new client runtime from serialized database state.
- DevTools runtime IDs are stable where reconnect identity matters.

The authoritative ownership and lifecycle decisions are recorded in the
[instance-scoped runtime RFC](https://github.com/flexsurfer/reflex/blob/main/docs/runtime-rfc.md).
The public compatibility commitments are defined in
[Stability and versioning](stability-and-versioning.md).
