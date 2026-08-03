<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="uklad-avatar-dark.png" />
    <img src="uklad-avatar.png" alt="Uklad" width="160" />
  </picture>
</div>

# Uklad monorepo

**Uklad is the new name for Reflex.** Reflex is a TypeScript port of re-frame
that has been publicly available for about a year and has proven itself in
production projects. This monorepo is both that rebrand — new name, new
`@ukladjs` npm scope, new home at `ukladjs/uklad` — and the workspace where the
next version is being built.

The existing Reflex packages remain published and can still be used; nothing is
being unpublished or taken away:

- [`@flexsurfer/reflex`](https://www.npmjs.com/package/@flexsurfer/reflex)
- [`@flexsurfer/reflex-devtools`](https://www.npmjs.com/package/@flexsurfer/reflex-devtools)
- [`@flexsurfer/reflex-devtools-mcp`](https://www.npmjs.com/package/@flexsurfer/reflex-devtools-mcp)

This monorepo is about what comes next. In the year since Reflex began, the way
software is written has changed dramatically: people increasingly describe and
review systems while AI agents write most of the code. A state-management
library designed around older human-first workflows and trade-offs is not
enough for that environment. Uklad therefore needs new contracts, tools, and
execution semantics designed specifically for AI-agent development.

Uklad is being reinvented as an agent-first state-management and application
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

- [`@ukladjs/core`](packages/core) — the experimental core runtime,
  React bindings, vanilla/headless APIs, tests, benchmarks, and agent templates.
- [`@ukladjs/persist`](packages/persist) — experimental
  synchronous persistence built on the public runtime APIs.
- [`@ukladjs/devtools`](packages/devtools) — DevTools SDK, server,
  CLI, security boundaries, and package assembly.
- [`@ukladjs/devtools-mcp`](packages/devtools-mcp) — the
  experimental MCP bridge for inspection and controlled development actions.
- [`@ukladjs/devtools-ui`](packages/devtools-ui) — the private
  dashboard source assembled into the DevTools package.
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

`pnpm check` is the deterministic development check and does not install
packages from the registry. Fresh-install consumer tests are intentionally
separate because they require network access and an empty npm cache:

```sh
pnpm check:package # packed-package consumers only; requires registry access
pnpm check:all     # development checks, then packed-package consumers
```

Useful local development commands include:

```sh
pnpm dev:core
pnpm dev:server
pnpm dev:ui
pnpm dev:playground
pnpm dev:playground:headless
pnpm dev:todomvc
```

## Documentation

- [`docs/README.md`](docs/README.md) — documentation index and structure.
- [`docs/architecture/application-authoring-rules.md`](docs/architecture/application-authoring-rules.md)
  — concise required rules for agent- and human-authored Uklad applications.
- [`docs/roadmaps/uklad.md`](docs/roadmaps/uklad.md) — current execution track
  and release-readiness gates.
- [`docs/rfcs/agent-operations.md`](docs/rfcs/agent-operations.md) — canonical
  proposed direction for authoritative operations and agent-driven runtimes.
- [`docs/agent-development/priorities.md`](docs/agent-development/priorities.md)
  — the agent-first prioritization lens.
- [`docs/agent-development/workflow.md`](docs/agent-development/workflow.md) —
  the current edit → run → inspect → verify workflow.
- [`docs/architecture/foundation-adr.md`](docs/architecture/foundation-adr.md)
  — provisional architectural decisions for the redesign.
- [`docs/roadmaps/historical-uklad.md`](docs/roadmaps/historical-uklad.md) —
  historical roadmap retained for context; it is not the active execution plan.
- Package-level READMEs — short package entry points that link to canonical
  documentation here.

Security-sensitive behavior for the development tools is documented in
[`SECURITY.md`](SECURITY.md) and the DevTools package documentation.

## Status

The project is pre-1.0 and experimental. Treat the source, tests, examples,
and design documents as the current collaboration surface; do not rely on
them as a stable public API or release promise yet.

## License

MIT. See [`LICENSE`](LICENSE).
