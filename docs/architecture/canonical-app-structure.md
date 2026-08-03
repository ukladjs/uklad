# Canonical Uklad application structure

- **Status:** Working canonical design
- **Last updated:** 2026-07-30
- **Scope:** Application-authored Uklad code for React, React Native, SSR,
  tests, and headless execution

## Purpose

This document captures the application structure agreed for the next Uklad API,
examples, templates, and agent toolkit. It defines the target authoring model;
existing examples and agent instructions may still use older structures until
they are migrated.

For the concise, normative checklist that application code, templates, and the
agent toolkit must follow, see [Application authoring
rules](application-authoring-rules.md). This document supplies the rationale,
examples, and complete structural model behind those rules.

The design optimizes for two related goals:

- predictable application architecture at every project size; and
- context-efficient discovery for coding agents and tooling.

## Decisions at a glance

1. A Uklad application normally owns one shared runtime, one application state
   object, one complete `AppContracts`, and one runtime-scoped reactive graph.
2. Feature modules organize application-wide registrations. They do not create
   state domains, contract scopes, graph boundaries, or child runtimes.
3. Application state is flat at the reactive-root boundary. Independently
   changing or independently observed values use independent top-level keys.
4. Application code is feature-based, including small applications.
5. One application catalog next to `AppContracts` exports `stateKeys` for
   structural state properties and `appIds` for runtime handler identifiers.
6. Every state key is an identifier-like property name with a required feature
   prefix, such as `todosById` or `authSession`, so handlers can use dot
   notation.
7. Event, subscription, custom effect, and coeffect IDs use slash-based feature
   namespaces such as `todos/` or `auth/`.
8. A prefix communicates ownership and prevents cross-feature naming
   collisions. It is not an access boundary; cross-feature dependencies are
   valid.
9. The application catalog contains names only. Payloads, parameters, results,
   and state types belong in `AppContracts`; no additional catalog metadata is
   required.
10. Effects and coeffects keep the same IDs across platforms. Platform folders
    register the web, native, headless, or test implementation for one runtime.

## One application runtime

A normal Uklad application has one application-owned runtime. That runtime is
the sole owner of:

- the application state;
- event, effect, coeffect, and subscription registrations;
- event processing and state publication;
- the subscription cache and reactive graph; and
- module registration and disposal.

Events, effects, coeffects, and subscriptions are application-wide
capabilities. A feature prefix makes ownership easy to see, but any feature may
dispatch an event or depend on a subscription owned by another feature.

`AppContracts` describes the complete application capability surface. Feature
modules are intentionally typed against that complete contract rather than
smaller feature-local contracts.

Feature modules are organizational, registration, and lifecycle units only.
Installing a module does not create:

- private feature state;
- a feature-specific runtime;
- a feature-specific reactive graph;
- an access-control boundary; or
- an isolated contract namespace.

### When multiple runtimes are appropriate

Multiple runtimes remain valid when there are genuinely separate execution
owners:

- separate application roots or embedded applications;
- one runtime per SSR request;
- isolated test cases or fixtures;
- independent headless executions; and
- other cases that require separate state and lifecycle ownership.

A feature inside one application is not, by itself, a reason to create another
runtime.

## Flat reactive roots

Application state is one object whose top-level keys are reactive roots. Each
value that changes independently or is commonly observed independently should
have its own root key.

Preferred:

```ts
type AppState = {
  [stateKeys.todosById]: Record<TodoId, Todo>;
  [stateKeys.todosOrder]: TodoId[];
  [stateKeys.todosFilter]: TodoFilter;
  [stateKeys.todosDraft]: TodoDraft;
  [stateKeys.authSession]: Session | null;
  [stateKeys.authStatus]: AuthStatus;
};
```

Avoid one root that contains an entire feature:

```ts
type AppState = {
  todos: {
    byId: Record<TodoId, Todo>;
    order: TodoId[];
    filter: TodoFilter;
    draft: TodoDraft;
  };
};
```

