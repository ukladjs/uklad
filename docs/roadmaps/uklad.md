# Roadmap

> **Positioning:** Uklad is the deterministic application runtime for agentic React and React Native apps — observable and verifiable by humans and agents.

The runtime core is credible: concurrent-safe React bindings, a memoized subscription DAG, effects-as-data, tracing, a headless runtime, and an MCP verification loop. The bottleneck is productization, proof, and distribution — not additional state-management surface area. What's missing is everything that lets an architecture or security team say yes, and evidence that the AI-agent advantage is real rather than claimed.

Two clocks govern prioritization:

1. **The evidence clock.** There is no widely cited public benchmark for agent productivity with a state-management framework. Being first with reproducible numbers is worth more than being feature-complete.
2. **The breakage window.** At current adoption, breaking architectural changes are the cheapest they will ever be. Anything breaking must land before 1.0 — and 1.0 must wait for it.

When items compete, pick the one that feeds the proof or exploits the breakage window.

Detailed trackers this document links into:

- [docs/rfcs/agent-operations.md](../rfcs/agent-operations.md) — canonical
  architecture and phased delivery plan for authoritative agent operations.
  Its Phases 0–6 are the current execution track and supersede this document's
  older ordering wherever operation receipts, effect supervision, or agent
  safety were previously deferred.
- [docs/agent-development/priorities.md](../agent-development/priorities.md) — agent-first
  priority order combining AI-native requirements with human/API work
  re-ranked by its value to agents.
- [docs/roadmaps/devtools.md](devtools.md) — DevTools + MCP tool backlog; its non-operation backlog remains authoritative.
- [docs/roadmaps/historical-uklad.md](historical-uklad.md) — previous roadmap; its **agent indexing model** remains valid reference material.
- [Redux Toolkit and Zustand feature parity](../compatibility/redux-zustand-parity.md) — compatibility guidance extracted from the historical roadmap.
- [docs/agent-development/workflow.md](../agent-development/workflow.md) — the canonical agent scenario new tools are justified against.

The immediate architecture gate is no longer “more trace tooling.” It is the
core operation spine: exact invocation/event identities, committed and
published revisions, causal completion, structured state/effect results,
lookup, and retry safety. Supervised async tasks follow that spine before
Uklad makes a production-grade agent-runtime claim. Persistence,
productization, and distribution continue in parallel where they do not freeze
the old trace-derived completion contract.

Operation-spine status: **Phase 0 and Phase 1 of the [agent-operation RFC](../rfcs/agent-operations.md) are complete in the experimental core slice**, with package and persistence checks passing. Inspector/DevTools/MCP integration, enforced effect profiles, durable idempotency, and supervised async work remain open roadmap phases.

---

## Phase 0 — Source and release integrity (days, do first)

The strongest recent work is invisible: the source repository, package READMEs,
and examples must stay synchronized with the evolving runtime contract. The
current milestone is to review the published experimental surface; stable 1.0
support remains deferred until the redesign and release gates are complete.

- [x] Synchronize root/package READMEs and examples with the current API (`createUkladInspector`, current DevTools setup, and the canonical application structure).
- [x] Fix the swapped Best Practices / API Reference links in [packages/core/README.md](../../packages/core/README.md).
- [ ] Decide how the central `docs/` tree should be distributed with future package releases; package tarballs currently contain package code and package-facing READMEs, while deep documentation remains in the monorepo.
- [x] Pin MCP package versions in the shipped agent templates.
- [ ] Prepare coordinated prerelease versions and release notes after the experimental redesign reaches a release candidate.
- [ ] Run the full workspace check and packed-package dry runs.
- [ ] Push the synchronized source repository. Defer npm publication until the framework is ready and the release gates are complete.

## Phase 1 — Trust and measurement baseline (~1 month, parallelizable)

These items do not win an evaluation by themselves, but each removes a common reason for an architecture or security team to reject the framework before evaluating its differentiators.

