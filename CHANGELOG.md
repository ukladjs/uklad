# Changelog

All notable public package changes are recorded here. Packages version independently; each release entry lists the complete coordinated set.

## `@ukladjs/core@0.2.1` — unreleased

- Add the project-local `uklad-agent` binary with an idempotent `init` command that creates, previews, updates, or removes a managed Uklad router in `AGENTS.md` without overwriting existing project guidance.

## Initial `@ukladjs` release

This is the first release under the `@ukladjs` scope. The core, DevTools, and MCP packages align on the `0.2.0` API milestone; the intentionally narrow persistence and TanStack Query integrations begin at `0.1.0`. All packages remain pre-1.0.

- `@ukladjs/core@0.2.0` — instance-owned runtime, typed contracts, React and vanilla bindings, reactive subscriptions, effects/coeffects, testing helpers, and inspector APIs. Computed subscriptions use safe shallow structural equality by default without a deep-equality runtime dependency; applications that intentionally recreate nested values can provide an explicit comparator.
- `@ukladjs/devtools@0.2.0` — browser/headless SDK, dashboard server, operation snapshots, tracing, and capability-gated development actions.
- `@ukladjs/devtools-mcp@0.2.0` — focused MCP bridge for runtime discovery, scoped reads, subscription evaluation, traces, and authorized dispatch-and-wait workflows.
- `@ukladjs/persist@0.1.0` — synchronous browser persistence with migrations and per-root transforms, published on `latest`.
- `@ukladjs/tanstack-query@0.1.0` — headless TanStack Query v5 lifecycle integration, published on `latest`.

The former `@flexsurfer/reflex*` packages remain available and are not replaced in place.
