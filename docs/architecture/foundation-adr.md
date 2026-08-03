# ADR-001: Uklad Foundation and Application-Contract-First Authoring

- **Status:** Provisional
- **Date:** 2026-07-23
- **Scope:** Uklad core and application authoring before 1.0
- **Mandatory review:** Before the execution model is declared stable or Uklad reaches 1.0

## Context

Uklad began as a TypeScript port of re-frame. Its current architecture has
valuable, well-tested semantics, but it also carries mechanisms that were chosen
for re-frame compatibility: positional event vectors, an asynchronous event
queue, event cascades, a generic interceptor pipeline, dynamic registration, and
render-scheduled state publication.

Uklad does not yet have an established external user base or a public 1.0
compatibility contract. This gives the project room to improve its architecture,
but replacing every mechanism at once would combine several independent risks:

- changing the public authoring model;
- changing event ordering and completion semantics;
- replacing the state publication model;
- replacing effect and environmental-input handling;
- replacing the subscription implementation; and
- introducing machine-readable contracts and authoritative operation outcomes.

The project therefore needs to distinguish its durable architectural principles
from the current mechanisms that implement them.

Uklad is intentionally designed for AI-assisted and agent-authored
development. Agents are the primary authoring and maintenance clients, while
applications, tests, developer tools, and remote gateways remain runtime
clients. This is not an excuse to weaken runtime correctness; it means the
project can place more invariants in explicit instructions, application
contracts, readonly types, generated templates, and verification checks instead
of paying defensive runtime costs for every possible human mistake.

This constraint permits deliberate optimizations at trusted authoring
boundaries. For example, agent-authored events may use immutable borrowed
payloads instead of cloning, and subscription authors may select an equality
algorithm based on the expected output and recomputation cost. External or
untrusted boundaries still require explicit validation or ownership.

## Decision

### 1. Stable foundation

Uklad retains the architectural principles that made re-frame reliable in
large applications:

- One immutable application state per runtime.
- Serialized, deterministic state transitions.
- Pure, synchronous state-update logic.
- Synchronous transition discipline: coeffects, interceptors, and handlers
  finish before effects may run or schedule later work.
- External effects represented as data.
- Pure derived queries with equality cutoffs.
- State commit before external effect execution.
- Explicit runtime ownership and isolation.
- Failure isolation between independent transitions, effects, queries, and
  listeners.

These are behavioral invariants. They do not require a particular event syntax,
queue implementation, interceptor model, subscription graph, or rendering
scheduler.

### 2. AI-first authoring, integrity boundaries, and a fast production core

AI-first is an architectural constraint, not only a documentation preference.
Uklad targets applications authored and maintained through agent skills. The
application catalog, complete `AppContracts`, registrar calls, types,
templates, tests, and agent instructions together form the authoring contract
that lets Uklad avoid unnecessary defensive work while keeping violations
visible.

Production event processing and subscription recomputation are trusted hot
paths. They must remain direct, allocation-conscious, and predictable. Do not
add broad defensive copies, deep walks or freezes, repeated schema validation,
or generalized authoring-policy instrumentation to those paths solely to catch
mistakes that controlled authoring can prevent.

An always-on runtime check is appropriate only when it is both cheap and needed
to preserve executor integrity, such as runtime isolation, serialized commit,
or a public lifecycle boundary. A check that primarily explains an application
authoring mistake belongs in agent skills, types, templates, tests, linting, or
development diagnostics instead. Validation, cloning, freezing, and schema
checks belong at external or otherwise untrusted ingress, before data enters
the trusted runtime core.

- **Events:** Event vectors and payload values are immutable after `dispatch()`
  is called. The preferred agent-authored path neither copies nor deep-freezes
  each event graph, including in ordinary development execution. Agent skills,
  types, templates, and targeted tests establish that ownership contract.
  Structured cloning remains appropriate for external, plugin, remote, or
  otherwise untrusted ingress, and may remain as a compatibility mode during
  the 0.x transition.
