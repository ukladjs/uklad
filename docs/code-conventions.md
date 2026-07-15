# Code conventions

These conventions keep Reflex's implementation coherent while preserving one
small public package surface.

## Ownership tree

```text
src/
  index.ts                         public re-export boundary
  types.ts                         public contracts and augmentation anchors
  core/
    environment.ts                 environment detection
    equality.ts                    equality policy
    immer.ts                       Immer integration
    logging.ts                     logging adapter
    scheduling.ts                  host scheduling primitives
    tracing.ts                     trace collection and delivery
    validation.ts                  untyped-boundary guards
  runtime/
    app-db.ts                      live/published DB generations
    event-metadata.ts              per-event interceptor metadata
    handlers.ts                    typed handler stores
    reset.ts                       cross-store reset coordination
    subscriptions/
      cache.ts                     query cache and lifecycle metadata
      engine.ts                    reactive graph semantics
      keys.ts                      canonical query-key serialization
  events/
    coeffects.ts
    effects.ts
    global-interceptors.ts
    interceptors.ts
    pipeline.ts
    rate-limit.ts
    registration.ts
    router.ts
  subscriptions/
    queries.ts                     graph construction and imperative reads
    registration.ts                root and computed definitions
  react/
    hot-reload.ts
    use-subscription.ts
```

`core` owns reusable technical primitives. `runtime` owns mutable framework
state and lifecycle mechanics. `events` and `subscriptions` own their public
domain operations. `react` is an adapter over the subscription/runtime layers;
no other folder imports React.

## Dependency direction

A module may import only the dependencies listed for its layer:

| Module            | May import from                                             |
| ----------------- | ----------------------------------------------------------- |
| `types.ts`        | External type packages only                                 |
| `core/*`          | `types.ts`, other `core/*`, external packages               |
| `runtime/*`       | `types.ts`, `core/*`, other `runtime/*`, external packages  |
| `events/*`        | `types.ts`, `core/*`, `runtime/*`, other `events/*`         |
| `subscriptions/*` | `types.ts`, `core/*`, `runtime/*`, other `subscriptions/*`  |
| `react/*`         | `types.ts`, `core/*`, `runtime/*`, `subscriptions/*`, React |
| `index.ts`        | Any module needed to assemble the supported public API      |

`events/*` and `subscriptions/*` do not import each other. Shared behavior
belongs in `core` or `runtime`, depending on whether it owns mutable framework
state. Internal modules import concrete files, never `index.ts` and never an
internal barrel. This keeps dependency direction visible and avoids cycles or
module-initialization surprises.

The package root is the public boundary. Add a root export only when it is a
supported user-facing contract. Repository-side public consumers target
`src/index.ts`; installed consumers import the package root. Neither imports a
physical internal module, which is not a public subpath API.

Exports from physical internal modules provide repository-level visibility;
they are not package API and do not need an `@internal` tag by default. Reserve
`@internal` for deliberately exposed test seams, integration hooks, or helpers
whose status would otherwise be ambiguous.

## File layout

Use this order unless a single implementation class followed by thin exported
wrappers is clearer:

1. External imports first, followed by a blank line.
2. Internal imports that exist at runtime, ordered from lower layers to the
   current layer, followed by internal type-only imports. Use `import type` for
   erased bindings.
3. Module types, constants, and mutable singleton state.
4. Public operations, grouped by capability; keep overloads directly above
   their implementation.
5. Private helpers next to the capability they implement.
6. Intentional module-load registration or initialization, always last.

Small deviations are acceptable when they keep one implementation class beside
its thin exported wrappers or otherwise make a lifecycle easier to follow.

Prefer one responsibility per file, descriptive domain names, and the existing
vocabulary (`event`, `effect`, `coeffect`, `subscription`, `handler`, `query`).
Do not introduce synonyms for established concepts or a folder for every tiny
file.

## Comments and API documentation

- Add JSDoc to public functions and types when callers need to understand
  timing, lifecycle, error behavior, ownership, or a non-obvious constraint.
- Document overloads when their accepted forms have different meanings. Mark
  deliberate test or integration seams with `@internal`.
- Use inline comments for the reason behind an invariant, evaluation order,
  side effect, or deliberate tradeoff. Do not narrate syntax that the code
  already expresses.
- Keep comments concise and current. Remove historical explanations once they
  no longer help maintain the present design; use version control for history.
- Make module-load side effects explicit near the final statement that performs
  them. Initialization order is part of the runtime contract.
