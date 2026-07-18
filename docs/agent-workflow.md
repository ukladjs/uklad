# How an AI agent works on a Reflex task

This is the canonical scenario both roadmaps serve: one realistic task, walked through the agent's eyes, showing exactly which tool answers which question at each moment. It exists so that API decisions are made against a real workflow instead of tool-by-tool intuition — a proposed tool that doesn't shorten a step in this document probably shouldn't be built, and a step that today costs several calls or a browser is where the next tool belongs. The eval harness scenarios and the `reflex` agent skill should both be derived from it.

Status legend used throughout:

- ✅ **today** — ships in the current MCP
- 🚧 **roadmap** — an accepted item in the [DevTools roadmap](devtools-roadmap.md) or the [Reflex roadmap](../ROADMAP.md)
- ✳️ **proposed** — identified by this scenario; this document is its spec

Tool responses shown are abbreviated.

---

## The task

> *"In the expense-tracker app, add category filtering: a category picker, the expense list filtered by the selected category, and a running total for it. Persist the selection."*

A mid-size task on purpose: it touches the db shape, two events, two subscriptions, an effect, and two components — and it contains a bug class that only runtime observation can catch.

The app follows the scaffolded convention: `src/db.ts`, `src/event-ids.ts`, `src/events.ts`, `src/sub-ids.ts`, `src/subs.ts`, `src/effects.ts`, `src/components/`.

---

## Phase 0 — Orient: what exists?

The agent's first question is never "what is the state?" — the app isn't even running. It's *"what ids, handlers, and db keys already exist, and where?"*

- **Today:** read `*-ids.ts` (they are the index), exact-match `rg` for the few ids that matter. Cheap and reliable — but text-based, and says nothing about payload shapes or the sub dependency graph.
- 🚧 **Roadmap:** `get_reflex_map` / `find_reflex_id` / `get_event_contract` backed by `.reflex/map.json` (lib: static manifest generator). No running app required; replaces every orientation grep with indexed lookups.

What the agent must *not* need to do: read `events.ts` / `subs.ts` end-to-end. On a real app those files are the most expensive read in the repo.

---

## Phase 1 — Write the code (the compiler is the loop)

The agent writes, in order: the db key (`selectedCategory: null`), event ids, handlers (`expenses/set-category`, extend `expenses/add` with a category), sub ids and subs (`expenses/visible`, `expenses/category-total`), the persistence effect wiring, and the two components.

**No MCP is used in this phase, and that is by design.** The verification signal here is `tsc` against the typed payload maps (`EventPayloads` / `SubPayloads` / `AppDb`): a wrong payload, a typo'd id in `dispatch`, a mis-shaped sub result — all become compile errors, the cheapest feedback there is. Roughly 70% of the agent's total effort on this task happens in this phase, which is why the scaffolder, the typed maps, and the static manifest matter more to overall context cost than any runtime tool.

The MCP earns its keep in everything that follows.

---

## Cycle 1 — Cold start: launch → health → seed → act → verify

### 1. Launch the app

```
Bash: node node_modules/@flexsurfer/reflex-devtools/dist/cli.js --mcp --allow-dispatch --host 127.0.0.1 --port 4000
                                      # devtools server with MCP, no npx/package manager
Bash: tsx watch src/headless.ts      # the app, headless — no browser needed
      (pnpm dev                      #  …or the vite dev server + a browser tab,
                                     #  for the human-supervised variant)
```

The first wall used to be here: **the SDK runs inside the app, and the app historically ran in a browser tab** an autonomous agent doesn't have.

- ✅ **Today: headless and parallel runtimes.** Reflex's state layer is React-free, so the scaffolded `src/headless.ts` installs the same db/events/subscriptions as `main.tsx` on an explicit runtime and calls `enableDevtools(runtime.createInspector())` — run via `tsx`/`vite-node` with a watcher (`pnpm dev:playground:headless` in this repo) — a live, dispatchable, fully traceable app with no browser. Views are excluded, which is acceptable: the state layer is where Reflex's guarantees live, and view-file correctness is covered by tsc plus the browser smoke check below. Side effects are safe by default through the adapter split (`effects.headless.ts` / `coeffects.headless.ts` install the same effect ids against memory-backed or no-op adapters; policy in [headless-state-fixtures.md](headless-state-fixtures.md)), and the declared adapter modes surface in `app_status`. Browser, headless, widget, and agent-sandbox runtimes can remain connected together under stable IDs. A reconnect supersedes only the older socket with the same `runtimeId`, preventing duplicate execution without disconnecting other sandboxes.

### 2. "Is it alive?"

The first MCP call of *every* cycle — after cold start and after every reload — is a health question: did the app mount, is the SDK connected, did anything crash?