This is a performance invariant, not only a naming preference.
`StateStore` detects changed subscription roots by comparing each root value by
identity, and the subscription engine propagates only those changed roots. A
mutation anywhere inside one large `todos` object changes that object's
identity and reevaluates the dependent subgraph rooted there. Independent roots
allow Uklad to start publication from only the affected values.

Downstream subscription equality may still stop propagation and prevent
consumer notification. Flat roots reduce the work that enters the graph; they
do not imply that every dependent consumer would otherwise render.

Nested data is still valid when it forms one cohesive reactive value. A `Todo`
inside `todosById`, for example, does not need a separate application root
for every field. The decision rule is:

> Values that change or are observed independently should have independent
> reactive roots.

One event may update several roots in one state transition. Flat roots do not
remove transactional consistency.

State roots are lower-camel, identifier-like property names so event handlers
and other typed state access can use ordinary dot notation:

```ts
draftState.todosById[id] = todo;
draftState.todosOrder.push(id);
```

The owning feature name is the required property prefix: `todosById`,
`todosOrder`, `authSession`, and `authStatus`. Slash-separated names are not
used for state roots.

See the current
[`StateStore` publication boundary](../../packages/core/src/runtime/state.ts)
and
[`SubscriptionEngine` propagation](../../packages/core/src/runtime/subscriptions/engine.ts)
for the implementation behind this rule.

## Application catalog

The application has one catalog next to `AppContracts`:

```text
src/app/uklad/catalog.ts
src/app/uklad/contracts.ts
```

The catalog has two separate top-level exports:

- `stateKeys` is the authoritative collection of top-level application-state
  property keys; and
- `appIds` is the authoritative collection of application-defined event,
  subscription, custom effect, and coeffect handler IDs.

State keys are not handler IDs. Keeping both exports in one compact file
preserves one discovery surface without conflating their roles.

Feature directories do not contain their own `ids.ts`, `event-ids.ts`,
`sub-ids.ts`, `state-keys.ts`, or equivalent catalog files.

A recommended catalog shape is:

```ts
export const stateKeys = {
  todosById: 'todosById',
  todosOrder: 'todosOrder',
  todosFilter: 'todosFilter',
  todosDraft: 'todosDraft',
  authSession: 'authSession',
  authStatus: 'authStatus',
} as const;

export const appIds = {
  events: {
    todosAdd: 'todos/add',
    todosToggle: 'todos/toggle',
    authSignIn: 'auth/sign-in',
    authSignOut: 'auth/sign-out',
  },
  subscriptions: {
    todosById: 'todos/by-id',
    todosOrder: 'todos/order',
    todosFilter: 'todos/filter',
    todosDraft: 'todos/draft',
    todosVisible: 'todos/visible',
    authSession: 'auth/session',
    authStatus: 'auth/status',
  },
  effects: {
    todosPersist: 'todos/persist',
    authStoreSession: 'auth/store-session',
  },
  coeffects: {
    systemNow: 'system/now',
    systemRandom: 'system/random',
  },
} as const;
```

Values in both collections should be direct string literals rather than
dynamically constructed strings. Direct literals make text search, static
analysis, code review, and partial file reads reliable.

Handler registrations, dispatches, subscription queries and dependencies, and
effect tuples use `appIds`. Root-subscription source-key arguments use
`stateKeys`. State access uses the catalog-declared property through dot
notation, such as `draftState.todosById`.

An application-defined handler ID or state key should not be repeated as an
independent raw string in `AppContracts`, a feature module, a component, or a
test.

### Identifier ownership and naming

State roots use a lower-camel, identifier-like property name:

```text
<owningFeature><RootName>
```

Examples include `todosById`, `todosOrder`, `authSession`, and
`navigationCurrentRoute`. This preserves direct access such as
`draftState.authSession`.

String-addressed event, subscription, custom effect, and coeffect IDs use:

```text
<owning-feature>/<semantic-name>
```

Examples include `todos/add`, `todos/visible`, `auth/sign-in`, and
`navigation/current-route`.

The prefix:

- identifies the owning feature;
- groups related capabilities during search;
- prevents unrelated features from choosing the same unqualified name; and
- does not restrict which code may use the identifier.

