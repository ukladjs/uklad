# RFC: Instance-scoped Reflex runtime

- **Status:** Implemented; release acceptance awaits Phase 1 performance budgets
- **Last updated:** 2026-07-17
- **Compatibility target:** existing `@flexsurfer/reflex` imports remain a facade over one default runtime

## Summary

Reflex state belongs to an explicit `ReflexRuntime` instance. An instance owns every mutable part of event processing, subscriptions, diagnostics, and tracing. Applications can create one runtime per browser root, request, embedded widget, Storybook story, test, or agent sandbox without sharing state through module globals.

```tsx
import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import { ReflexProvider, useSubscription } from '@flexsurfer/reflex/react';

const runtime = createReflexRuntime({
  initialState: { count: 0 },
  runtimeId: 'counter-widget',
  name: 'Counter widget',
});

const disposeFeature = runtime.registerModule((scope) => {
  scope.regEvent('count/increment', ({ draftState }) => {
    draftState.count += 1;
  });
  scope.regRootSub('count', 'count');
});

function Root() {
  return (
    <ReflexProvider runtime={runtime}>
      <App />
    </ReflexProvider>
  );
}
```

## Ownership

Each runtime exclusively owns:

| Concern              | Instance-owned state                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| State             | live write head, render/read head, pending publication flag                                                 |
| Events               | queue, queue state, current event/handler metadata, event interceptors                                      |
| Registries           | event, effect, coeffect, subscription, dependency, and error handlers; framework built-ins                  |
| Cross-cutting policy | ordered global interceptors and default subscription equality function                                      |
| Subscriptions        | engine epochs, canonical query cache, dependency index, root metadata, configuration, provisional lifetimes |
| Tracing              | trace IDs, active parent, pending batches, callbacks, leases, and timers                                    |
| Scheduling           | callbacks scheduled for that runtime and flush waiters                                                      |
| Modules              | registrations and cleanup associated with each module installation                                          |
| Inspection           | runtime identity and an adapter bound to the owning runtime                                                 |

No instance operation consults an ambient “current runtime.” Scheduled work captures its owner explicitly, so two runtimes can interleave without context leakage.

## Public API

### Creation and identity

```ts
const runtime = createReflexRuntime<Contracts>({
  initialState,
  runtimeId?: string,
  name?: string,
});
```

`runtimeId` is immutable and identifies the runtime in DevTools and reconnects for the lifetime of the application runtime. Callers that need identity to survive reloads supply it; otherwise Reflex generates a process-unique ID. Simultaneously connected runtimes must use distinct IDs; reusing an ID deliberately means “this is the next session of the same runtime” and supersedes its prior DevTools connection. `name` is an immutable human-readable label and defaults to the ID.

Runtime methods are the instance equivalents of the legacy functions: state access and restore, event/effect/coeffect/subscription registration, dispatch, subscription evaluation and watching, global interceptors, equality, tracing, registry diagnostics, reset, module installation, and inspector creation.

### Store-local contracts

Global module augmentation remains supported by the compatibility facade. New code can instead define a local contract:

```ts
interface Contracts extends ReflexContracts {
  state: { count: number };
  events: {
    'count/increment': [amount?: number];
  };
  effects: {
    analytics: { name: string };
  };
  subscriptions: {
    count: { params: []; result: number };
  };
}
```

The contract is compile-time only. Runtime validation and externally supplied schemas are separate concerns. Missing contract sections retain permissive legacy types, allowing incremental adoption.

### Feature registration

`runtime.registerModule(feature)` executes a synchronous installer and returns an idempotent disposer. Registrations made through the supplied runtime during installation are owned by that installation. An optional feature cleanup runs before definitions are detached so it can release module-owned watchers and other resources. Disposal then removes only registrations that still refer to that installation; it never clears unrelated or newer handlers.

Module installers cannot call `registerModule` recursively. Compose installers as ordinary synchronous functions inside one module installation when a feature has submodules; this keeps registration ownership unambiguous.

A subscription definition cannot be removed while one of its graphs is active. Applications must unmount/unwatch consumers before disposing the feature; Reflex fails loudly instead of leaving a partially detached graph. Repeated disposal is a no-op. These rules make route-level lazy loading and dispose-then-install HMR deterministic.

### Headless reads and watches

`runtime.getSubscriptionValue(query)` performs a memoized non-React read. `runtime.watchSubscription(query, listener, options?)` activates the same subscription graph used by React and returns an idempotent unsubscribe function. The default is to emit the current value synchronously; `{ emitInitial: false }` observes changes only. The listener receives `(value, previousValue)`.

### Unknown ids fail loudly

Instance entry points throw on malformed vectors and unregistered ids: `dispatch` and `dispatchSync` reject an event id with no registered handler, and `getSubscriptionValue` / `watchSubscription` reject an unregistered subscription id. String ids are only safe when mistakes surface immediately; the instance API has no 0.x compatibility constraint, so it is strict from its first release. The compatibility facade's root functions keep the lenient console-error behavior. `useSubscription` reads through the provider runtime's instance API and therefore adopts the strict behavior, including for the default runtime. Events already accepted into the queue stay lenient: a handler removed between dispatch and processing logs and drops that event only.

### Restore and flush

`runtime.restoreState(nextState)` replaces both state heads and synchronously publishes changed roots. It is rejected while event work is pending or being handled, and during subscription computation or listener delivery. Await `runtime.flush()` before restoring after asynchronous dispatch. Restore does not run event handlers or effects.