- ✅ **Today: `app_status`** — one small, bounded health and discovery call. With one runtime (or an explicit `runtimeId`) it returns that runtime's status; with zero or multiple connected runtimes it returns a structured `RUNTIME_SELECTION_REQUIRED` result containing the known runtime list instead of guessing.

```
app_status {}
→ { appConnected: true, runtimeId: "expenses-headless", sessionEpoch: 3,
    selectedRuntimeId: "expenses-headless", runtimes: [{ runtimeId: "expenses-headless", connected: true }],
    runtime: "headless", effectMode: "safe",
    effects: { "local-storage-set": "memory", "set-document-title": "noop" },
    tracing: true, handlers: { event: 17, fx: 3, cofx: 1, sub: 8 },
    stateAvailable: true, traceCount: 0 }
```

  The most-called tool in the set: select a runtime from `runtimes`, pass its `runtimeId` to later tools when more than one is connected, and treat a changed `sessionEpoch` for that ID as the DevTools-session reset signal feeding the reload loop below. `runtime`/`effects` tell the agent which world (and which side-effect policy) it is driving.
- 🚧 **Roadmap: `get_client_logs(sinceId)`** — will add a `clientErrors.unread` counter to this response: render crashes, uncaught exceptions, React and reflex dev-mode warnings, without a browser. After a cold start with a white screen, this is the *only* tool that explains why.

### 3. Read the initial state

```
get_app_state { path: "selectedCategory" }   ✅
→ { path: "selectedCategory", state: null }
```

Path-scoped reads only. On an unfamiliar or large app the discovery step comes first: 🚧 `get_app_state { shape: true }` → keys, types, collection sizes — the runtime equivalent of reading `db.ts`. The full dump is the anti-pattern.

### 4. Seed test state

```
dispatch_event { eventName: "expenses/add", params: [{ title: "Coffee",  amount: 4.5,  category: "food" }] }   ✅
dispatch_event { eventName: "expenses/add", params: [{ title: "Bus",     amount: 2.0,  category: "transport" }] }
dispatch_event { eventName: "expenses/add", params: [{ title: "Groceries", amount: 38.0, category: "food" }] }
```

Each response already confirms the write (see next step), so seeding needs no follow-up reads. Note for later: this seed sequence will have to be repeated after every reload — Cycle 2 shows why that should become one call.

### 5. Act

```
dispatch_event { eventName: "expenses/set-category", params: ["food"] }   ✅
→ { outcome: "succeeded", duration: "0.6ms", traceId: 21,
    stateChanges: [{ op: "replace", path: ["selectedCategory"], value: "food" }],
    effectsEmitted: [["local-storage-set", { key: "expenses.category", value: "food" }]] }
```

**This response is the verification.** Three questions answered in one round trip, zero re-reads:

- the db write happened and is exactly the intended patch;
- the persistence effect fired with the right payload — the *effect contract* is observed, not assumed;
- failure modes are explicit: `outcome: "failed"` + normalized error for a throwing/missing handler, `"effects-failed"` when state committed but an effect threw, `"unknown"` when unobserved.

This tool is the center of gravity of the whole API; everything else exists to set it up or explain its aftermath.

### 6. Verify the derived layer

The db is right — but does `expenses/category-total` compute `42.5`? Evaluate the registered sub directly against current state, mounted or not:

```
eval_sub { id: "expenses/category-total", args: ["food"] }   ✅
→ { value: 42.5 }
```

With this, the state layer of the feature is **fully verified before a single component exists** — write subs, prove them, then write views against proven data.

---

## The bug

The picker works, the list filters, but the *total* doesn't change when the category changes — it updates only when an expense is added. Classic reflex bug class:

```ts
// subs.ts — the dependency on the selected category is missing
regSub(SUB_IDS.CATEGORY_TOTAL,
  (expenses, selected) => sum(expenses, selected),
  () => [[SUB_IDS.EXPENSES]]);            // ← forgot SUB_IDS.SELECTED_CATEGORY
```

Note what makes this valuable as *the* canonical bug: the handler is pure and correct (unit tests pass), the dispatch response is perfect (state committed exactly as intended), tsc is silent. **The defect exists only in the runtime dependency graph** — precisely the thing an agent cannot see from source and patches alone.

---

## Cycle 2 — Debug → edit → hot reload → re-verify

### 7. Explain the event

The agent's question, verbatim: *"I dispatched `expenses/set-category`, state changed — why didn't the total update?"* The debugging chain is always the same three hops: **db written? → subs recomputed? → components re-rendered?**

