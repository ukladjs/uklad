# Roadmap

> **Positioning:** Reflex is the deterministic application runtime for agentic React and React Native apps — observable and verifiable by humans and agents.

The runtime core is credible: concurrent-safe React bindings, a memoized subscription DAG, effects-as-data, tracing, a headless runtime, and an MCP verification loop. The bottleneck is productization, proof, and distribution — not additional state-management surface area. What's missing is everything that lets an architecture or security team say yes, and evidence that the AI-agent advantage is real rather than claimed.

Two clocks govern prioritization:

1. **The evidence clock.** There is no widely cited public benchmark for agent productivity with a state-management framework. Being first with reproducible numbers is worth more than being feature-complete.
2. **The breakage window.** At current adoption, breaking architectural changes are the cheapest they will ever be. Anything breaking must land before 1.0 — and 1.0 must wait for it.

When items compete, pick the one that feeds the proof or exploits the breakage window.

Detailed trackers this document links into:

- [docs/devtools-roadmap.md](docs/devtools-roadmap.md) — DevTools + MCP tool backlog (still authoritative for that package).
- [docs/reflex-old-roadmap.md](docs/reflex-old-roadmap.md) — previous roadmap; its **agent indexing model** and **Redux/Zustand feature-parity table** remain valid reference material.
- [docs/agent-workflow.md](docs/agent-workflow.md) — the canonical agent scenario new tools are justified against.

---

## Phase 0 — Release integrity (days, do first)

The strongest recent work is invisible: local `main` is ahead of the public repository, the website documents the old DevTools API, and the flagship example contains a literal bug. Nothing else pays off until the public artifact matches reality.

- [ ] Synchronize website, root/package READMEs, API reference, and examples with the current API (`createReflexInspector`, current DevTools setup).
- [ ] Fix the swapped Best Practices / API Reference links in [packages/reflex/README.md](packages/reflex/README.md) (lines 131–132).
- [ ] Include `docs/` in the npm tarball or make README links absolute — [package.json `files`](packages/reflex/package.json) currently excludes it while the README links `./docs/subscription-runtime.md`.
- [ ] Remove the leftover `'event2'` string from the TodoMVC save handler ([examples/todomvc/src/events.ts](examples/todomvc/src/events.ts), `SAVE` event) and enable Strict Mode in [examples/todomvc/src/main.tsx](examples/todomvc/src/main.tsx).
- [x] Pin MCP package versions in the shipped agent templates.
- [ ] Prepare coordinated `0.2.0-beta` versions and release notes across the published packages.
- [ ] Run the full workspace check and packed-package dry runs.
- [ ] Push the synchronized repository and publish `0.2.0-beta`.

## Phase 1 — Trust and measurement baseline (~1 month, parallelizable)

These items do not win an evaluation by themselves, but each removes a common reason for an architecture or security team to reject the framework before evaluating its differentiators.

