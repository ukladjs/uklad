# Stability and versioning

Uklad is a rebrand of Reflex. The previously published
`@flexsurfer/reflex*` packages remain available; the package set below is the
first release under the `@ukladjs` scope. Core, DevTools, and MCP align on the
`0.2.0` API milestone, while the integrations start their own `0.1.0` lines.

## Initial release set

| Package                   | Version        | npm tag  | Stability                          |
| ------------------------- | -------------- | -------- | ---------------------------------- |
| `@ukladjs/core`           | `0.2.0` | `latest` | Experimental 0.x                   |
| `@ukladjs/devtools`       | `0.2.0` | `latest` | Experimental 0.x, development only |
| `@ukladjs/devtools-mcp`   | `0.2.0` | `latest` | Experimental 0.x, development only |
| `@ukladjs/persist`        | `0.1.0` | `latest` | Browser CSR synchronous initial release |
| `@ukladjs/tanstack-query` | `0.1.0` | `latest` | TanStack Query v5 initial release  |

[`release.json`](../../release.json) is the machine-readable source for this
set. Packages version independently; a coordinated release does not require
matching numbers.

## Compatibility baseline

- Node.js: `^22.18.0 || >=24.11.0` for supported development, SSR/headless,
  DevTools, MCP, tests, and packaging workflows.
- React: 18.3 and 19.2 are exercised in CI. React remains an optional peer of
  core so vanilla/headless consumers do not install it.
- TypeScript: declaration and consumer checks cover 4.9, 5.3, 6, and 7.
- TanStack Query: `@tanstack/query-core@^5.0.0` is the required application-owned
  peer for `@ukladjs/tanstack-query`.
- Persistence: the initial release supports synchronous browser CSR storage. Async
  durability, SSR, custom merge, and multi-attach remain unsupported.
- React Native, Metro, and Hermes are architectural targets but do not yet have
  a published automated support matrix; treat them as experimental until those
  gates land.

Exact package manifests and package READMEs take precedence when a range is
narrower. The source, tests, examples, and canonical application authoring
documents remain the authoritative collaboration surface.

## Pre-1.0 change policy

Uklad follows SemVer, with the normal 0.x caveat that a minor release may
contain breaking API or architecture changes. Each package versions
independently and never republishes an existing version.

- Record user-visible changes and migration steps in `CHANGELOG.md`.
- Keep deprecated APIs for at least one subsequent release when practical;
  security, correctness, or ownership-boundary fixes may require faster removal.
- Announce breaking changes in release notes and update examples, agent skills,
  pinned MCP configurations, peer ranges, and website snippets together.
- Treat roadmap items as direction, not release promises.

The release process, provenance bootstrap, dist-tags, and recovery rules are in
[`RELEASING.md`](../../RELEASING.md). Stable 1.0 support remains gated by the
[Uklad roadmap](../roadmaps/uklad.md).