- **Today** ⚠️: hop 1 is in the dispatch response; hops 2–3 mean paging `get_traces { opType: "sub/run" }` and `{ opType: "render" }` and correlating timestamps by hand — several calls, fat rows, and reflex-internals knowledge required.
- ✳️ **Proposed: `explain_event(traceId)`** — the causality chain as one bounded response:

```
explain_event { traceId: 21 }
→ { event: ["expenses/set-category", "food"],
    wrote: ["selectedCategory"],
    subsRecomputed: [
      { id: "selected-category",       changed: true  },
      { id: "expenses/visible",        changed: true  }
    ],
    componentsRerendered: ["CategoryPicker", "ExpenseList"] }
```

When causality is exact, `expenses/category-total` being **absent from `subsRecomputed`** makes the missing graph edge visible in one call. The agent now greps exactly one `regSub` (🚧 source locations make even that grep a lookup) and sees the missing dep.

Important constraint: absence is only a strong signal if the tool knows the affected sub was active or explicitly evaluated. Otherwise absence can also mean "not mounted" or "not observed". `explain_event` should therefore include a causality quality:

```
explain_event { traceId: 21 }
→ { ..., confidence: "exact" }
```

or, for a server-side time-window reconstruction:

```
→ { ..., confidence: "heuristic" }
```

*Feasibility:* the lib already links traces (`childOf`), and render traces carry the component name plus the notifying subscription key. The flush is async, so event→flush linkage needs either a server-side time-window correlation (workable but heuristic) or a lib-side stamp of triggering event ids on flush traces (exact; pairs-with lib item). The exact version is the one agents should rely on for automated diagnosis.

### 8. The history variant

If the symptom had been a *wrong value* rather than a missing update — "who set `selectedCategory` to garbage?" — the tool is 🚧 `find_state_changes { path: "selectedCategory" }` → `[{event, timestamp, patch}]`, one call instead of a trace scan. Same three-hop chain, pointed backwards.

### 9. Edit + hot reload: the session reset

The agent fixes the dep array and vite reloads the app. Consequences, all invisible today:

- the db resets to initial state — the seeded expenses are gone;
- trace ids restart at 1; server storage cleared on the SDK reconnect;
- any held cursor or remembered `traceId` now silently points at nothing.

- ✅ **Today:** every successful runtime-scoped tool response carries `runtimeId`, `runtimeName`, and `sessionEpoch`. The epoch identifies a DevTools connection session: an app reload changes it, but so can a transient SDK reconnect that leaves the runtime database intact. Server trace storage and remembered IDs belong to that `(runtimeId, sessionEpoch)` pair, and `get_trace` can reject a stale expected epoch explicitly. 🚧 **Roadmap:** `get_traces(sinceId)` will make an epoch change an explicit cursor-reset result rather than requiring the caller to compare its saved epoch.
- 🚧 **Lib roadmap: verify/document the HMR story** — whether handler re-registration on HMR is sound determines whether a *full* reload is even necessary per edit.

### 10. Re-seed or restore in one call

Re-dispatching the whole seed sequence after every edit is the iteration tax. Today, trace storage is cleared on SDK reconnect, so replay cannot depend on current session storage. The server needs a separate epoch-spanning agent dispatch log, distinct from trace storage, if it is going to replay setup from a previous headless session:

