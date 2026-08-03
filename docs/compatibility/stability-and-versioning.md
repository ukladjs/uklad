# Stability and versioning

No `@ukladjs` package has been published to npm yet. Uklad is a rebrand of
Reflex, and the previously published `@flexsurfer/reflex*` packages remain
available; this repository is the source for the packages that will ship under
the `@ukladjs` scope.

Uklad will release in the 0.x range while its runtime and agent-operation
contracts are still being finalized. Those releases are intended as usable
experimental packages; they are not a 1.0 compatibility promise.

The planned package versions and supported Node engines are defined by each
package manifest. The core runtime and persistence package currently require
`^22.18.0 || >=24.11.0`; DevTools and MCP have their own release versions and
protocol compatibility checks.

During 0.x, breaking changes may occur when the architecture changes. The
source, tests, examples, and the canonical application-structure document are
the authoritative collaboration surface. Package READMEs describe published
package entry points; the `docs/` tree describes repository-wide architecture
and workflow.

Before 1.0, the project still needs a complete compatibility matrix, changelog,
deprecation policy, and release automation. Those are tracked in the
[Uklad roadmap](../roadmaps/uklad.md).