Neither naming form creates a state domain, import boundary, permission, or
runtime boundary.

### Root subscription mapping

A root subscription explicitly connects a subscription handler ID to its
backing state property:

```ts
registrar.regRootSub(appIds.subscriptions.todosById, stateKeys.todosById);
```

The arguments have different roles:

- `appIds.subscriptions.todosById` is the runtime subscription ID
  `todos/by-id`. Components and computed subscriptions query this ID.
- `stateKeys.todosById` is the structural state property `todosById`. Event
  handlers access it as `draftState.todosById`.

The subscription ID and state key therefore remain separate authoritative
names. `regRootSub` is the explicit mapping between the query surface and the
state storage shape.

Registering a root subscription declares that its backing state key can enter
the reactive graph. Uklad observes identity changes at that root; it does not
make the value deeply reactive. Nested mutations performed through Immer change
the containing root identity.

Root subscription IDs live beside computed subscription IDs under
`appIds.subscriptions`. Their `AppContracts.subscriptions` entries declare an
empty parameter tuple and a result type matching the backing state root.

Uklad-owned identifiers are outside `appIds`. In particular, the built-in
effects `dispatch` and `dispatch-later` remain runtime-reserved identifiers and
do not require application feature prefixes. The event-context keys `event`
and `draftState` are likewise runtime-owned and cannot be used as application
coeffect IDs or named coeffect-binding slots.

## Complete application contracts

The catalog answers **which state keys and handler IDs exist**. `AppContracts`
answers **what each name means at the type boundary**.

`AppContracts` should use catalog values as computed keys so every state-key and
handler-ID string has one source of truth:

```ts
import type { UkladContracts } from '@ukladjs/core/vanilla';

import { appIds, stateKeys } from './catalog';
import type { AuthStatus, Session } from '../../features/auth/state';
import type { Todo, TodoDraft, TodoFilter, TodoId } from '../../features/todos/state';

export interface AppContracts extends UkladContracts {
  state: {
    [stateKeys.todosById]: Record<TodoId, Todo>;
    [stateKeys.todosOrder]: TodoId[];
    [stateKeys.todosFilter]: TodoFilter;
    [stateKeys.todosDraft]: TodoDraft;
    [stateKeys.authSession]: Session | null;
    [stateKeys.authStatus]: AuthStatus;
  };

  events: {
    [appIds.events.todosAdd]: [title: string];
    [appIds.events.todosToggle]: [id: TodoId];
    [appIds.events.authSignIn]: [email: string, password: string];
    [appIds.events.authSignOut]: [];
  };

  subscriptions: {
    [appIds.subscriptions.todosById]: {
      params: [];
      result: Record<TodoId, Todo>;
    };
    [appIds.subscriptions.todosOrder]: {
      params: [];
      result: TodoId[];
    };
    [appIds.subscriptions.todosFilter]: {
      params: [];
      result: TodoFilter;
    };
    [appIds.subscriptions.todosDraft]: {
      params: [];
      result: TodoDraft;
    };
    [appIds.subscriptions.todosVisible]: {
      params: [];
      result: Todo[];
    };
    [appIds.subscriptions.authSession]: {
      params: [];
      result: Session | null;
    };
    [appIds.subscriptions.authStatus]: {
      params: [];
      result: AuthStatus;
    };
  };

  effects: {
    [appIds.effects.todosPersist]: {
      todos: Record<TodoId, Todo>;
    };
    [appIds.effects.authStoreSession]: Session | null;
  };

  coeffects: {
    [appIds.coeffects.systemNow]: { arg: void; value: number };
    [appIds.coeffects.systemRandom]: { arg: void; value: number };
  };
}
```

The contract is application-owned and complete across features. Feature
installers receive `UkladRegistrar<AppContracts>` and may register dependencies
across any declared feature namespace.

The catalog and contract are intentionally adjacent. They form the smallest
static index an agent needs before opening implementation files:

