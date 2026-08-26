# Stability and versioning

Uklad is a rebrand of Reflex. The previously published
`@flexsurfer/reflex*` packages remain available; the package set below tracks
the current `@ukladjs` release line. Packages version independently; core,
DevTools, MCP, and persistence currently use `0.2` lines while the TanStack
Query integration remains on its `0.1` line.

`@ukladjs/core` is production-ready. Pre-1.0 identifies the current version
line; the documented public API is the stable application boundary. The full
decision guide is in [production readiness](../production-readiness.md).

## Current release set

| Package                   | Version | npm tag  | Status                                    |
| ------------------------- | ------- | -------- | ----------------------------------------- |
| `@ukladjs/core`           | `0.2.3` | `latest` | Production-ready, compatibility protected |
| `@ukladjs/devtools`       | `0.2.0` | `latest` | Supported development/CI tooling          |
| `@ukladjs/devtools-mcp`   | `0.2.0` | `latest` | Supported development/CI agent bridge     |
| `@ukladjs/persist`        | `0.2.0` | `latest` | Supported sync and async persistence       |
| `@ukladjs/tanstack-query` | `0.1.0` | `latest` | Supported TanStack Query v5 integration   |

[`release.json`](../../release.json) is the machine-readable source for this
set. Packages version independently; a coordinated release does not require
matching numbers.

## Compatibility baseline

- Node.js: `^22.18.0 || >=24.11.0` for supported development, SSR/headless,
  DevTools, MCP, tests, and packaging workflows. CI exercises Node 22, 24, and 26.
- React: 18.3 and 19.2 are exercised in CI. React remains an optional peer of
  core so vanilla/headless consumers do not install it.
- TypeScript: declaration and consumer checks cover 4.9, 5.3, 6, and 7.
- Module systems: packed-package consumers exercise ESM and CommonJS entry points.
- TanStack Query: `@tanstack/query-core@^5.0.0` is the required application-owned
  peer for `@ukladjs/tanstack-query`.
- Persistence: synchronous browser/Expo storage and ordered asynchronous native
  storage, migrations, transforms, hydration barriers, durability flushes, and
  runtime attachment are supported through `@ukladjs/persist`.
- React Native uses the same platform-neutral runtime and React binding.

Exact package manifests and package READMEs take precedence when a range is
narrower. The source, tests, examples, and canonical application authoring
documents remain the authoritative collaboration surface.

## Compatibility-protected 0.x policy

Uklad follows SemVer and voluntarily provides a stronger guarantee than the
usual 0.x allowance. Each package versions independently and never republishes
an existing version.

- The current documented production API is the compatibility baseline for 1.0.
- Routine 0.x minor and patch releases do not remove or rename supported public
  APIs, reject previously valid calls, or silently change documented semantics.
- Additive APIs, compatible type improvements, diagnostics, performance work,
  and corrective bug fixes may ship in minor or patch releases.
- Replacement APIs ship additively. Deprecated APIs remain available for at
  least one full minor line and receive a migration path.
- Undocumented implementation modules are outside this guarantee.
- A security or correctness defect may require an urgent narrow change. The
  changelog and any advisory document the impact and safest migration or bridge.
- After 1.0, an intentional compatibility break requires a major release.

Record every user-visible change in `CHANGELOG.md`. Update examples, agent
skills, pinned MCP configurations, peer ranges, and website snippets together
whenever their contract changes.

The release process, provenance bootstrap, dist-tags, and recovery rules are in
[`RELEASING.md`](../../RELEASING.md). The [Uklad roadmap](../roadmaps/uklad.md)
tracks additive capabilities and future releases.
