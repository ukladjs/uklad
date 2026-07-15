# Roadmap: AI-Development Must-Haves

Prioritized improvements for [reflex](https://github.com/flexsurfer/reflex), ordered by impact. Devtools-specific work is tracked in devtools [ROADMAP.md](https://github.com/flexsurfer/reflex-devtools/blob/main/ROADMAP.md). Items marked **(pairs with …)** need coordinated changes across both repos.

Context: reflex's architecture (ID-indexed events/subs, pure handlers, effects isolation) already lets an AI agent work on a large app with minimal context — the `*-ids.ts` files act as an index, exact-match grep gives retrieval, and pure handlers bound verification to a single function. The items below close the remaining gaps: React-binding correctness, runtime performance at scale, compiler feedback, a closed observe→act→verify loop against the running app, and token-frugal runtime inspection.

---

## Agent indexing model

Reflex should be presented to AI agents as a small set of indexes and tools, not as a large prompt blob. There are three complementary indexes:

1. **Static source index** — what exists and where it is implemented: event/sub/effect ids, file:line, payload signatures, emitted effects, sub dependency graph, dispatch/useSubscription call sites, and touched db keys. This comes from `npx reflex-map` and should be available as both `APP_MAP.md` (human/LLM fallback) and `.reflex/map.json` (machine/MCP input).
2. **Runtime state/trace index** — what actually happened in the running app: current db shape, active subscription values, recent trace rows, single-trace details, and path-indexed writes (`find_state_changes(path)`). This lives in reflex-devtools storage and is exposed through MCP.
3. **Compile-time contract index** — what is legal to call: `EventPayloads`, `SubPayloads`, `EffectPayloads`, and `AppDb` module augmentation. This turns agent mistakes into `tsc` feedback instead of runtime surprises.

The intended agent retrieval order is: MCP static/runtime tools first (`get_reflex_map`, `get_handlers`, `get_app_state({ shape: true })`, `find_state_changes`, `dispatch_event`), then `APP_MAP.md`, then `*-ids.ts` + exact-match `rg`, and only then implementation files. Agents should not read `events.ts`/`subs.ts` end-to-end.

A full worked scenario — one task walked through the agent's loop (orient → write → launch → health → seed → act → verify → explain → reload → replay), with each tool touchpoint marked shipped/planned/proposed — lives in the devtools repo: [docs/agent-workflow.md](https://github.com/flexsurfer/reflex-devtools/blob/main/docs/agent-workflow.md).

## Reflex (lib)

### P1 — Dev-mode strictness & navigation

- [ ] **Capture registration source location in dev mode.** _(pairs with devtools P2: handler locations)_
      At `regEvent`/`regSub`/`regEffect` time, capture file:line (synthetic `Error().stack`, dev-only, zero prod cost) and store it in the handler-registry layer (`src/runtime/handlers.ts`). This is the last hop from runtime observation back to source code.

- [ ] **Fail loud on unregistered IDs in dev.**
      Dispatching a typo'd event or subscribing to a missing sub currently `console.error`s and continues. In dev mode, throw — and include a nearest-match suggestion ("did you mean `todos/add`?"). String IDs are only safe if mistakes surface immediately; this matters double for AI-generated code.

- [ ] **Static manifest generator.** _(promoted from P2 — devtools P1 "manifest through MCP" is blocked on it, and a P1 shouldn't depend on a P2)_
      A small CLI (`npx reflex-map`) that scans `regEvent`/`regSub`/`regEffect` registrations, id files, dispatch/useSubscription call sites, typed payload maps, and obvious db-key writes. Emit both `APP_MAP.md` and `.reflex/map.json`: id → kind → file:line → params/result → effects emitted → sub dependency graph → call sites → touched top-level db keys. Zero-drift documentation and the ideal first read for any agent session. The JSON output is also the input for devtools MCP `get_reflex_map`, `find_reflex_id`, `get_event_contract`, and `get_sub_graph`.

- [ ] **Verify and document the HMR story.**
      The agentic loop is edit → HMR/reload → dispatch → verify, so hot-reload behavior is part of the feedback loop's correctness. Pin down and document: what happens when a module re-runs `regEvent`/`regSub` on HMR (silent overwrite? stale closures over old module state?), whether the db survives HMR vs. full reload, and what the scaffolder's recommended vite setup should be (accept-and-re-register vs. force full reload for handler files). Full reload also resets trace ids and the db — surfaced devtools-side by the `sessionEpoch` item there. Add dev warnings where the current behavior is surprising; no MCP tool can fix a noisy edit loop.

- [ ] **Headless-friendly runtime primitives.** _(pairs with devtools P1: headless runtime support)_
      Support a browserless agent loop without making devtools depend on private internals. Provide the minimal dev-only primitives needed by the headless MCP runtime: safe app-db restore for snapshots/scenarios, subscription evaluation that does not require a mounted React component, optional non-React subscription watching for services/headless checks, and clear behavior around flush timing after restore/dispatch. Keep the production API small; these primitives should either be explicitly dev-only or exposed through a narrow testing/devtools surface. This pairs with the devtools headless entry, `eval_sub`, state fixtures/scenarios, and the agent eval harness.
      Partially delivered: `getSubscriptionValue` and devtools `eval_sub` cover one-shot headless evaluation, while `getSubscriptionDiagnostics()` provides cache-only inspection. Safe restore, public non-React watching, and an explicit restore/dispatch flush contract remain open.

### P2

- [x] **Fix the `regEvent` overload heuristic.**
      Added an explicit `{ coeffects, interceptors }` options form while preserving positional compatibility, and made an empty coeffect array with a fourth interceptor argument unambiguous.

- [x] **Document positioning and constraints.**
      The README now states the client-rendered React/React Native target, singleton and SSR/RSC limitations, asynchronous dispatch contract, serializable subscription parameters, and Immer draft-read cost.

---

## AI agent setup & distribution

### P0 — Project bootstrap

- [ ] **`create-reflex-app` scaffolder — make the convention exist in new projects.**
      `reflex-agent init` (below) retrofits agent config into an _existing_ project; nothing creates the project itself. The entire retrieval strategy — `*-ids.ts` as index, `APP_MAP.md`, exact-match grep, MCP-first — assumes a file convention that an agent freestyling `npm create vite` + reflex will not invent on its own. Ship a template (`npm create reflex-app`, or a flag on `reflex-agent init`) that pins it: `db.ts` / `events.ts` / `subs.ts` / `effects.ts` / `*-ids.ts`, typed payload-map augmentation stubs, `enableTracing()`/`enableDevtools()` wired dev-only, CLAUDE.md/AGENTS.md router files, MCP config, and a `reflex-map` script entry. For the "agents build new projects" goal this is the true P0: every other index/tool item only applies to projects shaped like this.

- [ ] **Add `npx reflex-agent init`.**
      A bootstrap CLI should detect the host project and create/update the small router files plus local config:
      `npx reflex-agent init --codex --claude --cursor --copilot`.
      It should optionally add `AGENTS.md`, `CLAUDE.md`, Reflex Agent Toolkit plugin references, `.codex/config.toml` MCP config, Claude/Cursor MCP config, and a script entry for `reflex-map`. Default behavior should be conservative: never overwrite existing guidance without showing a diff or writing a clearly marked Reflex section.

### P2 — Guardrails and drift checks

- [ ] **Optional hooks/checks for map drift.**
      Provide a lightweight check that runs `reflex-map --check` when `*-ids.ts`, `events.ts`, `subs.ts`, `effects.ts`, or typed payload maps change. In Codex this can be a plugin-bundled hook; elsewhere it can be an npm script or pre-commit hook. The goal is to keep `APP_MAP.md` and `.reflex/map.json` trustworthy without forcing heavy tooling.

- [ ] **Agent-facing examples and eval scenarios.**
      Add small fixtures showing the intended cycle: "change one event", "debug wrong state path", "add a derived subscription", "fix missing effect", and "work with Map/Set patches." Each fixture should show the cheap path through indexes/MCP and the fallback path when MCP is unavailable. The harness that _runs_ these as scored agent tasks (success rate / turns / tokens) is tracked as devtools P1 ("agent eval harness"); these fixtures are its content — build them together, and let the measurements reorder both roadmaps.

---

## Feature parity: what to adopt from Redux (RTK) and Zustand

Legend: ✅ has it · ⚠️ partial / community · ❌ missing.

| Feature                                                | Redux Toolkit                                           | Zustand                     | Reflex today                                              | Adopt?                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------- | --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Concurrent-safe React binding (`useSyncExternalStore`) | ✅ react-redux v8+                                      | ✅ built on it              | ✅ `useSyncExternalStore`                                 | **Done** — stale params, missed render→subscribe updates, and per-sub tearing fixed; cross-sub render consistency done too (subscriptions read the last flushed db generation) |
| Typed action/event payloads                            | ✅ `PayloadAction<T>`                                   | ✅ typed store API          | ✅ opt-in `EventPayloads`/`SubPayloads` maps              | **Done** — typed dispatch/regEvent/useSubscription via module augmentation                                                                                                     |
| Sync dispatch escape hatch                             | ✅ dispatch is sync                                     | ✅ `set` is sync            | ✅ `dispatchSync` (sync commit + sync subscription flush) | **Done** — re-frame parity; unblocks controlled inputs                                                                                                                         |
| Undo / time-travel                                     | ✅ DevTools time-travel                                 | ⚠️ community (zundo)        | ⚠️ patches + reversePatches already captured, unused      | **P1** — built-in undo/redo effect is nearly free and a headline feature                                                                                                       |
| Persistence + versioned migrations                     | ✅ redux-persist                                        | ✅ `persist` middleware     | ❌ hand-rolled storage effects                            | **P1** — official persist effect/interceptor with version migrations                                                                                                           |
| Dev-mode invariant checks                              | ✅ serializability/immutability middleware, typo errors | ⚠️                          | ⚠️ console warnings only, non-fatal                       | **P1** — fail-loud dev mode                                                                                                                                                    |
| Async data fetching & caching                          | ✅ RTK Query (dedup, invalidation, cache)               | ❌ pair with TanStack Query | ❌ hand-rolled effects                                    | **P1** standard `http` effect (retry/dedup); document TanStack Query pairing — a full RTK-Query-alike is not worth building yet                                                |
| Per-call-site selector equality                        | ✅ `useSelector(sel, equalityFn)`                       | ✅ `shallow` / custom       | ⚠️ per-sub config only (`shallowEqual` now exported)      | **P2** — options arg on `useSubscription`                                                                                                                                      |
| Non-React (vanilla) subscriptions                      | ✅ `store.subscribe`                                    | ✅ vanilla store            | ❌ no public watch API                                    | **P2** — export a public `watchSubscription` for non-React consumers (services, headless logic)                                                                                |
| Entity/normalization helpers                           | ✅ `createEntityAdapter`                                | ❌                          | ❌                                                        | **P2** — small helper package for id-keyed CRUD in `draftDb`                                                                                                                   |
| SSR / per-request stores                               | ✅                                                      | ✅                          | ❌ module-level singletons                                | **Decide** — either explicit non-goal (SPA/RN focus, document it) or a long-term instance-scoped rework                                                                        |
| Code-split / lazy registration                         | ✅ `injectSlice`                                        | ⚠️ manual                   | ✅ side-effect imports are naturally lazy                 | — already good                                                                                                                                                                 |

Worth remembering the reverse direction too: the semantic event log, memoized subscription dependency graph, effects/coeffects isolation, first-class tracing, and the devtools MCP have no equivalent in either library — that's the moat these adoptions protect.

---
