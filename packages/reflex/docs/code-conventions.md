# Code conventions

These conventions keep ownership visible in the implementation while
preserving a small public package surface.

## Ownership tree

```text
src/
  index.ts                         combined public entrypoint
  vanilla.ts                       React-free public entrypoint
  react.ts                         React-only public entrypoint
  contracts.ts                     store-local contract types
  types.ts                         shared public domain types
  core/
    environment.ts                 environment detection
    equality.ts                    equality policy
    immer.ts                       Immer integration
    logging.ts                     logging adapter
    scheduling.ts                  host scheduling primitives
    tracing-types.ts               public trace DTOs
    validation.ts                  untyped-boundary guards
  runtime/
    core.ts                        runtime composition root and stable shape
    api.ts                         public runtime contract
    runtime.ts                     public façade implementation and module lifecycle
    validation.ts                  strict runtime boundary assertions
    state.ts                       StateStore
    handler-types.ts               registry contracts
    registrations.ts               RegistrationStore and cleanup handles
    registry.ts                    Typed RuntimeRegistry composition
    events.ts                      EventRuntime, event definitions, and registration metadata
    probe-types.ts                 instrumentation contracts and DTOs
    probe.ts                       sole optional instrumentation channel
    tracing.ts                     optional probe-backed trace compatibility
    lifecycle-types.ts             compatibility observer contract
    lifecycle.ts                   passive compatibility adapter
    subscriptions/
      types.ts                     graph contracts and diagnostics
      validation.ts                subscription registration validation
      cache.ts                     SubscriptionRuntime
      cell.ts                      cached node value and listener lifecycle
      engine.ts                    reactive graph orchestration
      keys.ts                      canonical query-key serialization
  events/
    router.ts                      EventQueue and event scheduling primitive
    execution.ts                   runner → commit → effects coordinator
    runner.ts                      pure event evaluation
    committer.ts                   state commit primitive
    effect-executor.ts             post-commit effects
    execution-observer-types.ts    DevTools observer contract
    execution-observer.ts          DevTools probe adapter
    coeffects.ts
    effects.ts
    interceptors.ts
  react/
    types.ts                       public React binding contracts
    context.ts
    hot-reload.ts
    use-subscription.ts
```

`core/*` contains reusable technical primitives. `runtime/core.ts` is the
composition root for one application runtime. The four runtime services own
mutable domain state:

- `StateStore`
- `RuntimeRegistry`
- `EventRuntime`
- `SubscriptionRuntime`

The public runtime façade delegates to those services. It must not duplicate
their state or become a generic service locator with lazily populated
extensions.

## Service-shaped internal APIs

Production callers use the owning service directly:

```ts
core.events.dispatch(event);
core.state.commit(candidateState);
core.registry.getEvent(eventId);
core.subscriptions.read(query);
```

Do not add `*ForCore`, `*ForRuntime`, or legacy `*ForKernel` wrapper families.
A free function is appropriate for a stateless algorithm or a narrow
coordinator, not as an accessor for state already owned by a service.

Mandatory services are eagerly constructed and remain present for the lifetime
of the runtime. Only `core.probe` may be absent.

## Dependency direction

| Module                      | May import from                                                            |
| --------------------------- | -------------------------------------------------------------------------- |
| `types.ts` / `contracts.ts` | External type packages and each other where required                       |
| `core/*`                    | Public types, other `core/*`, external packages                            |
| Service implementations     | Public types, technical core, narrow peer service types, external packages |
| Event coordinators          | Public types, technical core, runtime services, other event modules        |
| `runtime/core.ts`           | Every mandatory service needed to compose the stable runtime               |
| `runtime/api.ts`            | Public types and contracts                                                 |
| `runtime/runtime.ts`        | Runtime services, public contract types, and narrow public adapters        |
| `react/*`                   | Public types, runtime/subscription APIs, React                             |
| Public entrypoints          | Modules required to assemble the supported public API                      |

`runtime/core.ts` is the deliberate composition-root exception to ordinary
layering: it imports concrete service constructors. Services receive a closure
that resolves their owning `RuntimeCore`, avoiding construction-order globals.
They may import the `RuntimeCore` type and narrow lifecycle predicates, but must
not create another runtime.

No non-React module imports React. Internal modules import concrete files,
never `index.ts` and never an internal barrel.

## Type and validation ownership

- A type used only by one implementation stays at the top of that file.
- A public or cross-module contract lives in a focused `*-types.ts` module.
  Implementation modules may re-export those types to preserve established
  internal import paths, but production code imports the owning type module.
- `types.ts` and `contracts.ts` remain the package-wide domain contracts; do
  not turn them into implementation-detail dumping grounds.
- Untyped boundary checks live in a focused validation module. Keep a private
  class assertion only when it requires private instance state; delegate its
  actual validation policy to that module.
- Helpers that operate on one service's fields are private service methods.
  Free helpers are reserved for stateless algorithms and narrow coordinators.

## Mutable state

- Put hot mutable state on its owning typed service.
- Do not put queues, registries, timers, caches, revisions, or execution guards
  in generic maps.
- Optional integrations keep retained state in their package or in a `WeakMap`
  keyed by `RuntimeCore`.
- Cross-service operations belong in a small coordinator such as
  `runtime/runtime.ts`; they do not transfer ownership.
- Scheduled callbacks capture the owning service/runtime explicitly.

## Instrumentation

All instrumentation goes through `RuntimeProbe`.

- `probe === undefined` is the normal path.
- Capability flags must guard patches, subscription evidence, spans, timing,
  and diagnostic DTO construction.
- Probe callbacks report facts only. Their return values must never select
  execution policy.
- Probe failures are isolated from application behavior.
- Queue work carries only opaque tokens for probes that accepted that exact
  occurrence.
- Retained traces, operation ledgers, serialization, redaction, and delivery
  belong outside ordinary core execution.

Do not introduce a second lifecycle, outcome, trace, or operation callback
channel.

## Registration and disposal

`RegistrationStore` is the only registration-identity implementation. Stores
return opaque `RegistrationHandle`s that can report whether they still identify
the installed value, preflight destructive release, and release it. Duplicate
IDs throw; callers must dispose or explicitly clear the old registration before
installing another one.

An event definition contains its handler and immutable interceptor list.
Registering an existing event ID throws. Clearing an event removes the complete
definition atomically.

Module disposal validates every registration before running user cleanup, then
releases registrations in reverse order. Disposers are idempotent.

## File layout

Use this order unless keeping one service class contiguous is clearer:

1. External runtime imports.
2. Internal runtime imports from lower-level primitives to coordinators.
3. Type-only imports.
4. Re-exported contracts, local module types, then constants.
5. The owning service or public operations.
6. Private algorithms and helpers.
7. Intentional module-load initialization, if any.

Within a service, group public methods by responsibility and keep private
methods after the public surface. Do not place a private helper between public
operations merely because it is called by the preceding operation.

Prefer one cohesive owner per file. Split out a file when it represents a real
contract, validation boundary, algorithm, adapter, or dependency boundary—not
merely to create a wrapper around an owner's field.

## Comments and API documentation

- Explain timing, ownership, error policy, and invariants that are not obvious
  from the types.
- Mark deliberate test or integration seams with `@internal`.
- Document why evaluation order or a side effect is necessary; do not narrate
  syntax.
- Keep comments in the present tense and remove historical names after a
  migration completes.
- Treat initialization and disposal order as part of the runtime contract.