- **Subscriptions:** Every non-root subscription should be evaluated for
  result size, recomputation frequency, structural sharing, and downstream
  fan-out. Each application selects one default equality policy through the
  `equalityCheck` runtime-creation option; a `regSub` may override it for a
  particular result. The fallback is `fast-deep-equal`, while `() => false`
  propagates every recomputation by default. `Object.is`, shallow, deep, and
  domain-specific comparators remain deliberate policy choices rather than
  hidden registration requirements. Subscription query parameters are typed
  cache-key scalars: `string | number | boolean | null`. Contracts reject
  objects and other non-scalar values; finite-number validation remains an
  ingress and authoring concern because TypeScript represents all numbers with
  `number`.
- **Optimization rule:** Prefer a strict, machine-readable contract plus a
  targeted test or opt-in diagnostic over an always-on defensive copy when the
  trust boundary is controlled by agent-authored code. Preserve an explicit
  safe path for data crossing a trust boundary, and require a measured,
  integrity-specific reason for any new production hot-path check.

This policy does not assume that agents are infallible. Contract violations must
still be made visible through types, targeted tests, and development tooling;
runtime validation remains mandatory at external-ingress boundaries. The
synchronous event-turn rule remains an authoring invariant: effects are the
explicit asynchronous boundary, and they may prepare a final result event and
dispatch it after the turn has committed. A cheap diagnostic for a direct
handler dispatch is acceptable, but normal development execution must not
deep-walk every payload or monitor every event and subscription callback.

### 3. The current application model is canonical; executor mechanics remain provisional

Application-authored Uklad code uses one application catalog, one complete
`AppContracts`, event vectors, and registrar-installed modules. This is the
canonical authoring model for applications, templates, and agents.

The current executor implements that model through:

- event-based mutation;
- event vectors and `dispatch`;
- asynchronous, serialized event processing;
- event cascades produced by declarative dispatch effects;
- the interceptor pipeline;
- coeffects and effects;
- construction-time equality and global-interceptor policy;
- dynamic runtime registration;
- subscription-based derived state; and
- scheduled React-facing state publication.

Event vectors and declarative dispatch effects are part of the canonical
application authoring surface. Queue internals, interceptor implementation,
dynamic registration mechanics, and React publication scheduling remain subject
to the mandatory pre-1.0 review.

Compatibility during this period means behavioral continuity for the existing
repository, examples, and tests. It is not a pre-1.0 promise that every current
API or timing behavior will remain part of the stable public contract.

### 4. Application contracts and registrar modules are the authoritative authoring contract

Every application has one catalog and one complete `AppContracts` type next to
it. The catalog declares application state keys and handler IDs; `AppContracts`
declares the state, event, subscription, effect, and coeffect shapes for those
names. Feature and platform modules install implementations through the typed
registrar.

The catalog plus `AppContracts` is the authoritative application capability
index. It must be used by registrations, dispatches, subscription queries,
effect tuples, components, and tests; application code does not independently
repeat its IDs as raw strings.

Event vectors are the canonical in-application command representation. A
complete event contract gives their IDs and positional parameters a single
typed source of truth. Declarative effects and named coeffect bindings remain
part of the same contract boundary.

Application registration and external exposure are separate decisions.
Registering an event makes it available to the owning runtime; it does not make
it callable by a remote gateway, developer tool, or another untrusted client.
Those boundaries require their own validation, schema, policy, and exposure
definitions without replacing the application authoring model.

Runtime-wide interceptors and the default subscription equality policy are
immutable runtime-creation options. Global interceptors are ordered
infrastructure hooks: they run before event-specific interceptors and unwind
after them in reverse order. Feature modules do not dynamically add, remove, or
reorder either runtime-wide policy.

The application structure rules define the catalog layout, flat reactive roots,
module placement, platform boundaries, and equality policy expected of this
model.

### 5. Application contracts are independent of executor mechanics

The application catalog, `AppContracts`, event vectors, declarative effects,
and registrar module boundaries must survive a replacement of the current
queue, interceptor, or publication implementation. Applications must not
depend on:

- queue or stack internals;
- scheduler metadata attached to event arrays;
- global `flush()` behavior outside testing and administrative tooling;
- trace storage details; or
- React publication timing.