1. read `catalog.ts` to discover state keys and runtime handler IDs;
2. read `contracts.ts` to learn their types; and
3. open the owning feature for events and subscriptions, or the selected
   platform registration for effects and coeffects.

## Platform effect and coeffect registrations

Effect and coeffect IDs are application-wide and stable across platforms. Their
registered handlers are platform-specific.

```text
appIds.effects.todosPersist       -> todos/persist
appIds.coeffects.systemNow        -> system/now

web runtime       -> web handlers
native runtime    -> native handlers
headless runtime  -> headless handlers
test runtime      -> test handlers
```

The application keeps those registrations under a dedicated platform boundary:

```text
src/
  platform/
    web/
      effects.ts
      coeffects.ts
    native/
      effects.ts
      coeffects.ts
    headless/
      effects.ts
      coeffects.ts
    test/
      effects.ts
      coeffects.ts
```

The `test/` platform is used by integration tests that create a real runtime.
Unit tests for pure event and subscription logic do not need to install
platform handlers.

Each platform file registers the same application IDs with the implementation
appropriate for that environment:

```ts
// platform/web/effects.ts
import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

export const registerWebEffects: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regEffect(appIds.effects.todosPersist, ({ todos }) => {
    window.localStorage.setItem('todos', JSON.stringify(todos));
  });
};
```

Coeffects follow the same pattern. A coeffect handler returns one value. The
runtime retains it under the coeffect's provider ID, and an event binds that
provider to an ergonomic local input name:

```ts
// platform/web/coeffects.ts
export const registerWebCoeffects: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regCoeffect(appIds.coeffects.systemNow, () => Date.now());
};
```

The platform entry point selects exactly one effect module and one coeffect
module for its runtime:

```ts
runtime.registerModule(todosModule);
runtime.registerModule(authModule);
runtime.registerModule(registerWebEffects);
runtime.registerModule(registerWebCoeffects);
```

A native or headless entry point installs `registerNativeEffects` and
`registerNativeCoeffects`, or `registerHeadlessEffects` and
`registerHeadlessCoeffects`, instead. Tests install the corresponding test
modules.

Platform modules follow these rules:

- IDs and payload contracts do not contain platform suffixes and do not change
  between environments.
- Shared events emit the same effect intents on every platform.
- Each runtime installs at most one application handler for an effect or
  coeffect ID.
- Platform selection happens at the application entry point, not through
  platform checks inside events or subscriptions.
- Headless and test effects should use safe in-memory or recording
  implementations when real external work is undesirable.
- A platform-specific no-op must be deliberate and documented; missing required
  handlers must not be treated as successful execution.
- Coeffect handlers provide synchronously available environmental input.
  Asynchronous reads are effects that later dispatch a result event.

`AppContracts.effects` defines the shared effect payloads, and
`AppContracts.coeffects` does the same for coeffects — one entry per ID
declaring the argument it is injected with and the value it contributes:

```ts
// app/uklad/contracts.ts
export interface AppContracts extends UkladContracts {
  coeffects: {
    [appIds.coeffects.systemNow]: { arg: void; value: number };
    [appIds.coeffects.systemRandom]: { arg: void; value: number };
  };
}
```

Because the contract is keyed by provider ID, one declaration types every
platform's `regCoeffect` implementation and every event request for that
provider. A named event binding then maps the provider's declared value to its
own handler-local property. This holds a web, native, headless, and test
adapter for the same ID to one shape without making slash IDs awkward inside
event handlers.

An event names the coeffects it needs at registration, and receives exactly
those under its nested `coeffects` input:

```ts
registrar.regEvent(
  appIds.events.todosAdd,
  ({ draftState, coeffects: { now } }, title) => {
    draftState.todosById[now] = { id: now, title, done: false };
  },
  { coeffects: { now: appIds.coeffects.systemNow } },
);
```

Every coeffect requested in an event registration is required. A missing handler or
a handler that throws aborts the event through normal error handling before its
event handler or state transition runs. A handler may deliberately return
`undefined`; that is a successful injection whose key remains present.

