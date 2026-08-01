# Stability and versioning

Reflex is published in the 0.x range while its runtime and agent-operation
contracts are still being finalized. Published packages are usable experimental
releases; they are not a 1.0 compatibility promise.

The current package versions and supported Node engines are defined by each
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
[Reflex roadmap](../roadmaps/reflex.md).
