# Reflex monorepo

Reflex is already publicly available as a TypeScript port of re-frame. It has
been available for about a year and has proven itself in production projects.
That existing library remains available and can still be used.

This monorepo is about what comes next. In the year since Reflex began, the way
software is written has changed dramatically: people increasingly describe and
review systems while AI agents write most of the code. A state-management
library designed around older human-first workflows and trade-offs is not
enough for that environment. Reflex therefore needs new contracts, tools, and
execution semantics designed specifically for AI-agent development.

Reflex is being reinvented as an agent-first state-management and application
runtime for AI-assisted and agentic development.

This repository is an active design and implementation workspace. It is not a
stable framework release, and the current intent is to push the source tree for
collaboration and review—not to publish the packages to npm. APIs, package
boundaries, and documentation may change while the foundation is being
reworked.

## What is being explored

- deterministic event-driven state transitions and derived subscriptions;
- explicit runtime ownership and isolation for applications, tests, SSR, and
  parallel agent sandboxes;
- declarative effects and coeffects with observable execution boundaries;
- headless execution and DevTools/MCP inspection for an edit → run → verify
  agent loop;
- persistence and future command/operation contracts designed for safe,
  machine-readable agent interaction.

The guiding idea is that an agent should be able to discover the application
model, make a targeted change, execute it, and verify what happened from
structured runtime evidence instead of guessing from source text or logs.

## Workspaces

- [`@flexsurfer/reflex`](packages/reflex) — the experimental core runtime,
  React bindings, vanilla/headless APIs, tests, benchmarks, and agent templates.
- [`@flexsurfer/reflex-persist`](packages/reflex-persist) — experimental
  synchronous persistence built on the public runtime APIs.
- [`@flexsurfer/reflex-devtools`](packages/reflex-devtools) — DevTools SDK, server,
  CLI, security boundaries, and package assembly.
- [`@flexsurfer/reflex-devtools-mcp`](packages/reflex-devtools-mcp) — the
  experimental MCP bridge for inspection and controlled development actions.
- [`@flexsurfer/reflex-devtools-ui`](packages/reflex-devtools-ui) — the local
  dashboard source used by DevTools during development.
- [`TodoMVC`](examples/todomvc) and [`DevTools playground`](examples/devtools-playground)
  — example applications and integration fixtures.

Package metadata includes build and future packaging configuration, but that is
not a claim that the current framework is ready for publication.

## Development

Use Node.js `^22.18.0` or `>=24.11.0` and the pnpm version pinned in
`package.json`.

```sh
pnpm install
pnpm build
pnpm check
pnpm test
```

Useful local development commands include:

```sh
pnpm dev:reflex
pnpm dev:server
pnpm dev:ui
pnpm dev:playground
pnpm dev:playground:headless
pnpm dev:todomvc
```

## Documentation

- [`ROADMAP.md`](ROADMAP.md) — current execution track and release-readiness
  gates.
- [`docs/agent-operation-rfc.md`](docs/agent-operation-rfc.md) — canonical
  proposed direction for authoritative operations and agent-driven runtimes.
- [`docs/agent-first-priorities.md`](docs/agent-first-priorities.md) — the
  agent-first prioritization lens.
- [`docs/agent-workflow.md`](docs/agent-workflow.md) — the current
  edit → run → inspect → verify workflow.
- [`ADR-001-REFLEX-FOUNDATION.md`](ADR-001-REFLEX-FOUNDATION.md) — provisional
  architectural decisions for the redesign.
- [`docs/reflex-old-roadmap.md`](docs/reflex-old-roadmap.md) — historical
  roadmap retained for context; it is not the active execution plan.
- Package-level READMEs and `docs/` directories — implementation details,
  local development instructions, and package-specific contracts.

Security-sensitive behavior for the development tools is documented in
[`SECURITY.md`](SECURITY.md) and the DevTools package documentation.

## Status

The project is pre-1.0 and experimental. Treat the source, tests, examples,
and design documents as the current collaboration surface; do not rely on
them as a stable public API or release promise yet.

## License

MIT. See [`LICENSE`](LICENSE).
