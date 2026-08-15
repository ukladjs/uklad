<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="uklad-avatar-dark.png" />
    <img src="uklad-avatar.png" alt="Uklad" width="160" />
  </picture>
</div>

# Uklad monorepo

**A deterministic application runtime for React and React Native, built so
humans and coding agents can observe and verify every state change.**

**Uklad is the new name for Reflex.** Reflex is a TypeScript port of re-frame
that has been publicly available for about a year and has proven itself in
production projects. This monorepo is both that rebrand — new name, new
`@ukladjs` npm scope, new home at `ukladjs/uklad` — and the workspace where the
next version is being built.

## Why Uklad — and the roadmap

Uklad is not trying to clone every Redux Toolkit API or compete with Zustand
on minimum bundle size. Its bet is that application behavior should be
deterministic, observable, and directly verifiable by coding agents. The first
rows show what is already distinctive in this repository; the rest show
shipped parity and the gaps that remain.

This compares official or first-party paths unless a cell says otherwise.
Community packages may cover additional cases.

Legend: ✅ built in · 🟡 partial, beta, or ecosystem-assisted · ⬜ planned ·
— no first-party equivalent.

| Capability                                        | Uklad in this repository                                                                                                             | Redux Toolkit                                   | Zustand                                       | Direction                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| **Agent runtime inspection and control**          | ✅ [MCP](packages/devtools-mcp): discover, inspect, trace, and perform authorized, outcome-verified dispatches—browser or headless   | — no first-party agent protocol                 | — no first-party agent protocol               | **Differentiator · shipped**                                                      |
| **Effects and environmental inputs as data**      | ✅ declarative effects + injected, replaceable coeffects                                                                             | 🟡 thunks, listeners, and middleware callbacks  | 🟡 application-defined actions and middleware | **Differentiator · shipped**                                                      |
| **Causal runtime evidence**                       | ✅ events → patches → effects → subscriptions/renders/errors                                                                         | 🟡 action and state history                     | 🟡 action and state history                   | **Differentiator · shipped**                                                      |
| **Runtime-owned derived graph**                   | ✅ memoized, topological, lifecycle-managed, and traceable [subscription DAG](docs/architecture/subscription-runtime.md)             | 🟡 Reselect memoization; lifecycle is app-owned | 🟡 derived state and lifecycle are app-owned  | **Differentiator · shipped**                                                      |
| **Explicit isolation plus multi-runtime tooling** | ✅ instance-owned runtime + routing across SSR, widgets, tests, and agent sandboxes                                                  | ✅ independent and per-request stores           | ✅ independent vanilla and per-request stores | **Parity+ · shipped**                                                             |
| **Concurrent React, typed APIs, sync dispatch**   | ✅ `useSyncExternalStore`, runtime contracts, `dispatchSync`                                                                         | ✅                                              | ✅                                            | **Parity · shipped**                                                              |
| **Vanilla subscriptions and per-request SSR**     | ✅ derived reads/watches, hydration, request isolation                                                                               | ✅                                              | ✅                                            | **Parity · shipped**                                                              |
| **Lazy feature registration**                     | ✅ scoped install/dispose with safe HMR                                                                                              | ✅ reducer and endpoint injection               | 🟡 application-managed                        | **Parity · shipped**                                                              |
| **Persistence + versioned migrations**            | 🟡 official synchronous initial release                                                                                              | 🟡 ecosystem (`redux-persist`)                  | ✅ official sync/async middleware             | **Narrow scope** · async durability, SSR, merge, multi-attach remain              |
| **Fail-loud diagnostics**                         | 🟡 strict errors; typo suggestions missing                                                                                           | ✅ invariant checks and diagnostics             | 🟡 limited built-in checks                    | **Roadmap** · suggestions and release hardening                                   |
| **Async server data and caching**                 | 🟡 [`@ukladjs/tanstack-query`](packages/tanstack-query) pairs headless TanStack Query with Uklad subscriptions; effects for commands | ✅ RTK Query                                    | 🟡 pair with a server-state library           | **Intentional pairing** · managed read-only snapshots, not a writable cache clone |
| **Per-call subscription equality**                | 🟡 definition/runtime level                                                                                                          | ✅ per hook call                                | ✅ custom-equality hooks                      | **Backlog** · evidence-driven                                                     |
| **Entity / normalization helpers**                | ⬜                                                                                                                                   | ✅ `createEntityAdapter`                        | —                                             | **Backlog** · evidence-driven                                                     |
| **Time travel and application undo/redo**         | 🟡 patch groundwork; semantics open                                                                                                  | ✅ DevTools time travel                         | 🟡 DevTools/community                         | **Roadmap** · specify replay, effects, privacy, and persistence first             |
| **Supervised async tasks**                        | ⬜ identity, cancellation, timeout, concurrency, traces                                                                              | 🟡 thunk/listener primitives                    | 🟡 application-defined                        | **Roadmap** · build on the operation spine                                        |