- ✳️ **Proposed: `replay_events`** — re-dispatch the recorded event sequence (filtered to the agent's own dispatches, or an explicit id list) through the **new** code:

```
replay_events { fromSessionEpoch: 3 }
→ { replayed: 4, outcomes: ["succeeded","succeeded","succeeded","succeeded"], sessionEpoch: 4 }
```

  Replay deliberately beats state snapshots when setup semantics may have changed: a snapshot could restore stale state *shapes*, while replay re-derives state through the edited handlers — it is simultaneously the fixture **and** the regression check.

For tight bug loops, the faster path is snapshot/restore of the pre-action state:

```
restore_state { name: "category-filter-before-action" }
→ { restored: true, sessionEpoch: 4 }
```

That is the orthogonal case: composing states that are tedious to reach through events. The fuller design lives in [headless-state-fixtures.md](headless-state-fixtures.md): snapshots for speed, replay for semantic re-derivation, and named scenarios for one-call restore → dispatch → `eval_sub`.

### 11. Re-verify the state layer

```
dispatch_event { eventName: "expenses/set-category", params: ["transport"] }   ✅
eval_sub { id: "expenses/category-total", args: ["transport"] }                ✅  → { value: 2.0 }
explain_event { traceId: 7 }                                                   ✳️  → subsRecomputed now includes expenses/category-total
```

The state layer is fixed, and *proven* fixed at the event/subscription causality level. The agent finishes with plain unit tests for the pure handlers (no MCP — pure functions need no runtime).

### 12. Smoke-check UI wiring

One browser/DOM smoke check still matters: it proves the picker component dispatches the intended event, and the list/total components subscribe to the intended derived values.

```
Browser: select "transport"
Assert: visible list shows Bus
Assert: category total shows 2.0
```

This is intentionally a narrow wiring check, not the main state-debugging loop. Browser automation is for "is the UI connected and rendered?", while `dispatch_event` + `eval_sub` + `explain_event` are for "is the state system correct?"

---

## What the agent never does

Anti-patterns the API must keep unnecessary — if any of these becomes the practical path, the design has regressed:

1. **Dump full app state** — path/shape-scoped reads only; every response bounded, oversized values elided with a pointer to the scoped call.
2. **Page through traces to answer a causal question** — `dispatch_event`'s response, `explain_event`, and `find_state_changes` exist precisely so trace browsing is forensics (chiefly for human-driven activity: "what did the user click"), not the front door.
3. **Re-read state to confirm its own dispatch** — the dispatch response *is* the confirmation.
4. **Drive a browser to verify state-layer behavior** — browser automation is for genuinely visual questions and the final UI wiring smoke check only.
5. **Read `events.ts`/`subs.ts` end-to-end** — orientation goes through ids files / the static map; source is read per-handler, by location.
6. **Poll** — outcomes return synchronously; activity the agent didn't initiate is fetched by cursor (`sinceId`), not by re-listing.

---

## The toolbox, by loop stage

| Stage | Question | Tool | Status |
|---|---|---|---|
| Orient | what exists, where? | `*-ids.ts` + rg → `get_reflex_map` / `get_event_contract` | ✅ / 🚧 |
| Write | is the code legal? | `tsc` + typed payload maps | ✅ (lib) |
| Launch | run the app without a browser | headless runtime entry (`src/headless.ts`) | ✅ |
| Health | did it mount? errors? session? | `app_status` · `get_client_logs` | ✅ · 🚧 |
| Inspect | what is the state? | `get_app_state(path)` · `shape: true` | ✅ · 🚧 |
| Seed | put the app in a known state | `dispatch_event` · `replay_events` · snapshots | ✅ · ✳️ · 🚧 |
| Act & verify | did it do what I meant? | `dispatch_event` outcome/patches/effects | ✅ |
| Verify derived | does the sub compute right? | `eval_sub` | ✅ |
| Explain | why did/didn't X update? | `explain_event` · `find_state_changes` | ✳️ · 🚧 |
| UI wiring | is the component connected? | narrow browser/DOM smoke check | ✅ (browser automation) |
| Forensics | what happened while I wasn't acting? | `get_traces(sinceId)` → `get_trace(id)` | ✅ (🚧 cursor) |
| Registry truth | is my handler actually registered? | `get_handlers` | ✅ |

## Design principles this scenario fixes

1. **The dispatch response is the verification.** One round trip must answer wrote-what, emitted-what, failed-how.
2. **Every response is bounded.** The agent can always afford another scoped call; it can never un-spend a dumped context window.
3. **The canonical questions get one-call answers.** "Why didn't the view update", "who wrote this path", "what does this sub return" are *the* questions; each deserves a dedicated bounded tool, not a derivation over raw traces.
4. **Reload is the common case.** DevTools session identity (`sessionEpoch`) in successful runtime-scoped responses; state re-establishment (`replay_events`) as one call.
5. **The MCP starts where the compiler stops.** Phase 0–1 belongs to the scaffold, typed maps, and static manifest; runtime tools should not compensate for missing static structure.
6. **Static before runtime, runtime before source.** Ids/map → MCP observation → the one implicated handler, by location. Never the reverse.
7. **State layer before UI.** Prove events/effects/subscriptions in headless MCP first; use the browser only to smoke-check final component wiring.

## Gaps, ranked by leverage in this scenario

*(Shipped from this list: **headless runtime + `app_status`** and **`eval_sub`** — the browser-tab assumption is gone, every cycle opens with one cheap health call, and the derived layer can be proved before a view exists.)*

1. **`get_client_logs`** — render crashes, uncaught exceptions, and framework warnings without opening browser automation just to read the console; also adds the `clientErrors.unread` counter to `app_status`. (small)
2. **`explain_event` with exact causality** — turns the canonical three-hop debug from a multi-call trace reconstruction into one bounded answer, but only after event→flush linkage is exact or the response clearly marks heuristic confidence. (medium; lib pairing required)
3. **`replay_events` + state fixtures/scenarios** — removes the per-edit iteration tax. Replay re-derives setup through new handlers; snapshots restore expensive pre-action states; named scenarios bundle restore → dispatch → `eval_sub`. (medium; see [headless-state-fixtures.md](headless-state-fixtures.md))