The application layer and executor communicate through transition outcomes.
The exact TypeScript representation may evolve, but the conceptual boundary is:

```text
ValidatedInvocation
  + StateSnapshot
  + CapturedInputs
        |
        v
TransitionOutcome
  - candidate state
  - domain result, when declared
  - effect intents
  - follow-up intents
  - structured failure
        |
        v
CommitOutcome
        |
        v
PublicationOutcome + EffectOutcomes
```

The current event pipeline produces these outcomes. A future executor must be
able to produce the same outcomes without changing the catalog, `AppContracts`,
or application modules.

No application feature may depend on an incidental behavior of the current
queue or interceptor implementation.

### 6. Runtime manifests must describe enforced truth

If the runtime exposes a manifest, it is a versioned snapshot of the installed
application catalog and registrations. It must include a revision or digest that
changes when the callable capability set changes.

Dynamic registration may continue, but it has the following consequences:

- catalog-backed registration updates the manifest revision;
- registration outside the application catalog is not represented as a fully
  verified application capability;
- an inspector must distinguish catalog-backed and dynamically registered
  entries; and
- a manifest must never claim that an unenforced declaration is authoritative.

If arbitrary interceptors, coeffects, or handlers can introduce behavior not
declared by `AppContracts`, the affected entry must be marked as partially
verified until the runtime can enforce the declaration.

Machine-readable metadata is useful only when it describes actual runtime
boundaries. Uklad must prefer an honest partial contract over a complete-looking
manifest that execution can bypass.

### 7. Environmental inputs and effects remain explicit

Coeffects remain supported by the current executor. Application contracts
declare the provider argument and injected value, and event registrations bind
them explicitly. Environmental data crossing an untrusted boundary must be
validated and captured for the concrete invocation where practical.

Deterministic inputs such as time, random values, generated IDs, principal
identity, and configuration should be represented as captured invocation data.
They must not be reconstructed from traces.

Effects remain declarative data. Application contracts declare their payloads;
external operation layers may additionally define:

- input and acknowledgement schemas;
- adapter identity and execution mode;
- required or detached completion semantics;
- risk and capability metadata;
- cancellation and deadline support where applicable; and
- structured outcomes.

An effect handler returning normally does not, by itself, prove that external
work succeeded. The existing effect model may initially provide only partial
verification, which must be reported honestly.

### 8. Operations own execution truth; traces remain passive

Operation identity, causality, revisions, completion, results, and structured
errors are execution facts. The core runtime owns those facts.

Tracing, logging, DevTools, and telemetry consume immutable execution outcomes.
They must not:

- reconstruct authoritative causality from event-array identity;
- decide whether execution may continue;
- mutate transition or effect behavior;
- serve as the only storage for an operation result; or
- redefine operation completion from trace timing.

Operation support may be implemented incrementally, but new operation and
executor work must move toward this boundary rather than adding more execution
logic to tracing or lifecycle observers.

### 9. Queue and scheduling behavior are provisional

The existing asynchronous event queue remains in the current executor. Its
serialized ordering is supported for that executor, but its implementation is
not part of the application contract.

In particular, new APIs must not depend on:

- `idle`, `scheduled`, `running`, or `paused` queue states;
- event-controlled `flush` or `yield` metadata;
- snapshot-drain ordering as a workflow mechanism;
- a global queue error consumed by a later `flush()` call; or
- animation-frame timing in the headless core.

`flush()` may remain as a compatibility and testing boundary for existing event
work. It is not the authoritative completion primitive for an individual
operation. Callers that require exact completion should wait on that operation's
own handle and requested completion target.

Timers, retries, delayed work, debounce, throttle, and task concurrency are
separate concerns from state-transition serialization. React render scheduling
is an adapter concern. Future work must not combine these concerns into one
general semantic scheduler.

### 10. React and headless execution remain separate concerns

Uklad core must remain usable without React, `document`,
`requestAnimationFrame`, or a browser event loop.

The existing committed-state and published-state distinction may remain during
the current executor's lifetime, but both revisions must be explicit wherever
exact operation results or semantic observations are reported.