Rows marked roadmap or backlog are direction, not release promises. See the
[detailed parity notes](docs/compatibility/redux-zustand-parity.md) and the
[active Uklad roadmap](docs/roadmaps/uklad.md) for the decisions behind them.

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

This repository remains an active design and implementation workspace, but its
first experimental `@ukladjs` package set is now prepared for publication.
These are pre-1.0 releases: APIs, package boundaries, and documentation may
still change while the foundation is being finalized.

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

- [`@ukladjs/core@0.2.1`](packages/core) — the core runtime,
  React bindings, vanilla/headless APIs, tests, benchmarks, agent templates,
  and the safe `uklad-agent init` project router.
- [`@ukladjs/persist@0.1.0`](packages/persist) — intentionally narrow
  synchronous persistence built on the public runtime APIs.
- [`@ukladjs/tanstack-query@0.1.0`](packages/tanstack-query) — headless TanStack Query integration
  that routes observer updates through Uklad events and managed state.
- [`@ukladjs/devtools@0.2.0`](packages/devtools) — DevTools SDK, server,
  CLI, security boundaries, and package assembly.
- [`@ukladjs/devtools-mcp@0.2.0`](packages/devtools-mcp) — the
  MCP bridge for inspection and controlled development actions.
- [`@ukladjs/devtools-ui`](packages/devtools-ui) — the private
  dashboard source assembled into the DevTools package.
- [`TodoMVC (persist)`](examples/todomvc),
  [`TodoMVC (TanStack Query)`](examples/todomvc-query), and
  [`DevTools playground`](examples/devtools-playground) — example applications
  and integration fixtures.

The coordinated versions and dist-tags are machine-checked from
[`release.json`](release.json). See [`CHANGELOG.md`](CHANGELOG.md) for the
initial release notes and [`RELEASING.md`](RELEASING.md) for the dry-run-first
publishing procedure.

## Install

```sh
npm install @ukladjs/core@0.2.1
```

Install the optional integrations from the coordinated initial release:

```sh
npm install @ukladjs/persist@0.1.0
npm install @ukladjs/tanstack-query@0.1.0 @tanstack/query-core@^5.0.0
```

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
pnpm release:check # full checks plus every public package dry run
```

Useful local development commands include:

```sh
pnpm dev:core
pnpm dev:server
pnpm dev:ui
pnpm dev:playground
pnpm dev:playground:headless
pnpm dev:todomvc
pnpm dev:todomvc-query
```

## Documentation

- [`docs/README.md`](docs/README.md) — documentation index and structure.
- [`docs/architecture/application-authoring-rules.md`](docs/architecture/application-authoring-rules.md)
  — concise required rules for agent- and human-authored Uklad applications.
- [`docs/roadmaps/uklad.md`](docs/roadmaps/uklad.md) — current execution track
  and release-readiness gates.
- [`docs/compatibility/stability-and-versioning.md`](docs/compatibility/stability-and-versioning.md)
  — pre-1.0 support, compatibility, and deprecation policy.
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

The initial packages are usable experimental releases, not a 1.0 compatibility
promise. Supported entry points and version ranges are documented; planned
features remain non-promises until they ship.

## License

MIT. See [`LICENSE`](LICENSE).
