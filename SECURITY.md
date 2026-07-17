# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/flexsurfer/reflex/security/advisories/new).
Do not open a public issue or pull request for a suspected vulnerability.

A useful report includes the affected package and version, a reproduction or
proof of concept, and your assessment of the impact. You can expect an
acknowledgement within 7 days. This is a maintainer-run project: fixes are
best-effort, and disclosure timing is coordinated with the reporter before
anything is published.

## Supported versions

Reflex is pre-1.0. Security fixes land in the latest published version of each
package; older `0.x` releases are not patched.

## Scope

In scope are the published packages:

- [`@flexsurfer/reflex`](packages/reflex) — the runtime.
- [`@flexsurfer/reflex-devtools`](packages/reflex-devtools) — the DevTools SDK,
  server, CLI, and the embedded dashboard UI.
- [`@flexsurfer/reflex-devtools-mcp`](packages/reflex-devtools-mcp) — the MCP
  bridge.

Example applications and private workspace packages are out of scope, but
reports about them are still welcome if they reveal a problem in a published
package.

## Trust model

DevTools is development-only tooling and must not be pointed at production
data or exposed to untrusted networks. Its threat model, security defaults
(authentication, loopback-only binding, read-only capabilities, redaction,
bounded payloads, audit records), and remote-access hardening guidance are
documented in the
[DevTools security model](packages/reflex-devtools/README.md#security-model)
and the [MCP bridge README](packages/reflex-devtools-mcp/README.md).

Two boundaries documented there are worth restating: loopback binding is a
machine/network-namespace boundary, not a same-user boundary, and
authentication does not make arbitrary network exposure safe. Reports that
assume a deployment which violates the documented trust model (for example,
DevTools exposed directly to the public internet) may be resolved as
documentation clarifications rather than code fixes.