`await runtime.flush()` is the explicit quiescence boundary for headless code and tests. It waits until events already accepted by the runtime (including events synchronously enqueued by their effects) leave the queue, then promotes the latest committed state generation and completes listener delivery. It does not wait for future work such as `dispatch-later`, arbitrary effect promises, or events dispatched after the flush call. `dispatchSync` remains a synchronous handle-and-publish boundary.

### React binding

`<ReflexProvider runtime={runtime}>` selects a runtime for descendant Reflex hooks. Providers may be nested. `useSubscription` uses the nearest provider and falls back to the compatibility default runtime when no provider is present, so existing applications do not need an immediate migration.

## Lifecycle and reset

Creation installs fresh framework built-ins (`dispatch`, `dispatch-later`, `now`, `random`, and the default event error handler) into that instance only. `clearHandlers` restores those built-ins and removes user definitions in the target instance. Clearing subscriptions remains illegal while an active graph exists. `restoreState` is the supported state-restoration primitive; `initState` remains the compatibility/bootstrap name on the default runtime.

`runtime.dispose()` terminally releases instance-owned watches, module installations, delayed dispatches and rate-limit timers, event-queue waiters, tracing timers/callbacks, handlers, and subscription definitions. It is idempotent. Applications must first unmount or unsubscribe consumers that were created outside the runtime's own `watchSubscription` API; disposal fails loudly while such a subscription graph remains active and can be retried after the consumer releases it. Later instance and inspector read/control operations fail as disposed; previously returned cleanup functions remain safe idempotent no-ops. The compatibility `defaultRuntime` is process-owned and cannot be disposed.

## Entrypoints

- `@flexsurfer/reflex/vanilla` contains the instance runtime and all non-React APIs and types. Importing it must not load React.
- `@flexsurfer/reflex/react` contains `ReflexProvider`, runtime context access, `useSubscription`, and hot-reload helpers.
- `@flexsurfer/reflex` remains the compatibility entrypoint and re-exports both surfaces.

## Compatibility facade

The named functions at the package root delegate to one exported `defaultRuntime`. They retain their current signatures, global augmentation behavior, scheduling, and built-ins. The default runtime has ID `default` and name `Default runtime`. This facade is a migration bridge, not a second implementation.

Legacy and instance calls deliberately interoperate when they target `defaultRuntime`; for example, a legacy `regEvent` is visible through `defaultRuntime.createInspector()`. Separate runtimes never observe or mutate those registrations.

## SSR and hydration

Server code creates a runtime inside the request boundary and never exports it from a shared module. Rendering reads that request's render head. The serialized state can be passed to a newly created client runtime as `initialState`; handlers/modules are registered independently on each side. A runtime and its cached subscription nodes must never be reused across requests.

Hydration does not require a provider-global singleton. Multiple roots on one page may hydrate with independent runtimes, IDs, states, queues, and caches.

## DevTools routing

Inspectors expose immutable `runtimeId` and `runtimeName`. Runtime connections identify themselves with both values. The server stores simultaneous runtime sessions keyed by runtime ID, gives each connection a new session epoch while that bounded registry entry is retained, and scopes snapshots, handler lists, traces, dispatch, and subscription evaluation to a selected runtime. Restore and `sinceId` cursor APIs remain follow-up work.

Control requests carry `runtimeId`. Omitting it is accepted only when exactly one runtime is connected, preserving single-runtime clients without ambiguous mutation. A reconnect with the same runtime ID supersedes only that runtime's older socket and starts a new DevTools session epoch; it does not disconnect other runtimes. The epoch means server-side session storage was reset, not necessarily that the application runtime or its state restarted. If a disconnected entry is evicted from the bounded registry, a later connection with that ID starts a fresh epoch history. UI and MCP status responses list runtimes and the active/default selection explicitly.

## Migration and stability constraints

1. Existing root imports and global augmentation continue to compile and behave through the default runtime.
2. The vanilla entrypoint stays React-free and works in Node/headless and SSR environments.
3. Runtime identity, contract field names, provider semantics, disposer idempotence, flush semantics, and fail-loud unknown-id behavior are release-candidate stability commitments.
4. Internal ownership structures and diagnostic fields may grow additively before final 1.0, but cross-runtime leakage is always a correctness bug.
5. No automatic process-global runtime discovery or merging is permitted. Duplicate package-copy detection may warn, but explicit runtime instances within one package copy are expected and must not warn.

## Acceptance gates

The architecture is accepted only when automated tests prove:

- two runtimes in one JavaScript realm have independent state heads, handlers, queues, subscriptions, tracing, and resets;
- parallel tests and concurrent SSR requests cannot observe each other's state;
- module installation/disposal is scoped and idempotent;
- React providers select and nest runtimes correctly;
- restore, watch, dispatch, `dispatchSync`, and `flush` follow the contracts above;
- the legacy facade and the default runtime are the same state owner;
- package tarballs expose working root, vanilla, and React ESM/CJS/type entrypoints;
- DevTools keeps multiple runtimes connected and routes all reads/mutations by runtime ID;
- existing subscription-runtime correctness and performance budgets do not materially regress.

## Non-goals

This RFC does not add persistence adapters, async task supervision, runtime payload schemas, time travel, or automatic cross-request runtime management. Those features build on this ownership boundary after the release candidate.
