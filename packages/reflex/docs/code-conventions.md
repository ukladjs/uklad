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
    tracing.ts                     optional probe-backed trace compatibility
    validation.ts                  untyped-boundary guards
  runtime/
    core.ts                        runtime composition root and stable shape
    api.ts                         public runtime contract
    runtime.ts                     public façade implementation and module lifecycle
    state.ts                       StateStore
    handlers.ts                    RuntimeRegistry
    probe.ts                       sole optional instrumentation channel
    lifecycle.ts                   passive compatibility adapter
    reset.ts                       cross-service reset coordination
    subscriptions/
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
    execution-observer.ts          DevTools probe adapter
    coeffects.ts
    effects.ts
    interceptors.ts
    registration.ts
  react/
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

## Mutable state

- Put hot mutable state on its owning typed service.
- Do not put queues, registries, timers, caches, revisions, or execution guards
  in generic maps.
- Optional integrations keep retained state in their package or in a `WeakMap`
  keyed by `RuntimeCore`.
- Cross-service operations belong in a small coordinator such as
  `runtime/reset.ts`; they do not transfer ownership.
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

Registries return opaque ownership tokens. Callers may ask a token whether it
still owns the current generation, preflight destructive release, and release
it. Version counters are registry implementation details; the runtime façade
must not inspect them.

An event definition contains its handler and immutable interceptor list.
Replacing or clearing an event updates that complete definition atomically.

Module disposal validates every registration before running user cleanup, then
releases registrations in reverse order. Disposers are idempotent.

## File layout

Use this order unless keeping one service class contiguous is clearer:

1. External runtime imports.
2. Internal runtime imports from lower-level primitives to coordinators.
3. Type-only imports.
4. Module types and constants.
5. The owning service or public operations.
6. Private algorithms and helpers.
7. Intentional module-load initialization, if any.

Prefer one cohesive owner per file. Split out a file when it represents a real
algorithm, adapter, or dependency boundary—not merely to create a wrapper
around an owner's field.

## Comments and API documentation

- Explain timing, ownership, error policy, and invariants that are not obvious
  from the types.
- Mark deliberate test or integration seams with `@internal`.
- Document why evaluation order or a side effect is necessary; do not narrate
  syntax.
- Keep comments in the present tense and remove historical names after a
  migration completes.
- Treat initialization and disposal order as part of the runtime contract.
