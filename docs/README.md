# Uklad documentation

The `docs/` directory is the canonical home for detailed Uklad design,
architecture, engineering, compatibility, agent-development, and roadmap
documents. Package READMEs remain short package-facing entry points; they link
back here for the deeper material.

> **Naming:** Uklad is the new name for Reflex. These documents use "Uklad" and
> the `@ukladjs` scope throughout, including where they describe work done under
> the old name. The current packages are published and the supported core API is
> production-ready; see the [production-ready API](production-readiness.md) and
> [stability and versioning](compatibility/stability-and-versioning.md).

## Start here

- [Production-ready API](production-readiness.md) — stable application API,
  compatibility promise, automated evidence, explicit limits, and the decision
  guide for Uklad versus Redux Toolkit or Zustand.
- [Application authoring rules](architecture/application-authoring-rules.md) —
  the concise required architecture for production applications and agents.
- [Canonical application structure](architecture/canonical-app-structure.md) —
  the complete catalog, contract, feature, platform, and runtime layout.
- [Why Uklad: feature parity and product decisions](compatibility/redux-zustand-parity.md) —
  the detailed comparison with Redux Toolkit and Zustand.

## Architecture

- [Application authoring rules](architecture/application-authoring-rules.md) —
  concise required rules for application state, events, subscriptions, and
  platform boundaries.
- [Foundation ADR](architecture/foundation-adr.md) — provisional architectural
  direction for the redesign.
- [Canonical application structure](architecture/canonical-app-structure.md) —
  shared runtime, flat reactive roots, feature organization, and the central
  application catalog.
- [Uklad runtime architecture](architecture/uklad-runtime.md) — current
  runtime ownership and execution structure.
- [Subscription runtime](architecture/subscription-runtime.md) — graph
  activation, publication, equality, and lifecycle semantics.
- [Subscription bookkeeping](architecture/subscription-registry.md) — registry,
  cache, and release bookkeeping.
- [TanStack Query integration](architecture/tanstack-query.md) — ownership,
  lifecycle, and application-boundary rules for server data.
- [Uklad Persist architecture](architecture/uklad-persist.md) — persistence
  module boundaries and invariants.

## RFCs

- [Authoritative agent operations](rfcs/agent-operations.md)
- [Instance-scoped runtime](rfcs/instance-scoped-runtime.md)
- [Persistence](rfcs/persistence.md)
- [Cache-owned TanStack Query subscriptions](rfcs/tanstack-query-external-subscriptions.md)

## Agent development

- [Agent-first priorities](agent-development/priorities.md)
- [Agent workflow](agent-development/workflow.md)
- [Headless state fixtures](agent-development/headless-fixtures.md)
- [Historical re-frame priorities](agent-development/historical-re-frame-priorities.md)

## Roadmaps

- [Uklad roadmap](roadmaps/uklad.md) — active execution track.
- [DevTools roadmap](roadmaps/devtools.md)
- [Historical Uklad roadmap](roadmaps/historical-uklad.md)

## Engineering and compatibility

- [Code conventions](engineering/code-conventions.md)
- [Performance benchmarks](engineering/performance-benchmarks.md)
- [Re-frame parity trade-offs](compatibility/re-frame-parity.md)
- [Redux Toolkit and Zustand feature parity](compatibility/redux-zustand-parity.md)
- [Stability and versioning](compatibility/stability-and-versioning.md) — the
  current 0.x support and release policy.
