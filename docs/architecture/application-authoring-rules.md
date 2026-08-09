# Uklad application authoring rules

- **Status:** Working canonical rules
- **Scope:** Application-authored Uklad code: React, React Native, SSR, tests,
  and headless entry points

This is the short, normative companion to
[Canonical Uklad application structure](canonical-app-structure.md). Read it
before adding or changing application state, events, subscriptions, effects, or
coeffects. The canonical-structure document explains the rationale and full
directory layout; this document states the rules that application code,
templates, and the agent toolkit must follow.

These are application authoring rules, not conventions for implementing the
`@ukladjs/core` package itself. Core contributors should also follow
[code conventions](../engineering/code-conventions.md). The production-runtime
protection policy is decided by the
[Foundation ADR](foundation-adr.md#2-ai-first-authoring-integrity-boundaries-and-a-fast-production-core):
these rules are enforced first through agent skills, contracts, types,
templates, tests, and development diagnostics, rather than generalized work on
every production event or subscription path.

## Foundation: runtime-owned application data

The runtime exclusively owns application state and reactive values. Application
code changes state only through an event handler's Immer `draftState`; every
other consumer treats state snapshots and subscription results as read-only.
Keep mutable values outside the runtime to a minimum.

- Views consume subscription results and pass them to rendering. Presentation
  formatting is fine, but application-level filtering, sorting, grouping, and
  data shaping belong in subscriptions.
- Parameterized subscription queries use bounded tuples of scalar cache keys:
  `string`, finite `number`, `boolean`, or `null`. They identify a cached graph;
  they never transport application data objects.
- Component-local state is reserved for ephemeral UI mechanics such as focus,
  animation, or uncontrolled-input coordination. Shared, durable, or
  independently observed data belongs in runtime state.
- Runtime-wide interceptors are ordered, immutable runtime-creation policy.
  They are infrastructure hooks, not feature behavior, and they never belong
  in a feature module.
- Events express intent with small scalar parameters or IDs where possible,
  rather than carrying complex application objects.
- Prepare complex external data at its boundary. An effect or ingress adapter
  validates and normalizes that data, creates the final result event, dispatches
  it once, and does not mutate or retain the payload afterward. A coeffect
  supplies only a synchronous, already-prepared input to the current event.

### Synchronous turn contract

One event turn is the synchronous coeffect, interceptor, and event-handler
transition that begins after an event is accepted and ends before its effects
run. Effects are the sole supported path from that turn to later work.

- Do not call `dispatch`, `dispatchSync`, `debounceAndDispatch`, or
  `throttleAndDispatch` from a coeffect, interceptor, or event handler. Return
  a declarative effect instead. The development build may issue a cheap warning
  for a direct handler `dispatch`; agents and tests enforce the rest. The
  runtime still rejects `dispatchSync` reentrancy because it would violate
  serialized state transitions.
- Coeffects, interceptor hooks, event handlers, subscription dependency
  functions, and subscription computations must return synchronously. A
  returned promise or thenable is an authoring error; an effect must perform
  async work and dispatch a fresh result event when it finishes.
- The runtime does not recursively copy or freeze values when it takes
  ownership, even in development. Test mutable ingress at the adapter boundary
  and keep the ownership contract in application code.

The runtime cannot prevent a handler from manually scheduling arbitrary host
work such as `setTimeout`. Application code must not do that; model it as an
effect so the later dispatch crosses the same explicit boundary.

## Required rules

### 1. Use one application catalog and one complete contract

- Declare every application state root once in
  `src/app/uklad/catalog.ts` under `stateKeys`.
- Declare every application-defined event, subscription, custom effect, and
  coeffect ID once there under `appIds`.
- Use those catalog values in `AppContracts`, registrations, dispatches,
  subscription queries, effects, components, and tests. Do not repeat the
  same name as an unrelated raw string.
- Keep the complete `AppContracts` next to the catalog. Feature modules use
  that complete contract; they do not define feature-local contract subsets or
  `ids.ts` files.

State keys use lower-camel, feature-prefixed property names such as
`todosById` and `authSession`. String-addressed handler IDs use a slash-based
feature namespace such as `todos/add` and `auth/session`.

### 2. One application owns one runtime

- Create one runtime for one application root, one SSR request, one test
  fixture, or one independent headless execution.
- Feature modules only organize registrations. They must not create nested
  runtimes, feature-specific state domains, or feature-specific reactive
  graphs.
- Set the runtime default equality policy and ordered global interceptors only
  in application runtime composition. The runtime snapshots global interceptors
  at construction; they run before event-specific interceptors and unwind after
  them in reverse order.
- Cross-feature events and subscription dependencies are valid. A feature
  prefix communicates ownership; it is not an access boundary.

### 3. Keep application state flat at the reactive-root boundary

- Give every value that changes or is observed independently its own top-level
  state root.
- Name each root with its owning feature prefix so draft-state access remains
  ordinary dot notation: `draftState.todosById`, not
  `draftState['todos/by-id']`.
- Do not use one nested feature container such as `state.todos` for all of a
  feature's independently reactive values.
- Nested values are fine when they are one cohesive value. A `Todo` inside
  `todosById` does not need a root per field.

```ts
// Preferred: each independently reactive value has a root.
type AppState = {
  todosById: Record<string, Todo>;
  todosOrder: string[];
  todosFilter: TodoFilter;
  authSession: Session | null;
};

// Avoid: every todo change invalidates the same broad root.
type AppState = {
  todos: {
    byId: Record<string, Todo>;
    order: string[];
    filter: TodoFilter;
  };
};
```

When a state root must be queried, expose it with `regRootSub`; do not add a
computed pass-through subscription:

```ts
registrar.regRootSub(appIds.subscriptions.todosById, stateKeys.todosById);
```

The subscription ID is the public query name; the state key is the structural
storage property. They deliberately remain separate names.

### 4. Runtime owns application state snapshots

- Passing initial, restored, or hydrated state to a runtime transfers ownership
  of that value and everything reachable from it. Do not mutate it after the
  handoff.
- Treat state snapshots and subscription results as read-only values.
  Components, effects, coeffects, tests, and ordinary application code must
  not mutate them. Values mapped from an external system must be safe to own
  before they cross into Uklad state.
- State changes only through an event handler's Immer `draftState`. Build or
  validate any mutable external value before it enters state.

The runtime does not deep-freeze state at initialization, restoration, or
commit, or cached computed results. Tests and boundary adapters must expose
ownership mistakes; production code must obey this rule without defensive
copying or freezing.

### 5. Event inputs become runtime-owned at dispatch

- After `runtime.dispatch(event)`, never mutate the event vector, its
  parameters, or any reachable object that it contains.
- Build the final payload before dispatch. If data originates from a mutable or
  untrusted boundary, validate and clone or freeze it at that boundary before
  dispatching it.
- Event handlers treat their parameters and coeffect values as read-only.

Neither development nor production deep-freezes accepted events through
dispatch, delayed, throttled, or inspector routes. The no-copy fast path relies
on this ownership rule; test external adapters that need to accept mutable
input before they dispatch.

### 6. Keep event transitions synchronous and declarative

- An event handler performs a synchronous state transition through
  `draftState` and returns declarative effect tuples for follow-up work.
- Do not call `dispatch`, `dispatchSync`, `debounceAndDispatch`, or
  `throttleAndDispatch` from a coeffect, interceptor, or event handler. Return
  the built-in `dispatch` or `dispatch-later` effect, or a custom effect, when
  later work is required.
- An event handler must not return a promise or thenable. This is an authoring
  error; the runtime does not inspect every handler return value to diagnose it.
- Do not read browser, native, storage, clock, random, network, or other
  environmental APIs directly in an event or subscription. Model a write as
  an effect and a synchronous environmental input as a coeffect.
- Effects run after the state transition commits. An effect cannot roll back
  that transition, so state correctness must not depend on effect success.

### 7. Declare complete, static subscription dependencies

- A computed subscription declares every input it reads through its dependency
  function. Do not read application state, a runtime, or another subscription
  implicitly inside its compute function.
- Dependency and compute functions return synchronously. A promise or thenable
  must never become a cached reactive value. The runtime does not probe every
  return value for thenability; types, skills, and tests enforce this rule.
- Keep dependencies static for a serialized subscription query. A query's
  parameters may choose dependency queries, but a compute result must not
  secretly change the graph shape.
- Use a root subscription for a direct state-root read and `regSub` only for a
  derived value.

`regSubExt` is the narrow exception for an external lifecycle such as a
headless TanStack Query observer. It attaches to an already-registered
subscription without changing that subscription's pure data dependencies.
Declare any external inputs as its passive signals, keep the lifecycle in a
platform adapter, and use its `updateRoot` capability only to map a read-only
external result into an explicitly named root. Do not use an extension to hide
application state reads, mutate state directly, or run application commands;
those remain ordinary subscriptions and effects. See [TanStack Query
integration](tanstack-query.md).

### 8. Use bounded scalar subscription parameters

- A parameterized subscription declares a fixed-length parameter tuple in
  `AppContracts.subscriptions`; do not use an unbounded array parameter type.
- Each parameter is type-checked as a `SubscriptionParam`: `string`, `number`,
  `boolean`, or `null`. Do not pass `undefined`, objects, arrays, functions,
  symbols, `bigint`, `Date`, `Map`, `Set`, or regular expressions. TypeScript
  cannot distinguish finite numbers, so validate or test that boundary rule
  separately.
- `SubscriptionParam` is exported from the package root and
  `@ukladjs/core/vanilla` for shared helper types. Typed runtime
  construction rejects contracts that declare a non-scalar parameter tuple.
- An omitted subscription section or an explicit `any`-typed map retains the
  permissive compatibility surface. Treat that as an opt-out while migrating,
  not as an application-authoring pattern.
- Parameters identify one cached subscription graph. Pass IDs, flags, limits,
  or other small cache-key values—not a data object that the subscription could
  read from its declared state dependencies.

Subscription queries are serialized for cache identity. Restricting parameters
to this scalar set prevents cache-key collisions, unstable object serialization,
and stale graph reuse.

### 9. Choose an equality policy for every computed subscription

- A computed subscription uses the `equalityCheck` passed to `regSub` when one
  is supplied; otherwise it uses the runtime's default equality policy. Root
  subscriptions have no equality configuration because they expose their source
  root directly.
- Set the runtime default with the `equalityCheck` option during
  `createUkladRuntime` composition. The framework default is deep equality
  through `fast-deep-equal`; cached subscriptions capture the selected policy
  when they are first created.
- An application may set `equalityCheck: () => false` to treat every computed
  result as changed and disable equality cutoffs by default. A subscription can
  still provide its own `equalityCheck` override.
- Use `Object.is` for a result that preserves meaningful reference identity.
  Use `shallowEqual` for a freshly allocated shallow array or object whose
  elements or properties preserve identity. Use a small, documented domain
  comparator when neither is correct.
- An equality function must be pure, deterministic, and side-effect-free. It
  decides whether downstream graph work and notifications stop, not merely
  whether React renders.

```ts
import { createUkladRuntime, shallowEqual } from '@ukladjs/core/vanilla';

const runtime = createUkladRuntime({
  initialState,
  equalityCheck: () => false,
});

registrar.regSub(
  appIds.subscriptions.todosVisible,
  () => [
    [appIds.subscriptions.todosById],
    [appIds.subscriptions.todosOrder],
    [appIds.subscriptions.todosFilter],
  ],
  ([todosById, todosOrder, filter]) => selectVisible(todosById, todosOrder, filter),
  { equalityCheck: shallowEqual },
);
```

### 10. Keep environment implementations at the platform boundary

- Events emit platform-neutral effect intents under stable application IDs.
- Each runtime installs exactly one matching platform set of effect and
  coeffect handlers: web, native, headless, or test.
- Register those handlers in `src/platform/<target>/effects.ts` and
  `src/platform/<target>/coeffects.ts`, not in feature modules and not behind
  platform conditionals inside events or subscriptions.
- Keep an effect or coeffect ID and its contract stable across targets. A
  target-specific no-op is acceptable only when deliberate and documented.

Coeffects are synchronous environmental reads. An event explicitly requests a
coeffect and binds its value to a local name. A missing or throwing coeffect
aborts the event before it can commit state. Coeffect handlers receive a
frozen, state-free read view and must not mutate state or perform asynchronous
work. An asynchronous read is an effect followed by a result event.

## Change checklist

| Change                               | Required application updates                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independently reactive data          | `stateKeys`, `AppContracts.state`, feature initial state, and a root subscription if it is queried                                                        |
| Initial, restored, or hydrated state | Validate and normalize it at the input boundary, transfer ownership to the runtime, and never mutate it after handoff                                     |
| Runtime-wide policy                  | Pass the default `equalityCheck` and ordered global `interceptors` to `createUkladRuntime`; feature modules do not alter either policy                   |
| Event                                | `appIds.events`, `AppContracts.events`, and its feature registration                                                                                      |
| Derived subscription                 | `appIds.subscriptions`, `AppContracts.subscriptions`, complete dependencies, bounded scalar query parameters if any, and an equality override when needed |
| Environment write                    | `appIds.effects`, `AppContracts.effects`, platform handlers for every supported target                                                                    |
| Environmental input                  | `appIds.coeffects`, `AppContracts.coeffects`, platform handlers for every supported target, and explicit event binding                                    |
| New feature                          | Feature directory and module; add it to application composition without creating another runtime                                                          |

## Further detail

- [Canonical application structure](canonical-app-structure.md) explains the
  shared-runtime model, catalog, directory layout, and platform boundary.
- [Subscription runtime](subscription-runtime.md) documents graph lifecycle,
  publication, and equality-cutoff semantics.
- [Foundation ADR](foundation-adr.md) records the immutable-event and
  deliberate-equality-policy design direction.