No manifest or operation receipt may imply that committed state is already
query-visible unless publication at that revision has occurred.

The publication model must be reconsidered before 1.0. A future design may use
one synchronously published state head and move render batching entirely into
the React adapter.

## Architectural guardrails

While the existing executor remains, the following rules prevent the
transitional architecture from becoming a permanent hidden dependency:

1. New examples and templates use one application catalog, one complete
   `AppContracts`, event vectors, registrar-installed modules, and immutable
   runtime-wide equality and interceptor policy.
2. Event vectors and declarative dispatch effects are the preferred production
   command plane for application-authored code. External ingress maps its
   validated input to that contract rather than redefining application events.
3. External input is validated and receives an explicit ownership boundary
   before it is dispatched into an application runtime.
4. When a runtime manifest is provided, it is generated from the installed
   catalog-backed registrations and identifies dynamic registrations separately.
5. Arbitrary interceptor behavior cannot be described as fully verified unless
   the runtime enforces its declared inputs, effects, and capabilities.
6. New operation features consume normalized execution outcomes rather than
   adding operation bookkeeping throughout handlers and interceptors.
7. New tracing features remain passive projections.
8. New scheduling features are assigned to the state executor, task supervisor,
   timer service, or React adapter according to their actual responsibility.
9. No new public API exposes the current executor's internal context, queue
   state, or scheduling metadata.
10. Agent instructions, templates, and examples state the immutable-event
    contract and the expected equality-policy decision for each non-root
    subscription.
11. No-copy event paths require an explicit ownership contract and targeted
    test coverage; external ingress must validate, freeze, or clone payloads.
12. Turn-boundary discipline is established through agent skills, contracts,
    types, templates, tests, and development diagnostics. An always-on guard
    is added only when it protects executor integrity at negligible hot-path
    cost.
13. New event-path or subscription-path work documents why each always-on
    check is necessary and verifies that it does not materially regress the
    relevant benchmark.
14. Before 1.0, the project must explicitly decide whether to retain, replace,
    or isolate the current event executor.

## Consequences

### Positive

- Existing behavior and conformance tests remain useful while contracts improve.
- Applications have one canonical source for identifiers, state, payloads,
  registrations, dispatches, and queries rather than a descriptor-to-registrar
  translation layer.
- Catalog-plus-contract discovery remains compact for agents, tooling, and code
  review while feature modules retain implementation ownership.
- External gateways can add schemas, policy, and exposure metadata at their own
  boundary without making ordinary application events carry a second contract.
- Agent-authored applications can trade defensive allocation for explicit
  immutable-event and per-subscription equality contracts.
- Equality and ownership decisions become inspectable authoring choices instead
  of hidden package-wide defaults.
- The normalized execution boundary creates a place to compare the existing
  executor with a simpler alternative.
- The project can make the eventual execution-model decision using measured
  complexity and real application use cases.

### Negative

- Positional event vectors are compact rather than self-describing, so the
  catalog and complete `AppContracts` are required for safe discovery and
  maintenance.
- Runtime application contracts are primarily TypeScript authoring contracts;
  untrusted callers still need a separate runtime validation boundary.
- Some declarations cannot be fully enforced while arbitrary interceptors,
  coeffects, untyped dispatch, and dynamic registration remain.
- Exact operation completion remains more complicated while event cascades and
  delayed publication are supported.
- The framework depends more heavily on agent instructions, readonly types, and
  development guards; integrations that bypass those contracts need a safer
  ownership mode.
- Subscription authors must make more deliberate equality choices, and a poor
  comparator can trade correctness or CPU for apparent simplicity.
- The implementation must clearly report partial verification instead of
  presenting every registered handler as machine-safe.
- Work invested in adapting the current executor may later be removed.
- Without the guardrails and mandatory review in this ADR, the transitional
  backend could become an accidental permanent architecture.

## Alternatives considered

### Replace the execution model immediately

Build a command-centered, synchronous transition executor with one state
publication per command, supervised tasks, and no public event queue.