For the rare coeffect that must derive from the dispatched event or an earlier
injection, the optional second handler argument is a frozen, state-free view.
It contains the event and prior injected values, but never `draftState`.
Cross-coeffect dependencies are ordered by the event registration and should
remain exceptional.

Coeffect IDs are global provider identities and use the same slash namespaces
as other runtime handlers. Their event-local binding slots are lower-camel,
identifier-like names such as `now`, `stored`, or `sessionToken`. A provider
ID names the value being read rather than the act of reading it — `system/now`
and `storage/session-token`, not `system/get-now` or `storage/read-token`.

Bindings form the event-handler boundary: application handlers read the
local slots from `coeffects`, while provider IDs remain available only to
ordered coeffects and infrastructure interceptors inside the event pipeline.

This platform boundary is an intentional exception to feature-local
implementation placement. State, events, subscriptions, and UI remain
feature-based; environment-facing handler registrations are grouped by the
runtime platform that supplies them.

## Canonical directory structure

The application uses feature-based organization even when it is small:

```text
src/
  app/
    uklad/
      catalog.ts
      contracts.ts
      initial-state.ts
      runtime.ts
      bindings.ts
      register.ts

  features/
    todos/
      state.ts
      events.ts
      subscriptions.ts
      module.ts
      ui/

    auth/
      state.ts
      events.ts
      subscriptions.ts
      module.ts
      ui/

  platform/
    web/
      effects.ts
      coeffects.ts
    native/
      effects.ts
      coeffects.ts
    headless/
      effects.ts
      coeffects.ts
    test/
      effects.ts
      coeffects.ts

  main.tsx
```

Empty files are not required. The feature directory is stable as the
application grows, so a small application does not need a later structural
migration from a global `state/`, `events/`, or `subscriptions/` directory.
An application only needs platform directories for the execution targets it
supports; `test/` is recommended when integration tests install a complete
runtime.

Each target-specific entry point installs the shared feature modules and the
matching pair of platform modules. Applications with more than one target may
use separate entry points even when their framework-specific filenames differ
from the generic `main.tsx` shown above.

### Application composition files

`src/app/uklad/` owns the shared application boundary:

| File               | Responsibility                                                                |
| ------------------ | ----------------------------------------------------------------------------- |
| `catalog.ts`       | Central `stateKeys` and `appIds` collections                                  |
| `contracts.ts`     | The complete application state, event, subscription, and effect type contract |
| `initial-state.ts` | Composition of feature-owned initial root values into one application state   |
| `runtime.ts`       | Runtime creation or a runtime factory for the relevant execution owner        |
| `bindings.ts`      | Contract-bound React or React Native provider and hooks                       |
| `register.ts`      | Installation of the application's platform-independent feature modules        |

### Feature files

A feature owns the implementation associated with its namespace:

| File               | Responsibility                                                    |
| ------------------ | ----------------------------------------------------------------- |
| `state.ts`         | Domain types plus initial values for the feature-owned flat roots |
| `events.ts`        | Pure application state transitions and returned effect intents    |
| `subscriptions.ts` | Root and computed subscription registrations                      |
| `module.ts`        | One feature installer that groups events and subscriptions        |
| `ui/`              | Feature-owned React or React Native UI                            |

`state.ts` does not define one nested feature state container. It contributes
several independently reactive application roots.

`module.ts` does not create a runtime. It groups registrations against the
application contract. Platform effects and coeffects are deliberately absent:

```ts
import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerTodoEvents } from './events';
import { registerTodoSubscriptions } from './subscriptions';

export const todosModule: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registerTodoEvents(registrar);
  registerTodoSubscriptions(registrar);
};
```

The application composition layer installs it:

```ts
runtime.registerModule(todosModule);
runtime.registerModule(authModule);
```

Separate module installations preserve feature-level disposal, HMR, and
optional lazy-registration ownership without creating runtime isolation.

### Platform files

Each platform directory owns the environment-facing registrations for the
whole application:

| File           | Responsibility                                                 |
| -------------- | -------------------------------------------------------------- |
| `effects.ts`   | Implement all required application effect IDs for the target   |
| `coeffects.ts` | Implement all required application coeffect IDs for the target |