- [x] **DevTools/MCP security baseline.** The server now uses generated role tokens for HTTP and WebSocket, exact browser-origin and Host checks, loopback-only binding by default, read-only MCP capabilities unless dispatch/restore are granted separately, bounded and schema-validated runtime/control data, application/server redaction hooks, mutation audit records, reconnect-safe runtime sessions, and a fail-closed runtime/DevTools/MCP protocol-version handshake. Principal-scoped capability policy and remote-deployment abuse controls remain explicitly tracked in the [DevTools roadmap](devtools.md#p2).
- [ ] **Fail-loud dev mode.** The instance API (`runtime.dispatch`,
  `dispatchSync`, `getSubscriptionValue`, `watchSubscription`, and
  `useSubscription` through it) now throws on malformed vectors and
  unregistered IDs in every mode. Add nearest-match suggestions ("did you mean
  `todos/add`?") to the explicit runtime surface. String IDs are only safe if
  mistakes surface immediately; this matters double for AI-generated code.
- [ ] **Release and support baseline.** `SECURITY.md` is present; remaining work includes `CHANGELOG.md`, a support/compatibility matrix, coordinated release automation, npm provenance/trusted publishing, and a documented deprecation policy. Define supported React, React Native, TypeScript, Node/headless, browser, Metro, and Hermes versions.
- [ ] **Runtime performance baseline.** Add repeatable benchmarks and CI budgets for dispatch throughput, broad and deep subscription graphs, 1k/10k active subscriptions, mount/unmount churn, memory retention, large derived collections under deep versus shallow equality, React render counts, AI-token-frequency updates, Hermes performance, and bundle size.
- [ ] **Internal agent eval baseline.** Run scripted Uklad tasks with MCP connected versus file-tools-only, scored on success rate, turns, tokens, wall time, and deterministic acceptance tests. Use this as the fitness function for DevTools work; do not publish cross-library claims yet.

## Phase 2 — Instance-scoped runtime (the quarter's architecture project, gates 1.0 RC)

The state and registries now live behind explicit runtime scopes
([state.ts](../../packages/core/src/runtime/state.ts),
[registry.ts](../../packages/core/src/runtime/registry.ts)). This enables
SSR/per-request stores, microfrontends, embedded widgets, parallel tests,
Storybook isolation, and multiple agent sandboxes side by side.

Target shape:

```ts
const runtime = createUkladRuntime<Contracts>({ initialState });

runtime.registerModule(feature);

<UkladProvider runtime={runtime}>
  <App />
</UkladProvider>;
```

- [x] **Runtime RFC first.** Define ownership and lifecycle for the state heads, event queue, handler registries, event metadata, global interceptors, subscription engine/cache, tracing, schedulers, built-ins, reset behavior, and DevTools inspector. Specify compatibility and migration constraints before moving code.
- [x] `createUkladRuntime` + `UkladProvider`; applications explicitly own their runtime and no package-global facade is created.
- [x] `@ukladjs/core/vanilla` and `/react` entrypoints.
- [x] Store-local typed contracts as an alternative to global module augmentation.
- [x] Public `watchSubscription` for non-React consumers (services, headless logic).
- [x] Scoped feature registration returning an idempotent disposer; safe lazy loading and HMR without clearing every handler.
- [x] Headless-friendly primitives finished on the instance API: safe state restore, non-React subscription evaluation/watching, and an explicit flush contract after restore/dispatch.
- [x] SSR/per-request stores, with request-isolation and hydration tests.
- [x] **Multi-runtime DevTools routing.** Add stable `runtimeId`/runtime names, multiple simultaneous runtime sessions per server, runtime selection in the dashboard and MCP tools, and per-runtime state, handlers, traces, dispatch, evaluation, and reconnect-session semantics. The former single-session server superseded the previous SDK client, so instance ownership alone would not have delivered parallel agent sandboxes. `sinceId` pagination remains in the Phase 3 MCP backlog.
- [ ] **Architecture acceptance gates.** Prove two independent runtimes in one realm, parallel-test isolation, SSR request isolation, module install/dispose, explicit-runtime package consumption, and no material regression against Phase 1 performance budgets.
  - Functional and package-consumption gates are automated and passing. The performance comparison remains blocked until the Phase 1 runtime budgets above exist.
- [ ] **Implementation-review follow-ups (2026-07-18, non-blocking).** Logged from the instance-runtime review; none gates the RC:
  - Document "unmount/unwatch consumers before `runtime.dispose()`" prominently. Watches created through `watchSubscription` (including every `useSubscription`) are runtime-owned, so dispose force-releases them and a still-mounted tree throws on its next render instead of failing the dispose. A dispose attempt that then fails on an externally activated graph has already torn down the runtime's own watches — retryable, but not side-effect-free.
  - `registerTraceCallback` silently drops the callback when tracing is not yet enabled (legacy ordering foot-gun). On the instance API, store the callback and deliver once tracing activates.
  - Per-id subscription-cache operations (`hasCachedSubscriptionForId`, clear-by-id, definition-clearable assert) are O(cache) scans. Add a `subId → keys` index if route-level module disposal becomes routine.
  - Keep runtime built-ins installed only during runtime construction; module evaluation must remain free of registrations.
- [ ] Publish `1.0.0-rc.1` with a migration guide and written stability/semver policy. Instance-scoping gates the release candidate, not final 1.0.

## Phase 3 — Instance-aware product proof

This phase begins once the instance API is stable enough that persistence, templates, examples, and public benchmarks will not be rewritten around a moving foundation.

- [x] **Synchronous persistence beta.** `@ukladjs/persist` provides
  instance-aware root persistence, versioned migrations, hydration barriers,
  transforms, redaction-safe errors, and module disposal for synchronous
  storage. Async storage, SSR integration, custom merge behavior, and multiple
  attachments per runtime remain open follow-up work.
- [ ] **`create-uklad-app` scaffolder.** Generate the canonical convention:
  `app/uklad/catalog.ts`, `contracts.ts`, `initial-state.ts`, `runtime.ts`,
  `bindings.ts`, feature modules, platform effect/coeffect registrations,
  dev-only inspector wiring, and the agent router files.
- [ ] **Official Expo reference app, built by agents using the Uklad toolkit.** Include Metro/Hermes CI, AsyncStorage + SecureStore adapters, hydration migrations, background transitions, reconnect handling, and an offline command outbox. Dogfood the workflow in a public demo showing an agent building and verifying the application with metrics on screen.
- [ ] **Public agent benchmark.** Compare the same tested tasks in Uklad, Zustand, and Redux Toolkit only after the internal harness is stable. Fix model and tool versions, publish prompts and source, use identical acceptance tests and time limits, run multiple repetitions, disclose failures and variance, and make the harness reproducible.
- [ ] **MCP backlog prioritized by harness data** (tracked in [docs/roadmaps/devtools.md](devtools.md)): `get_client_logs`, `find_state_changes(path)`, `sinceId` pagination with explicit cursor-reset responses, `uklad-map` static manifest + source locations through MCP, shape mode, snapshot/restore, `explain_event`, deterministic replay, and runtime schema validation for external tool payloads. Predicted winners remain hypotheses until measured.

## Phase 4 — Supervised async tasks (`@ukladjs/tasks`)

Effects return `void` and only synchronous exceptions are caught ([types.ts](../../packages/core/src/types.ts) `EffectHandler`, [built-in-effects.ts](../../packages/core/src/events/built-in-effects.ts)) — insufficient for LLM streams, tool calls, approvals, reconnects, and concurrent agents. Effects stay declarative data; tasks add supervision. Tasks are built after instance-scoping because each task tree belongs to a runtime instance.

Minimal core first:

- [ ] Task IDs with parent/child causality.
- [ ] `AbortSignal`, timeout, and cancellation.
- [ ] `started/succeeded/failed/cancelled` lifecycle traces, wired into DevTools/MCP from day one.
- [ ] A `latest` concurrency policy.

Then, driven by real demand: retry/backoff, deduplication, `leading`/`queue`/`parallel` policies, progress/stream events, and backpressure. A generic task runtime beats an AI-specific abstraction.

## Phase 5 — 1.0 readiness and release

Final 1.0 is a stability commitment, not a reward for completing one architecture project.

- [ ] Run the release candidate in real applications, including at least one web app and the Expo reference app, through a defined stability period.
- [ ] Publish migration guides from Uklad `0.x`, Redux Toolkit, and Zustand, including incremental coexistence and rollback strategies.
- [ ] Verify the security policy, compatibility matrix, release automation, provenance, deprecation policy, and runtime/DevTools/MCP protocol negotiation.
- [ ] Meet the documented runtime performance, memory, bundle-size, React render-count, Metro, and Hermes budgets.
- [ ] Confirm explicit runtime ownership and store-local contract APIs are stable and documented.
- [ ] Resolve release-candidate feedback, publish a complete changelog, and cut `1.0.0`.

## Ongoing — Distribution (~⅓ of effort from Phase 3 onward)

Code alone does not move adoption. Every phase above should produce a publishable artifact.

- [ ] Publish the reproducible cross-library agent benchmark and its methodology.
- [ ] Publish the agent-builds-an-app video with metrics on screen.
- [ ] Maintain "Uklad for Redux users" and "Uklad for Zustand users" migration-oriented documentation.
- [ ] Pursue prominent listings in the Claude Code / Codex plugin marketplaces.
- [ ] Reach the re-frame diaspora: a small community of senior engineers aligned with the architecture. "Re-frame for TypeScript, now with an agent loop" is a message they can amplify.

## Explicit non-goals

- **No RTK Query clone.** Officially document and test the TanStack Query pairing instead. Redux Toolkit's async/caching ecosystem is mature; Uklad should concentrate on deterministic workflows, local domain state, and observability.
- **No tiny-bundle competition with Zustand.** Uklad sells architecture, observability, and verifiability, not minimum bytes.
- **No undo/redo promise until history semantics are specified.** Patches make a prototype easy, but production history requires limits, transactions, effect policy, persistence interaction, sensitive-data handling, and migration semantics.
- **Entity/normalization helpers, per-call-site equality options, and further unmeasured MCP tools** remain backlog until the eval harness or real users demonstrate need.

---

The moat worth protecting is the semantic event log, memoized subscription dependency graph, effects/coeffects isolation, first-class tracing, and DevTools MCP. Deterministic replay becomes part of that moat only when its semantics are implemented and tested. Every phase above either proves the moat with data, removes a reason to reject it, or makes it cheaper to adopt.
