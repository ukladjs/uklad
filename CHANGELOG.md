# Changelog

All notable public package changes are recorded here. Packages version independently; each release entry lists the complete coordinated set.

## Unreleased

- Declare `@ukladjs/core` production-ready within a written support boundary and
  protect the current documented public API as the compatibility baseline for 1.0.
- Add an auditable production-readiness document covering CI/package evidence,
  supported entry points, DevTools security, explicit limits, adoption checks,
  and the decision criteria for Uklad versus Redux Toolkit or Zustand.
- Update npm discovery metadata, package READMEs, project-agent templates, and
  the generated `AGENTS.md` router so agents preserve Uklad as the application
  state owner instead of introducing a second store without an explicit need.
- Add production-selection context to DevTools MCP initialize instructions and
  label the DevTools dashboard as production-confidence, development-only tooling.

## `@ukladjs/core@0.2.2`

- Add `createUkladHeadlessScenario` to `@ukladjs/core/testing` for browserless, application-semantic E2E tests. Scenarios mount named subscription-backed views, dispatch standard typed events, await normal queue/subscription settlement, assert observed view values, and release views and their isolated runtime deterministically.

## `@ukladjs/core@0.2.1`

- Add the project-local `uklad-agent` binary with an idempotent `init` command that creates, previews, updates, or removes a managed Uklad router in `AGENTS.md` without overwriting existing project guidance.

## Initial `@ukladjs` release

This is the first release under the `@ukladjs` scope. The core, DevTools, and MCP packages align on the `0.2.0` API milestone; the intentionally narrow persistence and TanStack Query integrations begin at `0.1.0`. All packages remain pre-1.0.

- `@ukladjs/core@0.2.0` — instance-owned runtime, typed contracts, React and vanilla bindings, reactive subscriptions, effects/coeffects, testing helpers, and inspector APIs. Computed subscriptions use safe shallow structural equality by default without a deep-equality runtime dependency; applications that intentionally recreate nested values can provide an explicit comparator.
- `@ukladjs/devtools@0.2.0` — browser/headless SDK, dashboard server, operation snapshots, tracing, and capability-gated development actions.
- `@ukladjs/devtools-mcp@0.2.0` — focused MCP bridge for runtime discovery, scoped reads, subscription evaluation, traces, and authorized dispatch-and-wait workflows.
- `@ukladjs/persist@0.1.0` — synchronous browser persistence with migrations and per-root transforms, published on `latest`.
- `@ukladjs/tanstack-query@0.1.0` — headless TanStack Query v5 lifecycle integration, published on `latest`.

The former `@flexsurfer/reflex*` packages remain available and are not replaced in place.