These files are intentionally application-level rather than nested below
features. If one grows too large, it may delegate to internal platform-local
files while keeping `effects.ts` or `coeffects.ts` as the target's single
registration entry point.

## React, React Native, SSR, tests, and headless execution

The feature and contract model is platform-independent. Platform-specific code
stays at platform registration, adapter, and UI boundaries.

- React and React Native bind their provider and hooks once against
  `AppContracts`.
- A web entry point installs `platform/web/effects.ts` and
  `platform/web/coeffects.ts`.
- A React Native entry point installs `platform/native/effects.ts` and
  `platform/native/coeffects.ts`.
- SSR creates a runtime inside each request boundary and registers the same
  application modules plus server-safe headless effect and coeffect
  registrations for that request.
- The browser creates its own client runtime from the serialized initial state;
  it does not reuse the server runtime.
- Integration tests create isolated runtimes with test effect and coeffect
  registrations rather than resetting a shared process-global runtime. Pure
  unit tests may omit environment handlers.
- Headless entry points create and own an explicit runtime without importing a
  React adapter and install the headless registrations.

## Agent and tooling consequences

The canonical discovery path is intentionally bounded:

```text
catalog -> AppContracts -> owning feature or selected platform -> implementation
```

An agent should not need to scan every feature to answer:

- which state roots exist;
- which root subscription exposes a state root;
- which event can be dispatched;
- which subscription can be queried;
- which custom effect can be emitted;
- which coeffect can be requested; or
- which feature owns an identifier.

The application catalog requires no descriptions, schemas, source locations,
or other metadata. `AppContracts` supplies the compile-time shapes, and the
feature or selected platform implementation supplies behavior.

This rule is scoped to the application catalog. It does not decide
whether a separate externally callable command or operation API may require
schemas, policy, or execution metadata.

Templates and the agent toolkit should generate and maintain this shape. They
should not teach per-feature ID files or a single global implementation-oriented
`src/state/` directory.

## Invariants

- One execution owner has one runtime.
- One runtime has one application state and one reactive graph.
- `AppContracts` describes the whole application, not a feature subset.
- Feature modules organize registrations; they do not isolate capabilities.
- Independently changing or observed values have independent root state keys.
- Every application state key is declared once under `stateKeys`.
- Every application-defined handler ID is declared once under `appIds`.
- Every state root is an identifier-like property name with an owning feature
  prefix.
- Every application-defined event, subscription, custom effect, and coeffect ID
  has an owning slash-based feature namespace.
- Every root subscription explicitly maps one `appIds.subscriptions` entry to
  one `stateKeys` entry.
- Effect and coeffect IDs and their contracts are stable across platforms.
- Each runtime installs one matching platform implementation set; feature
  modules do not select or register platform handlers.
- Every coeffect named by an event is required; a missing or throwing handler
  aborts that transition before state can commit.
- Coeffect handlers receive a frozen, state-free read view and never receive
  `draftState`.
- Prefixes communicate ownership, not permissions.
- Cross-feature dispatch and subscription dependencies are valid.
- Runtime-owned built-ins are not duplicated under `appIds`.

## Open decisions

The following details remain to be finalized:

1. **Identifier uniqueness across kinds:** String-addressed runtime handler kinds
   occupy separate registries. Decide whether identical values may intentionally
   appear in different string-ID catalog groups, or whether the application
   convention requires global uniqueness across those groups.
2. **Reusable libraries:** Decide how a reusable Uklad library exposes its own
   identifiers while preserving one application discovery surface. The leading
   option is for the application catalog to import or re-export library-owned
   state keys and handler IDs rather than redeclaring their strings.
3. **Static enforcement:** Choose the smallest TypeScript, lint, or validation
   rule that enforces feature-prefixed `stateKeys`, direct slash-namespaced
   `appIds`, and no ad hoc names without adding runtime metadata to the catalog.

These questions do not change the shared-runtime, flat-root, feature-based, or
central-catalog decisions above.