- [x] **DevTools/MCP security baseline.** The server now uses generated role tokens for HTTP and WebSocket, exact browser-origin and Host checks, loopback-only binding by default, read-only MCP capabilities unless dispatch/restore are granted separately, bounded and schema-validated runtime/control data, application/server redaction hooks, mutation audit records, reconnect-safe runtime sessions, and a fail-closed runtime/DevTools/MCP protocol-version handshake. Principal-scoped capability policy and remote-deployment abuse controls remain explicitly tracked in the [DevTools roadmap](docs/devtools-roadmap.md#p2).
- [ ] **Fail-loud dev mode.** Dispatching a typo'd event or subscribing to a missing sub currently `console.error`s and continues. In development, throw with a nearest-match suggestion ("did you mean `todos/add`?"). String IDs are only safe if mistakes surface immediately; this matters double for AI-generated code.
- [ ] **Release and support baseline.** Add `SECURITY.md`, `CHANGELOG.md`, a support/compatibility matrix, coordinated release automation, npm provenance/trusted publishing, and a documented deprecation policy. Define supported React, React Native, TypeScript, Node/headless, browser, Metro, and Hermes versions.
- [ ] **Runtime performance baseline.** Add repeatable benchmarks and CI budgets for dispatch throughput, broad and deep subscription graphs, 1k/10k active subscriptions, mount/unmount churn, memory retention, large derived collections under deep versus shallow equality, React render counts, AI-token-frequency updates, Hermes performance, and bundle size.
- [ ] **Internal agent eval baseline.** Run scripted Reflex tasks with MCP connected versus file-tools-only, scored on success rate, turns, tokens, wall time, and deterministic acceptance tests. Use this as the fitness function for DevTools work; do not publish cross-library claims yet.

## Phase 2 — Instance-scoped runtime (the quarter's architecture project, gates 1.0 RC)

The database and registries are module-level globals ([app-db.ts](packages/reflex/src/runtime/app-db.ts), [handlers.ts](packages/reflex/src/runtime/handlers.ts)). That blocks or complicates SSR/per-request stores, microfrontends, embedded widgets, parallel tests, Storybook isolation — and, most on-thesis, multiple agent sandboxes running side by side. This is the last acceptable breaking change; every month of adoption makes it more expensive.

Target shape:

```ts
const runtime = createReflexRuntime<Contracts>({ initialDb });

runtime.registerModule(feature);

<ReflexProvider runtime={runtime}>
  <App />
</ReflexProvider>;
```

- [ ] **Runtime RFC first.** Define ownership and lifecycle for the db heads, event queue, handler registries, event metadata, global interceptors, subscription engine/cache, tracing, schedulers, built-ins, reset behavior, and DevTools inspector. Specify compatibility and migration constraints before moving code.
- [ ] `createReflexRuntime` + `ReflexProvider`; today's global API preserved as a compatibility facade over a default runtime so existing apps, templates, skills, and `llms.txt` keep working.
- [ ] `@flexsurfer/reflex/vanilla` and `/react` entrypoints.
- [ ] Store-local typed contracts as an alternative to global module augmentation.
- [ ] Public `watchSubscription` for non-React consumers (services, headless logic).
- [ ] Scoped feature registration returning an idempotent disposer; safe lazy loading and HMR without clearing every handler.
- [ ] Headless-friendly primitives finished on the instance API: safe app-db restore, non-React subscription evaluation/watching, and an explicit flush contract after restore/dispatch.
- [ ] SSR/per-request stores, with request-isolation and hydration tests.
- [ ] **Multi-runtime DevTools routing.** Add stable `runtimeId`/runtime names, multiple simultaneous runtime sessions per server, runtime selection in the dashboard and MCP tools, and runtime-scoped state, handlers, traces, dispatch, evaluation, cursors, and reconnect semantics. The current single-session server supersedes the previous SDK client, so instance-scoping alone does not deliver parallel agent sandboxes.
- [ ] **Architecture acceptance gates.** Prove two independent runtimes in one realm, parallel-test isolation, SSR request isolation, module install/dispose, compatibility-facade behavior, packed-package compatibility, and no material regression against Phase 1 performance budgets.
- [ ] Publish `1.0.0-rc.1` with a migration guide and written stability/semver policy. Instance-scoping gates the release candidate, not final 1.0.

## Phase 3 — Instance-aware product proof

This phase begins once the instance API is stable enough that persistence, templates, examples, and public benchmarks will not be rewritten around a moving foundation.

- [ ] **Persistence + versioned migrations.** Ship an instance-aware persistence API with version migrations, partial persistence, hydration state/barriers, custom merge behavior, and async storage adapters for localStorage, AsyncStorage, and SecureStore. Define SSR skip/defer behavior, per-runtime storage, restore publication semantics, redaction, and module disposal.
- [ ] **`create-reflex-app` scaffolder.** Pin the intended convention: `db.ts` / `events.ts` / `subs.ts` / `effects.ts` / `*-ids.ts`, store-local or typed payload contracts, dev-only inspector wiring, CLAUDE.md/AGENTS.md routers, pinned MCP config, and a `reflex-map` script entry.
- [ ] **Official Expo reference app, built by agents using the Reflex toolkit.** Include Metro/Hermes CI, AsyncStorage + SecureStore adapters, hydration migrations, background transitions, reconnect handling, and an offline command outbox. Dogfood the workflow in a public demo showing an agent building and verifying the application with metrics on screen.
- [ ] **Public agent benchmark.** Compare the same tested tasks in Reflex, Zustand, and Redux Toolkit only after the internal harness is stable. Fix model and tool versions, publish prompts and source, use identical acceptance tests and time limits, run multiple repetitions, disclose failures and variance, and make the harness reproducible.
- [ ] **MCP backlog prioritized by harness data** (tracked in [docs/devtools-roadmap.md](docs/devtools-roadmap.md)): `get_client_logs`, `find_state_changes(path)`, `sinceId`/`sessionEpoch` cursors, `reflex-map` static manifest + source locations through MCP, shape mode, snapshot/restore, `explain_event`, deterministic replay, and runtime schema validation for external tool payloads. Predicted winners remain hypotheses until measured.

## Phase 4 — Supervised async tasks (`@flexsurfer/reflex-tasks`)

Effects return `void` and only synchronous exceptions are caught ([types.ts](packages/reflex/src/types.ts) `EffectHandler`, [effects.ts](packages/reflex/src/events/effects.ts)) — insufficient for LLM streams, tool calls, approvals, reconnects, and concurrent agents. Effects stay declarative data; tasks add supervision. Tasks are built after instance-scoping because each task tree belongs to a runtime instance.

Minimal core first:

- [ ] Task IDs with parent/child causality.
- [ ] `AbortSignal`, timeout, and cancellation.
- [ ] `started/succeeded/failed/cancelled` lifecycle traces, wired into DevTools/MCP from day one.
- [ ] A `latest` concurrency policy.

Then, driven by real demand: retry/backoff, deduplication, `leading`/`queue`/`parallel` policies, progress/stream events, and backpressure. A generic task runtime beats an AI-specific abstraction.

## Phase 5 — 1.0 readiness and release

Final 1.0 is a stability commitment, not a reward for completing one architecture project.

- [ ] Run the release candidate in real applications, including at least one web app and the Expo reference app, through a defined stability period.
- [ ] Publish migration guides from Reflex `0.x`, Redux Toolkit, and Zustand, including incremental coexistence and rollback strategies.
- [ ] Verify the security policy, compatibility matrix, release automation, provenance, deprecation policy, and runtime/DevTools/MCP protocol negotiation.
- [ ] Meet the documented runtime performance, memory, bundle-size, React render-count, Metro, and Hermes budgets.
- [ ] Confirm the default-runtime compatibility facade and store-local contract APIs are stable and documented.
- [ ] Resolve release-candidate feedback, publish a complete changelog, and cut `1.0.0`.

## Ongoing — Distribution (~⅓ of effort from Phase 3 onward)

Code alone does not move adoption. Every phase above should produce a publishable artifact.

- [ ] Publish the reproducible cross-library agent benchmark and its methodology.
- [ ] Publish the agent-builds-an-app video with metrics on screen.
- [ ] Maintain "Reflex for Redux users" and "Reflex for Zustand users" migration-oriented documentation.
- [ ] Pursue prominent listings in the Claude Code / Codex plugin marketplaces.
- [ ] Reach the re-frame diaspora: a small community of senior engineers aligned with the architecture. "Re-frame for TypeScript, now with an agent loop" is a message they can amplify.

## Explicit non-goals

- **No RTK Query clone.** Officially document and test the TanStack Query pairing instead. Redux Toolkit's async/caching ecosystem is mature; Reflex should concentrate on deterministic workflows, local domain state, and observability.
- **No tiny-bundle competition with Zustand.** Reflex sells architecture, observability, and verifiability, not minimum bytes.
- **No undo/redo promise until history semantics are specified.** Patches make a prototype easy, but production history requires limits, transactions, effect policy, persistence interaction, sensitive-data handling, and migration semantics.
- **Entity/normalization helpers, per-call-site equality options, and further unmeasured MCP tools** remain backlog until the eval harness or real users demonstrate need.

---

The moat worth protecting is the semantic event log, memoized subscription dependency graph, effects/coeffects isolation, first-class tracing, and DevTools MCP. Deterministic replay becomes part of that moat only when its semantics are implemented and tested. Every phase above either proves the moat with data, removes a reason to reject it, or makes it cheaper to adopt.
