# Stability and versioning

This policy applies to the Reflex 1.0 release-candidate series and stable 1.x
releases. Reflex follows Semantic Versioning for its documented public package
APIs and behavioral contracts.

## Public surfaces

The supported runtime entrypoints are:

- `@flexsurfer/reflex` — the compatibility facade and combined public surface;
- `@flexsurfer/reflex/vanilla` — runtime creation, non-React APIs, and their
  public types;
- `@flexsurfer/reflex/react` — the provider, hooks, and React hot-reload
  helpers.

Only exports reachable through a package's documented `exports` map are
public. Source paths, generated chunks, files under `dist`, and undocumented
deep imports are internal even when a tool can resolve them. Their names and
layout may change in any release.

The DevTools and MCP packages have their own public entrypoints and package
versions. Their wire protocol and the runtime inspector API are versioned
contracts described separately below.

## Release-candidate policy

The `1.0.0-rc.N` series is the API-freeze and production-validation period.
Runtime identity, store-local contract field names, provider selection,
module-disposer idempotence, restore behavior, and flush semantics are
release-candidate stability commitments.

An RC may still change before final 1.0 when an acceptance gate, security
issue, or real-application finding shows that the proposed contract is unsafe
or cannot be maintained. Such a change must:

1. be documented in release notes and the migration guide;
2. advance the prerelease number;
3. include an automated regression or acceptance test; and
4. avoid silent fallback when a fail-closed protocol or isolation boundary is
   involved.

The final `1.0.0` release is expected to preserve the last RC's documented
surface. Any unavoidable exception must be called out before the final release,
with a direct migration path.

No compatibility promise is made from an arbitrary 0.x release to 1.0 beyond
the guarantees explicitly listed in the
[0.x migration guide](migration-0.x-to-1.0.md).

## Stable semantic versions

After `1.0.0`:

- A **patch** release fixes defects, security issues, declaration mistakes, or
  documentation without intentionally changing supported behavior.
- A **minor** release adds backward-compatible APIs, options, diagnostics, or
  capabilities. New fields are optional or otherwise safe for existing
  consumers.
- A **major** release may remove or rename public APIs, reject previously valid
  input, change documented timing or lifecycle behavior, or drop a supported
  platform/compiler version.

Semver applies to runtime behavior as well as function names. The following
are breaking changes when they alter a documented guarantee:

- event queue ordering or `dispatch`/`dispatchSync` completion semantics;
- `flush()` or restore publication boundaries;
- subscription equality, notification, or lifecycle behavior;
- provider selection and fallback behavior;
- module installation, ownership, or disposal behavior;
- cross-runtime isolation;
- accepted contract shapes and TypeScript inference;
- runtime identity or DevTools routing semantics.

Fixing behavior that was never documented, was explicitly unsupported, or was
a clear violation of an isolation or security invariant is normally a patch.
When existing applications could reasonably depend on the behavior, release
notes must still describe the impact and a minor or major release may be more
appropriate.

## Explicit-runtime API

The public API creates no package-global runtime. Applications construct a
runtime with `createReflexRuntime`, register behavior on that instance, and
provide it to React through `ReflexProvider`. `useSubscription` without a
provider throws. Runtime identity, scheduling, contracts, and lifecycle are
therefore local to the application-owned instance.

## Instance-runtime guarantees

Each runtime exclusively owns its database heads, event queue, registries,
event metadata, global interceptors, subscription engine and cache, tracing,
schedulers, built-ins, module installations, and inspector.

The following are correctness guarantees, not best-effort behavior:

- two runtimes in one JavaScript realm do not share mutable runtime state;
- reset and module disposal affect only the target runtime;
- scheduled work captures its owning runtime;
- the vanilla entrypoint does not load React;
- nested providers select the nearest runtime;
- server requests can use independent runtimes;
- inspectors and DevTools operations remain bound to one runtime identity;
- explicit runtime instances do not trigger the duplicate-package-copy
  warning.

Cross-runtime state, handler, queue, subscription, trace, or reset leakage is a
bug eligible for a patch release.

## TypeScript stability

Public declaration files and inference behavior are part of the API. Store-local
contracts and the compatibility module-augmentation interfaces are both
supported surfaces.

Additive type improvements may ship in a minor release. A patch may correct a
declaration that did not describe the documented runtime behavior, although
code relying on the incorrect declaration may need adjustment. Narrowing valid
inputs, removing an exported type, changing a contract field, or dropping a
documented TypeScript version is a breaking change after 1.0.

Contracts provide compile-time checking only. They do not promise runtime
payload validation; applications must validate data arriving from external
trust boundaries.

## Deprecation policy

Public APIs are deprecated in documentation, declaration annotations, and
release notes before removal. A deprecation notice includes:

- the replacement or migration path;
- the reason for the change;
- the earliest major version in which removal may occur; and
- known behavioral differences in the replacement.

Deprecation itself is additive and may occur in a minor release. Removal or a
change that makes previously valid usage fail requires a major release. Security
issues may require faster action, but the release must explain the risk and
offer the safest practical migration.

## Experimental and internal APIs

An API is experimental only when its public documentation and declaration mark
it as such. Experimental APIs may change in a minor release, but changes must
still be documented. Unmarked exports from a supported entrypoint are treated
as stable after 1.0.

Symbols annotated `@internal`, undocumented diagnostic implementation fields,
source modules, cache layouts, generated filenames, and scheduling
implementation details outside the documented completion contract are not
covered by semver.

## DevTools and protocol versions

Package versions, the Reflex inspector API version, and the DevTools wire
protocol version are related but distinct:

- Package versions describe the published JavaScript and TypeScript APIs.
- The inspector API version describes the structural adapter accepted by the
  DevTools client.
- The wire protocol version describes messages exchanged among runtimes, the
  DevTools server/dashboard, and MCP clients.

An incompatible inspector or wire change increments its corresponding protocol
version and ships in coordinated releases of every affected package. Version
negotiation remains fail-closed: unsupported peers report the mismatch rather
than guessing, silently downgrading, or accepting ambiguous runtime selection.

Release notes must list compatible runtime, DevTools, and MCP ranges whenever
their package versions differ. Adding optional fields that older peers can
safely ignore may retain a protocol version; changing required identity,
routing, authorization, cursor, or reconnect semantics requires an explicit
protocol-version review.

## Supported environments and security fixes

The compatibility matrix defines supported React, React Native, TypeScript,
Node/headless, browser, Metro, and Hermes versions. Dropping a supported target
after 1.0 is a breaking change unless the target itself has reached end of life
under the published support policy.

Security fixes are provided according to `SECURITY.md`. A security release may
intentionally reject unsafe input or deployment configurations in a patch when
preserving the old behavior would preserve the vulnerability.

## Release documentation

Every release-candidate and stable release includes:

- release notes describing user-visible behavior and compatibility;
- migration guidance for breaking or RC-adjusted contracts;
- the supported environment matrix;
- protocol compatibility when DevTools packages are involved; and
- deprecation notices and removals, if any.

The architectural ownership and lifecycle contract is defined by the
[instance-scoped runtime RFC](https://github.com/flexsurfer/reflex/blob/main/docs/runtime-rfc.md).
