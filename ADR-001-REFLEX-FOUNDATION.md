# ADR-001: Reflex Foundation and Descriptor-First Evolution

- **Status:** Provisional
- **Date:** 2026-07-23
- **Scope:** Reflex core through the descriptor milestone
- **Mandatory review:** Before the execution model is declared stable or Reflex reaches 1.0

## Context

Reflex began as a TypeScript port of re-frame. Its current architecture has
valuable, well-tested semantics, but it also carries mechanisms that were chosen
for re-frame compatibility: positional event vectors, an asynchronous event
queue, event cascades, a generic interceptor pipeline, dynamic registration, and
render-scheduled state publication.

Reflex does not yet have an established external user base or a public 1.0
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

The goal is not to redesign Reflex around AI or to turn it into an agent
framework. Agents are clients of Reflex, just as applications, tests, developer
tools, and remote gateways are clients. The goal is to make Reflex behavior
explicit, typed, inspectable, reproducible, and machine-verifiable.

## Decision

### 1. Stable foundation

Reflex retains the architectural principles that made re-frame reliable in
large applications:

- One immutable application state per runtime.
- Serialized, deterministic state transitions.
- Pure, synchronous state-update logic.
- External effects represented as data.
- Pure derived queries with equality cutoffs.
- State commit before external effect execution.
- Explicit runtime ownership and isolation.
- Failure isolation between independent transitions, effects, queries, and
  listeners.

These are behavioral invariants. They do not require a particular event syntax,
queue implementation, interceptor model, subscription graph, or rendering
scheduler.

### 2. Current executor remains during the descriptor phase

The existing event execution model remains the initial execution backend while
typed descriptors and runtime contracts are introduced.

During this phase, Reflex continues to support:

- event-based mutation;
- event vectors and `dispatch`;
- asynchronous, serialized event processing;
- event cascades produced by declarative dispatch effects;
- the interceptor pipeline;
- coeffects and effects;
- dynamic runtime registration;
- subscription-based derived state; and
- scheduled React-facing state publication.

This is a delivery strategy, not a declaration that these mechanisms are the
permanent Reflex architecture.

Compatibility during this phase means behavioral continuity for the existing
repository, examples, and tests. It is not a pre-1.0 promise that every current
API or timing behavior will remain part of the stable public contract.

### 3. Descriptors become the authoritative authoring contract

New application definitions should use typed descriptors assembled into
modules. A descriptor is the authoritative source for the contract it declares;
it is not merely documentation attached to an independently registered handler.

An event descriptor should be able to declare:

- stable ID and version;
- description and source metadata;
- object-shaped input schema;
- output or domain-result schema when applicable;
- declared environmental inputs;
- declared effect capabilities;
- exposure, risk, and policy metadata;
- state access metadata when it can be enforced;
- idempotency requirements when externally invocable; and
- examples suitable for generated documentation and agent discovery.

Descriptor schemas must support runtime validation and a canonical,
machine-readable representation suitable for manifests and contract hashing.
Reflex should provide schema adapters rather than inventing a large validator
DSL in core.

Module installation validates duplicate IDs, missing dependencies, invalid
schemas, and incompatible declarations before the module becomes callable.

Registration and external exposure are separate decisions. Registering an event
does not automatically make it callable by an agent, remote gateway, or
developer tool. Externally callable definitions are private by default and must
be exposed explicitly.

### 4. Descriptors are independent of the current executor

Descriptor APIs must not expose or require:

- positional event-vector parameters;
- interceptor queue or stack internals;
- the mutable interceptor `Context`;
- event-queue FSM states;
- scheduler metadata attached to event arrays;
- global `flush()` behavior;
- trace storage details; or
- React publication timing.

The descriptor layer and executor communicate through normalized execution
records. The exact TypeScript representation may evolve, but the conceptual
boundary is:

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

The current event pipeline may initially produce these outcomes. A future
executor must be able to produce the same outcomes without changing application
descriptors.

No descriptor-level feature may depend on an incidental behavior of the current
event-vector or interceptor implementation.

