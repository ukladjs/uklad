# Roadmap

> **Positioning:** Reflex is the deterministic application runtime for agentic React and React Native apps — observable, replayable, and verifiable by humans and agents.

This roadmap merges two independent reviews (July 2026) that converged on the same diagnosis: **the bottleneck is productization, proof, and distribution — not features.** The runtime is credible (full workspace builds clean, 405 tests pass, concurrent-safe React binding, subscription DAG, effects-as-data, tracing, headless runtime, MCP verification loop). What's missing is everything that lets an architecture or security team say yes, and evidence that the AI-agent advantage is real rather than claimed.

Two clocks govern prioritization:

1. **The evidence clock.** Nobody has published agent-productivity data for a state library. Being first with real numbers is worth more than being feature-complete.
2. **The breakage window.** At current adoption, breaking architectural changes are the cheapest they will ever be. Anything breaking must land before 1.0 — and 1.0 must wait for it.

When items compete, pick the one that feeds the proof or exploits the breakage window.

Detailed trackers this document links into:

- [docs/devtools-roadmap.md](docs/devtools-roadmap.md) — DevTools + MCP tool backlog (still authoritative for that package).
- [docs/reflex-old-roadmap.md](docs/reflex-old-roadmap.md) — previous roadmap; its **agent indexing model** and **Redux/Zustand feature-parity table** remain valid reference material.
- [docs/agent-workflow.md](docs/agent-workflow.md) — the canonical agent scenario new tools are justified against.

---

## Phase 0 — Ship and synchronize (days, do first)

The strongest recent work is invisible: local `main` is 9 commits ahead of the public repository, the website documents the old DevTools API, and the flagship example contains a literal bug. Nothing else pays off until the public artifact matches reality.

- [ ] Push `main` to the public repository.
- [ ] Publish a coherent `0.2.0-beta` across packages.
- [ ] Synchronize website, README, API reference, and examples with the current API (`createReflexInspector`, current DevTools setup).
- [ ] Fix the swapped Best Practices / API Reference links in [packages/reflex/README.md](packages/reflex/README.md) (lines 131–132).
- [ ] Include `docs/` in the npm tarball or make README links absolute — [package.json `files`](packages/reflex/package.json) currently excludes it while the README links `./docs/subscription-runtime.md`.
- [ ] Remove the leftover `'event2'` string from the TodoMVC save handler ([examples/todomvc/src/events.ts](examples/todomvc/src/events.ts), `SAVE` event) and enable Strict Mode in [examples/todomvc/src/main.tsx](examples/todomvc/src/main.tsx).
- [ ] Pin MCP package versions in the shipped agent templates.

## Phase 1 — Remove enterprise disqualifiers (~1 month, parallelizable)

None of these win an evaluation, but each one loses evaluations in the first ten minutes — or triggers an instant security-team veto.

- [ ] **DevTools/MCP security baseline.** The server currently enables unrestricted CORS, accepts 50 MB payloads, and exposes unauthenticated state mutation through `/api/dispatch` ([server/index.ts](packages/reflex-devtools/src/server/index.ts)). Open CORS plus a localhost mutation endpoint is a DNS-rebinding attack surface. Ship: generated session tokens for HTTP and WebSocket, origin allowlist, read-only mode by default, separate inspect/dispatch/restore capabilities, much smaller payload limits, state/trace redaction hooks for secrets and PII, audit records for agent-triggered actions, and a runtime/DevTools/MCP protocol-version handshake.
- [ ] **Persistence + versioned migrations.** Official persist effect/interceptor with version migrations and async storage adapters (localStorage, AsyncStorage, SecureStore). Every React Native app needs this on day one; Zustand's `persist` middleware is a top-3 reason RN teams pick it.
- [ ] **Fail-loud dev mode.** Dispatching a typo'd event or subscribing to a missing sub currently `console.error`s and continues. In dev, throw — with a nearest-match suggestion ("did you mean `todos/add`?"). String IDs are only safe if mistakes surface immediately; this matters double for AI-generated code.
- [ ] **Undo/redo effect.** Patches and reverse patches are already captured and unused. Nearly free, and a headline feature Zustand only has via community packages.

## Phase 2 — Instance-scoped runtime (the quarter's architecture project, gates 1.0)

The database and registries are module-level globals ([app-db.ts](packages/reflex/src/runtime/app-db.ts), [handlers.ts](packages/reflex/src/runtime/handlers.ts)). That blocks or complicates SSR/per-request stores, microfrontends, embedded widgets, parallel tests, Storybook isolation — and, most on-thesis, **multiple agent sandboxes running side by side**. This is the last acceptable breaking change; every month of adoption makes it more expensive. Ship it before 1.0, and cut 1.0 when it lands.

Target shape:

```ts
const runtime = createReflexRuntime<Contracts>({ initialDb });

runtime.registerModule(feature);

<ReflexProvider runtime={runtime}>
  <App />
</ReflexProvider>;
```

