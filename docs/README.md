# Reflex documentation

The `docs/` directory is the canonical home for detailed Reflex design,
architecture, engineering, compatibility, agent-development, and roadmap
documents. Package READMEs remain short package-facing entry points; they link
back here for the deeper material.

## Architecture

- [Foundation ADR](architecture/foundation-adr.md) — provisional architectural
  direction for the redesign.
- [Canonical application structure](architecture/canonical-app-structure.md) —
  shared runtime, flat reactive roots, feature organization, and the central
  application catalog.
- [Reflex runtime architecture](architecture/reflex-runtime.md) — current
  runtime ownership and execution structure.
- [Subscription runtime](architecture/subscription-runtime.md) — graph
  activation, publication, equality, and lifecycle semantics.
- [Subscription bookkeeping](architecture/subscription-registry.md) — registry,
  cache, and release bookkeeping.
- [Reflex Persist architecture](architecture/reflex-persist.md) — persistence
  module boundaries and invariants.

## RFCs

- [Authoritative agent operations](rfcs/agent-operations.md)
- [Instance-scoped runtime](rfcs/instance-scoped-runtime.md)
- [Persistence](rfcs/persistence.md)

## Agent development

- [Agent-first priorities](agent-development/priorities.md)
- [Agent workflow](agent-development/workflow.md)
- [Headless state fixtures](agent-development/headless-fixtures.md)
- [Historical re-frame priorities](agent-development/historical-re-frame-priorities.md)

## Roadmaps

- [Reflex roadmap](roadmaps/reflex.md) — active execution track.
- [DevTools roadmap](roadmaps/devtools.md)
- [Historical Reflex roadmap](roadmaps/historical-reflex.md)

## Engineering and compatibility

- [Code conventions](engineering/code-conventions.md)
- [Performance benchmarks](engineering/performance-benchmarks.md)
- [Re-frame parity trade-offs](compatibility/re-frame-parity.md)
- [Redux Toolkit and Zustand feature parity](compatibility/redux-zustand-parity.md)
- [Stability and versioning](compatibility/stability-and-versioning.md) — the
  current 0.x support and release policy.