### 5. Runtime manifests must describe enforced truth

The runtime manifest is a versioned snapshot of the active descriptor catalog.
It must include a manifest revision or digest that changes when the callable
catalog changes.

Dynamic registration may continue during the descriptor phase, but it has the
following consequences:

- descriptor-backed registration updates the manifest revision;
- raw legacy registration is not represented as a fully verified descriptor;
- an inspector must distinguish descriptor-backed, partially verified, and
  legacy-only entries; and
- a manifest must never claim that an unenforced declaration is authoritative.

If arbitrary interceptors, coeffects, or handlers can introduce behavior not
declared by a descriptor, the affected entry must be marked as partially
verified until the runtime can enforce the declaration.

Machine-readable metadata is useful only when it describes actual runtime
boundaries. Reflex must prefer an honest partial contract over a complete-looking
manifest that execution can bypass.

### 6. Environmental inputs and effects remain explicit

Coeffects remain supported by the current executor, but descriptor-backed
environmental inputs must be declared, validated, and captured for the concrete
invocation where practical.

Deterministic inputs such as time, random values, generated IDs, principal
identity, and configuration should be represented as captured invocation data.
They must not be reconstructed from traces.

Effects remain declarative data. Descriptor-backed effects should have:

- input and acknowledgement schemas;
- adapter identity and execution mode;
- required or detached completion semantics;
- risk and capability metadata;
- cancellation and deadline support where applicable; and
- structured outcomes.

An effect handler returning normally does not, by itself, prove that external
work succeeded. The existing effect model may initially provide only partial
verification, which must be reported honestly.

### 7. Operations own execution truth; traces remain passive

Operation identity, causality, revisions, completion, results, and structured
errors are execution facts. The core runtime owns those facts.

Tracing, logging, DevTools, and telemetry consume immutable execution outcomes.
They must not:

- reconstruct authoritative causality from event-array identity;
- decide whether execution may continue;
- mutate transition or effect behavior;
- serve as the only storage for an operation result; or
- redefine operation completion from trace timing.

Operation support may be implemented incrementally, but new descriptor and
executor work must move toward this boundary rather than adding more execution
logic to tracing or lifecycle observers.

### 8. Queue and scheduling behavior are provisional

The existing asynchronous event queue remains in the current executor during
the descriptor phase. Its serialized ordering is supported for that executor,
but its implementation is not part of the descriptor contract.

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

### 9. React and headless execution remain separate concerns

Reflex core must remain usable without React, `document`,
`requestAnimationFrame`, or a browser event loop.

The existing committed-state and published-state distinction may remain during
the descriptor phase, but both revisions must be explicit wherever exact
operation results or semantic observations are reported.

No manifest or operation receipt may imply that committed state is already
query-visible unless publication at that revision has occurred.

The publication model must be reconsidered before 1.0. A future design may use
one synchronously published state head and move render batching entirely into
the React adapter.

## Architectural guardrails

While the existing executor remains, the following rules prevent the
transitional architecture from becoming a permanent hidden dependency:

1. New examples and templates use descriptors and object-shaped inputs.
2. Raw event-vector APIs remain available for compatibility, low-level testing,
   and migration, but are not the preferred production command plane.
3. Descriptor-backed execution validates external input before the application
   handler runs.
4. Runtime manifests are generated from installed descriptors, not inferred
   from handler registries after the fact.
5. Arbitrary interceptor behavior cannot be described as fully verified unless
   the runtime enforces its declared inputs, effects, and capabilities.
6. New operation features consume normalized execution outcomes rather than
   adding operation bookkeeping throughout handlers and interceptors.
7. New tracing features remain passive projections.
8. New scheduling features are assigned to the state executor, task supervisor,
   timer service, or React adapter according to their actual responsibility.
9. No new public API exposes the current executor's internal context, queue
   state, or scheduling metadata.
10. Before 1.0, the project must explicitly decide whether to retain, replace,
    or isolate the current event executor.

## Consequences

### Positive

