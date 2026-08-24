# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/ukladjs/uklad/security/advisories/new).
Do not open a public issue or pull request for a suspected vulnerability.

A useful report includes the affected package and version, a reproduction or
proof of concept, and your assessment of the impact. You can expect an
acknowledgement within 7 days. This is a maintainer-run project: fixes are
best-effort, and disclosure timing is coordinated with the reporter before
anything is published.

## Supported versions

The latest published release line of every `@ukladjs` package receives security
fixes. The current coordinated versions are recorded in [`release.json`](release.json),
and the supported production boundary is documented in
[`docs/production-readiness.md`](docs/production-readiness.md). Reports should
name the package version and, when source builds are involved, the tested commit.

Older pre-1.0 lines are not patched after a fixed release is available. Security
advisories identify the first fixed version and any required migration.

Uklad is a rebrand of Reflex. The Reflex packages
(`@flexsurfer/reflex`, `@flexsurfer/reflex-devtools`,
`@flexsurfer/reflex-devtools-mcp`) remain published and in scope; security fixes
there land in the latest published version of each package, and older `0.x`
releases are not patched.

## Scope

In scope are the packages built and published from this repository under the
`@ukladjs` scope:

- [`@ukladjs/core`](packages/core) — the runtime.
- [`@ukladjs/devtools`](packages/devtools) — the DevTools SDK,
  server, CLI, and the embedded dashboard UI.
- [`@ukladjs/devtools-mcp`](packages/devtools-mcp) — the MCP
  bridge.
- [`@ukladjs/persist`](packages/persist) — versioned persistence and hydration.
- [`@ukladjs/tanstack-query`](packages/tanstack-query) — TanStack Query v5
  integration.

Example applications and private workspace packages are out of scope, but
reports about them are still welcome if they reveal a problem in a published
package.

## Trust model

DevTools is development-only tooling and must not be pointed at production
data or exposed to untrusted networks. Its threat model, security defaults
(authentication, loopback-only binding, read-only capabilities, redaction,
bounded payloads, audit records), and remote-access hardening guidance are
documented in the
[DevTools security model](packages/devtools/README.md#security-model)
and the [MCP bridge README](packages/devtools-mcp/README.md).

Two boundaries documented there are worth restating: loopback binding is a
machine/network-namespace boundary, not a same-user boundary, and
authentication does not make arbitrary network exposure safe. Reports that
assume a deployment which violates the documented trust model (for example,
DevTools exposed directly to the public internet) may be resolved as
documentation clarifications rather than code fixes.