- [ ] `createReflexRuntime` + `ReflexProvider`; today's global API preserved as a compatibility facade over a default runtime (existing apps, templates, skills, and `llms.txt` keep working unchanged).
- [ ] `@flexsurfer/reflex/vanilla` and `/react` entrypoints.
- [ ] Store-local typed contracts as an alternative to global module augmentation.
- [ ] Public `watchSubscription` for non-React consumers (services, headless logic).
- [ ] Scoped feature registration returning an idempotent disposer; safe lazy loading and HMR without clearing every handler (absorbs the old roadmap's "verify and document the HMR story").
- [ ] Headless-friendly primitives finished on the instance API: safe app-db restore, non-React subscription evaluation/watching, explicit flush contract after restore/dispatch (pairs with devtools snapshot/restore).
- [ ] SSR/per-request stores: promoted from "Decide" to committed, delivered by this design.
- [ ] **Cut `1.0.0`** with a written stability/semver policy once this ships.

## Phase 3 — Prove and publish (overlaps Phase 2; different skillset)

Agents choosing the stack for greenfield projects are the adoption wedge: humans pick libraries by popularity, agents pick by what their skills recommend and what they can verify at runtime. This phase builds the funnel and the evidence, and **the evidence gets published, not filed.**

- [ ] **`create-reflex-app` scaffolder.** The entire retrieval strategy (`*-ids.ts` as index, typed payload maps, `APP_MAP.md`, MCP-first) assumes a file convention agents won't invent freestyling `npm create vite`. Template pins it: `db.ts` / `events.ts` / `subs.ts` / `effects.ts` / `*-ids.ts`, typed payload-map stubs, dev-only inspector wiring, CLAUDE.md/AGENTS.md routers, MCP config, `reflex-map` script entry.
- [ ] **Official Expo reference app, built by agents using the Reflex toolkit.** Metro/Hermes CI, AsyncStorage + SecureStore adapters (from Phase 1 persistence), hydration migrations, background transitions, reconnect handling, offline command outbox. Dogfooding is the demo video: an agent building a real RN app, verifying every change at runtime, with metrics on screen.
- [ ] **Agent eval harness — the roadmap's fitness function and its marketing asset.** Scripted tasks ("fix this handler bug", "add a derived sub + panel", "debug a wrong state path") run headless (`claude -p`, Codex CLI), scored on success rate, turns, tokens, wall time. Two comparisons: **MCP-connected vs file-tools-only** (internal fitness function) and **the same app in Reflex vs Zustand vs Redux Toolkit** (the public benchmark post — the headline that travels).
- [ ] **MCP tool backlog, prioritized by harness data** (tracked in [docs/devtools-roadmap.md](docs/devtools-roadmap.md)): `get_client_logs`, `find_state_changes(path)`, `sinceId`/`sessionEpoch` cursors, `reflex-map` static manifest + source locations through MCP, shape mode, snapshot/restore, `explain_event`, deterministic replay, runtime schema validation for external tool payloads. Predicted winners: `get_client_logs` and `find_state_changes` — but let the measurements reorder the list.

## Phase 4 — Supervised async tasks (`@flexsurfer/reflex-tasks`, after Phase 2)

Effects return `void` and only synchronous exceptions are caught ([types.ts](packages/reflex/src/types.ts) `EffectHandler`, [effects.ts](packages/reflex/src/events/effects.ts)) — insufficient for LLM streams, tool calls, approvals, reconnects, and concurrent agents. Effects stay declarative data; tasks add supervision. Built **after** instance-scoping because tasks belong to a runtime instance — building it on globals means building it twice.

Minimal core first:

- [ ] Task IDs with parent/child causality.
- [ ] `AbortSignal`, timeout, cancellation.
- [ ] `started/succeeded/failed/cancelled` lifecycle traces, wired into DevTools/MCP from day one — this extends the observability moat to async work.
- [ ] A `latest` concurrency policy.

Then, driven by real demand: retry/backoff, deduplication, `leading`/`queue`/`parallel` policies, progress/stream events, backpressure. A generic task runtime beats an AI-specific abstraction.

## Ongoing — Distribution (~⅓ of effort from Phase 3 onward)

Code alone doesn't move download numbers. Every phase above produces a publishable artifact; publish it.

- [ ] The cross-library agent benchmark post (Phase 3's headline result).
- [ ] The agent-builds-an-app video with metrics on screen (Expo reference app).
- [ ] "Reflex for Redux users" / "Reflex for Zustand users" migration-oriented docs pages — every evaluator asks; answer on our terms.
- [ ] Prominent listings in the Claude Code / Codex plugin marketplaces.
- [ ] The re-frame diaspora: small community, senior engineers, exactly the target companies — "re-frame for TypeScript, now with an agent loop" is a message they'll amplify.

## Explicit non-goals

- **No RTK Query clone.** Officially document and test the TanStack Query pairing instead. Redux Toolkit's async/caching ecosystem is a decade ahead; don't fight it.
- **No tiny-bundle competition with Zustand.** Reflex sells architecture, observability, and verifiability, not bytes.
- **Entity/normalization helpers, per-call-site equality options, further P2 MCP tools** — backlog until the eval harness or real users demonstrate need.

---

The moat worth protecting: the semantic event log, memoized subscription dependency graph, effects/coeffects isolation, first-class tracing, and the DevTools MCP have no equivalent in Redux or Zustand. Every phase above either proves that moat with data, removes a reason to reject it, or makes it cheaper to adopt.