- Existing behavior and conformance tests remain useful while contracts improve.
- Descriptor and manifest work can proceed without simultaneously replacing
  every runtime subsystem.
- Applications gain typed object inputs, runtime validation, module validation,
  discovery, and machine-readable contracts earlier.
- The normalized execution boundary creates a place to compare the existing
  executor with a simpler alternative.
- The project can make the eventual execution-model decision using measured
  complexity and real descriptor use cases.

### Negative

- Reflex temporarily has two conceptual surfaces: descriptor contracts and
  legacy event-vector execution.
- Some declarations cannot be fully enforced while arbitrary interceptors,
  coeffects, raw dispatch, and dynamic registration remain.
- Exact operation completion remains more complicated while event cascades and
  delayed publication are supported.
- The implementation must clearly report partial verification instead of
  presenting every registered handler as machine-safe.
- Work invested in adapting the current executor may later be removed.
- Without the guardrails and mandatory review in this ADR, the transitional
  backend could become an accidental permanent architecture.

## Alternatives considered

### Replace the execution model immediately

Build a command-centered, synchronous transition executor with one state
publication per command, supervised tasks, and no public event queue.

This remains a credible target. It is not selected for the descriptor phase
because it would combine contract, execution, scheduling, operation, effect, and
publication changes in one step. The descriptor boundary created by this ADR
allows that executor to be evaluated independently.

### Freeze the current event architecture as permanent

Treat vectors, the asynchronous queue, interceptors, coeffects, dynamic
registration, event cascades, and scheduled publication as stable Reflex
concepts.

This is rejected. Those mechanisms may continue to prove useful, but they must
be evaluated separately from the stable principles they currently implement.

### Add descriptors only as documentation

Generate types and manifests while allowing execution to bypass their schemas
and declarations.

This is rejected. A machine-readable contract that is not enforced at its
boundary is documentation, not runtime truth.

### Make traces authoritative

Infer invocation identity, causality, completion, and results from trace events.

This is rejected. Traces are optional, may be buffered or dropped, and are not
an execution ledger.

## Descriptor milestone acceptance criteria

The descriptor phase is complete only when:

- descriptor-backed input validation runs before application handling;
- modules fail installation on duplicate or incompatible definitions;
- the runtime exposes a versioned, deterministic manifest;
- manifest entries distinguish enforced, partial, and legacy contracts;
- catalog changes update the manifest revision or digest;
- executor outcomes carry exact event or invocation identity and state
  revisions;
- operations and DevTools can consume outcomes without reconstructing root
  identity from traces;
- existing event behavior remains covered by conformance tests; and
- descriptor definitions contain no dependency on event-vector layout,
  interceptor internals, queue FSM states, or React timing.

## Mandatory review triggers

This ADR must be reviewed before 1.0 and earlier if any of the following occurs:

- Runtime manifests cannot remain authoritative because dynamic behavior can
  bypass them.
- Descriptor-backed handlers require direct access to the interceptor context.
- Interceptors routinely introduce undeclared effects or environmental inputs.
- Exact operation completion requires additional event-identity or trace-timing
  heuristics.
- Event cascade interleaving prevents clear transaction or result semantics.
- Headless execution continues to depend on browser-oriented scheduling.
- Committed and query-visible revisions create ambiguity for operation results.
- Supporting both raw registration and descriptor registration causes contract
  drift or duplicated APIs.
- Most new features require changes inside the existing pipeline rather than at
  the normalized executor boundary.

At review, the project must make one explicit decision:

1. promote the current executor and document its mechanisms as stable;
2. replace it with a descriptor-native executor; or
3. isolate it in a legacy or compatibility entry point.

The provisional status must not continue indefinitely by default.

## Related documents

- [Reflex architecture](packages/reflex/docs/architecture.md)
- [Agent-first priorities](docs/agent-first-priorities.md)
- [Agent operation RFC](docs/agent-operation-rfc.md)
- [Runtime RFC](docs/runtime-rfc.md)
- [Stability and versioning](packages/reflex/docs/stability-and-versioning.md)