This remains a credible target. It is not selected now because it would combine
execution, scheduling, operation, effect, and publication changes in one step.
The application-contract boundary created by this ADR allows that executor to
be evaluated independently.

### Freeze the current event architecture as permanent

Treat vectors, the asynchronous queue, interceptors, coeffects, dynamic
registration, event cascades, and scheduled publication as stable Uklad
concepts.

This is rejected. Those mechanisms may continue to prove useful, but they must
be evaluated separately from the stable principles they currently implement.

### Make descriptors the canonical application authoring model

Require ordinary application definitions to use object-shaped descriptors and
translate them into registrations and event vectors.

This is rejected. It creates a second application representation without making
local state transitions safer or clearer. Schemas, exposure policy, and rich
metadata remain appropriate at external operation boundaries, but they do not
replace the catalog, `AppContracts`, event vectors, or registrar modules that
application code uses.

### Make traces authoritative

Infer invocation identity, causality, completion, and results from trace events.

This is rejected. Traces are optional, may be buffered or dropped, and are not
an execution ledger.

## Application-contract acceptance criteria

The application authoring model is complete only when:

- application templates and agent instructions use the catalog, complete
  `AppContracts`, event vectors, and registrar modules;
- registrations and query vectors are type-checked against the complete
  application contract;
- modules fail installation on duplicate or incompatible registrations;
- a runtime manifest, when provided, exposes a versioned deterministic view of
  installed catalog-backed registrations;
- manifest entries distinguish catalog-backed, dynamically registered, and
  partially enforced capabilities;
- when a manifest is provided, catalog changes update its revision or digest;
- executor outcomes carry exact event or invocation identity and state
  revisions;
- operations and DevTools can consume outcomes without reconstructing root
  identity from traces;
- agent-facing instructions, templates, and readonly types describe the
  immutable-event contract and how targeted tests verify it;
- agent skills, contracts, types, templates, tests, and development diagnostics
  establish synchronous turn discipline without adding generalized production
  instrumentation to every transition callback;
- external event ingress has an explicit validate, freeze, or clone ownership
  policy;
- every non-root subscription registration declares an equality policy, and
  benchmark guidance exists for large, frequently recomputed outputs;
- changes that add work to event or subscription hot paths document their
  integrity rationale and show no material benchmark regression;
- existing event behavior remains covered by conformance tests; and
- application modules contain no dependency on queue FSM states, interceptor
  internals, or React timing.

## Mandatory review triggers

This ADR must be reviewed before 1.0 and earlier if any of the following occurs:

- Runtime manifests cannot remain authoritative because dynamic behavior can
  bypass them.
- Application modules require direct access to the interceptor context.
- Interceptors routinely introduce undeclared effects or environmental inputs.
- Exact operation completion requires additional event-identity or trace-timing
  heuristics.
- Event cascade interleaving prevents clear transaction or result semantics.
- Headless execution continues to depend on browser-oriented scheduling.
- Committed and query-visible revisions create ambiguity for operation results.
- Supporting both `AppContracts` and a competing application-definition surface
  causes contract drift or duplicated APIs.
- Most new features require changes inside the existing pipeline rather than at
  the normalized executor boundary.

At review, the project must make one explicit decision:

1. promote the current executor and document its mechanisms as stable;
2. replace it with an executor that preserves the application catalog,
   `AppContracts`, event-vector, and registrar authoring surface; or
3. isolate it in a legacy or compatibility entry point.

The provisional status must not continue indefinitely by default.

## Related documents

- [Invariant enforcement matrix](invariant-enforcement-matrix.md)
- [Application authoring rules](application-authoring-rules.md)
- [Canonical application structure](canonical-app-structure.md)
- [Uklad architecture](uklad-runtime.md)
- [Re-frame parity tradeoffs](../compatibility/re-frame-parity.md)
- [Agent-first priorities](../agent-development/priorities.md)
- [Agent operation RFC](../rfcs/agent-operations.md)
- [Runtime RFC](../rfcs/instance-scoped-runtime.md)
- [Stability and versioning](../compatibility/stability-and-versioning.md)
