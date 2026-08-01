# Headless state fixtures for agent loops

This document specifies the missing acceleration layer for headless Reflex development: an AI agent should be able to reproduce a bug from a known state after every edit/reload without re-running a long setup sequence by hand.

It complements [agent-workflow.md](workflow.md). That document describes the whole task loop; this one focuses on the hot-reload/restart problem inside the headless runtime.

---

## Problem

In an agentic loop, code changes are frequent:

1. the agent creates a state that reproduces a bug;
2. the agent dispatches the event that fails;
3. the agent edits an event, subscription, effect, or state shape;
4. the headless runtime reloads or restarts;
5. the in-memory app state is back to its default state;
6. the agent must rebuild the repro state before it can test again.

For simple examples this is a few dispatches. For real bugs it can be dozens of setup events, external fixtures, route changes, persisted values, or timers. Repeating that setup after every reload becomes the iteration tax.

The target workflow is:

```text
prepare state once
snapshot it
edit code
headless reconnects
restore snapshot
dispatch the event under test
verify patches/effects/subs/traces
```

The important distinction: the snapshot is usually taken **before** the event under test, not after it. The agent wants a fast reset point for repeated attempts.

---

## Goals

1. **Fast reload recovery.** After a headless restart, the agent can restore a known state state in one call.
2. **Reproducible bug loops.** A bug can be represented as `state before action + event under test + expected observations`.
3. **Bounded tool responses.** The agent should not dump full state just to know whether a fixture was restored.
4. **Explicit staleness.** If a snapshot may not match the current state contract, the tool says so instead of restoring silently.
5. **Replay when semantics matter.** Snapshots optimize iteration; event replay remains available when the setup must be re-derived through new handlers.

---

## Non-goals

- This is not production persistence.
- This is not user-facing undo/redo.
- This is not a replacement for unit tests.
- This is not a promise that UI wiring is correct; browser smoke tests still cover React components and DOM output.
- This should not require a mounted React component. It must work in a headless state runtime.

---

## Core model

The devtools server owns fixture state outside the SDK session.

```text
agent/MCP
  -> devtools server
       stores snapshots, event logs, scenarios
       survives SDK reconnects
  -> headless app process
       imports the application runtime, feature modules, and the selected
       platform effect/coeffect registrations
       enables tracing/devtools
       receives dispatch/restore/eval messages
```

Current trace storage is session-scoped and is cleared on SDK reconnect. Fixture storage must be separate from that. It only needs to survive headless reloads at first; optional disk persistence can come later.

---

## Side-effect policy

Headless mode must not import the same browser adapters blindly. The shared application logic is:

```text
state
events
subs
ids
typed payload maps
```

The runtime-specific layer is:

```text
effects
coeffects
environment adapters
```

A scaffolded project should make that split explicit (✅ the convention ships in [`examples/devtools-playground`](../../examples/devtools-playground) — `src/headless.ts` under `pnpm dev:playground:headless`):

```text
src/
  state.ts
  event-ids.ts
  events.ts
  sub-ids.ts
  subs.ts
  effect-ids.ts
  coeffect-ids.ts

  effects.browser.ts
  effects.headless.ts
  coeffects.browser.ts
  coeffects.headless.ts

  main.tsx
  headless.ts
```

Browser entry:

```ts
import './state';
import './events';
import './subs';
import './effects.browser';
import './coeffects.browser';
```

Headless entry:

```ts
import './state';
import './events';
import './subs';
import './effects.headless';
import './coeffects.headless';
```

The event handler still emits the same effect contract:

```ts
return [[EFFECT_IDS.LOCAL_STORAGE_SET, { key, value }]];
```

The browser adapter writes to real `localStorage`; the headless adapter writes to a memory store, a fixture store, or no-ops depending on the effect type.

### Headless effect modes

#### No-op

Use for effects where the agent usually only needs to observe that the effect was emitted:

```ts
regEffect(EFFECT_IDS.ANALYTICS_TRACK, () => {
  // no-op in headless
});
```

Typical examples: analytics, focus, scroll, notification banners, clipboard, and fire-and-forget UI affordances.

#### In-memory adapter

Use for browser state that participates in the application's behavior:

```ts
const memoryStorage = new Map<string, string>();

regEffect(EFFECT_IDS.LOCAL_STORAGE_SET, ({ key, value }) => {
  memoryStorage.set(key, JSON.stringify(value));
});

regCoeffect(COEFFECT_IDS.LOCAL_STORAGE_VALUE, (key) => memoryStorage.get(key) ?? null);
```

Typical examples: local storage, session storage, routing state, feature flags, and other local environment reads.

#### Deterministic adapter

Use for values that must be repeatable across scenario runs:

```ts
regCoeffect(COEFFECT_IDS.CLOCK_NOW, () => headlessClock.now());
```

Typical examples: clocks, random numbers, generated ids, and timers. The scenario runner should be able to set clock/random seeds.

#### Fixture-backed network

Do not make real network calls by default in headless agent mode. Register HTTP effects against fixtures:

```ts
regEffect(EFFECT_IDS.HTTP_REQUEST, (req) => {
  const response = httpFixtures.match(req);
  dispatch([req.onSuccess, response]);
});
```

Recommended network modes:

```text
stub        -> no-op or deterministic response
record      -> real call once, save fixture
replay      -> use saved fixture
passthrough -> real external IO, explicit opt-in only
```

The default for AI work should be `stub` or `replay`, not `passthrough`.

### Safety rules

Headless agent mode should be safe by default:

- no real browser APIs;
- no real analytics;
- no real navigation;
- no real external network unless explicitly enabled;
- no hidden writes outside fixture storage;
- every effect id has either a browser adapter or a headless adapter;
- browser-only effects are never registered from `headless.ts`.

`dispatch_event` still verifies the effect contract even when the adapter is stubbed:

```json
{
  "stateChanges": [{ "op": "replace", "path": ["selectedCategory"], "value": "food" }],
  "effectsEmitted": [["local-storage-set", { "key": "expenses.category", "value": "food" }]],
  "effectErrors": []
}
```

So the agent can prove "the handler emitted the right effect" without touching the real external world.

### Runtime visibility

✅ _Shipped:_ `app_status` reports the active runtime and effect modes, exactly as the app's entry declared them to `enableDevtools`:

```text
app_status {}
-> {
    runtime: "headless",
    effectMode: "safe",
    effects: {
      "local-storage-set": "memory",
      "http-request": "fixture",
      "analytics-track": "noop"
    }
  }
```

This tells the agent which effects are actually executed, which are fixture-backed, and which are only observed.

---

## Tool set

### `snapshot_state`

Capture the current app state under a generated id and optional name.

```text
snapshot_state { name: "category-filter-before-action" }
-> {
    snapshotId: "snap_01J...",
    name: "category-filter-before-action",
    sessionEpoch: 7,
    stateVersion: 3,
    appMapHash: "a13f...",
    stateShape: { expenses: "array[3]", selectedCategory: "string" }
  }
```

The response should include shape/metadata, not the full state.

### `restore_state`

Restore a captured state snapshot into the currently connected app.

```text
restore_state { name: "category-filter-before-action" }
-> {
    restored: true,
    snapshotId: "snap_01J...",
    sessionEpoch: 8,
    warnings: []
  }
```

Restore should flow through a traced operation owned by the injected Reflex
inspector so subscriptions are flushed and traces remain coherent:

```text
inspector.restoreState(snapshotState)
```

Reflex may implement that operation with an internal event, but DevTools only
calls the injected adapter and never imports or registers against the runtime.

### `list_snapshots`

List stored snapshots without returning full values.

```text
list_snapshots {}
-> {
    snapshots: [
      {
        id: "snap_01J...",
        name: "category-filter-before-action",
        createdAt: "2026-07-06T10:15:00.000Z",
        stateVersion: 3,
        appMapHash: "a13f...",
        stateShape: { expenses: "array[3]", selectedCategory: "string" }
      }
    ]
  }
```

### `delete_snapshot`

Remove stale or no-longer-needed fixtures.

```text
delete_snapshot { name: "category-filter-before-action" }
-> { deleted: true }
```

### `replay_events`

Replay a recorded setup sequence through the current code.

```text
replay_events { recordingId: "rec_category_filter_setup" }
-> {
    replayed: 4,
    outcomes: ["succeeded", "succeeded", "succeeded", "succeeded"],
    sessionEpoch: 8
  }
```

Replay is slower than snapshot restore, but safer after state-shape or handler changes because it re-derives state through the edited code.

### `save_scenario`

Persist a named bug reproduction.

```text
save_scenario {
  name: "category-filter-total-does-not-update",
  setupSnapshot: "category-filter-before-action",
  eventUnderTest: ["expenses/set-category", "food"],
  evalSubs: [
    ["expenses/category-total", "food"],
    ["expenses/visible"]
  ]
}
```

A scenario is an agent-friendly wrapper around a snapshot or event recording plus the event and read-side checks that matter.

### `run_scenario`

Restore setup, dispatch the event under test, and optionally evaluate subscriptions.

```text
run_scenario { name: "category-filter-total-does-not-update" }
-> {
    restored: true,
    event: {
      outcome: "succeeded",
      traceId: 12,
      patches: [{ op: "replace", path: ["selectedCategory"], value: "food" }],
      effects: [["local-storage-set", { key: "expenses.category", value: "food" }]]
    },
    subscriptions: {
      "[\"expenses/category-total\",\"food\"]": 42.5,
      "[\"expenses/visible\"]": [{ "...": "elided" }]
    },
    sessionEpoch: 8
  }
```

This is the fastest inner loop after a fix attempt: one tool call restores the precondition, executes the action, and verifies the derived layer.

---

## Snapshot vs replay

Use snapshots when:

- the setup state is expensive to reach;
- the code edit is localized to the event/sub/effect under test;
- the state shape is unchanged or has a compatible migration;
- the agent is iterating rapidly on one bug.

Use replay when:

- the state shape changed;
- setup event handlers changed;
- coeffects/effects involved in setup changed;
- the agent wants to verify that the user journey still constructs the same state.

The tools should make this explicit:

```text
restore_state
-> warning: snapshot appMapHash differs from current appMapHash; replay setup events or provide a migration
```

Snapshot is the fast path. Replay is the semantic path.

---

## Staleness metadata

Every snapshot should store enough metadata to detect risk:

```json
{
  "id": "snap_01J...",
  "name": "category-filter-before-action",
  "createdAt": "2026-07-06T10:15:00.000Z",
  "sessionEpoch": 7,
  "stateVersion": 3,
  "appMapHash": "a13f...",
  "schemaHash": "d9cc...",
  "stateShape": {
    "expenses": "array[3]",
    "selectedCategory": "string"
  },
  "source": {
    "kind": "manual" | "recording" | "scenario",
    "traceId": 21
  }
}
```

Recommended fields:

- `stateVersion`: app-provided version, usually from `state.meta.stateVersion` or a configured getter.
- `appMapHash`: hash of `.reflex/map.json` when available.
- `schemaHash`: hash of top-level keys and coarse value types.
- `stateShape`: bounded summary for agent visibility.

If metadata is missing, restore may still proceed, but the response must say the compatibility check was incomplete.

---

## Restore protocol

The server should not mutate its mirrored app state and pretend the app changed. The app must receive the restore request.

Protocol sketch:

```text
MCP restore_state
  -> HTTP POST /api/snapshots/:id/restore
  -> server sends WebSocket message to SDK:
       { type: "restore-state-to-client", payload: { restoreId, state } }
  -> SDK calls the injected Reflex inspector:
       inspector.restoreState(state)
  -> app replaces state and flushes subscriptions
  -> SDK sends restore result:
       { type: "reflex-restore-result", payload: { restoreId, trace } }
  -> server resolves MCP call
```

The restore response should include:

- outcome: restored / failed / unknown;
- trace id for the internal restore event;
- session epoch;
- staleness warnings;
- state shape after restore.

---

## Internal restore event

The Reflex library should provide a dev-only primitive for replacing app state safely. The current public API does not expose `updateState` directly, and that is good; restore should remain a devtools/testing capability.

Options:

1. **The injected Reflex inspector exposes a traced restore operation.**

   ```ts
   inspector.restoreState(nextState);
   ```

   Reflex owns the internal event or publication-safe primitive; DevTools only
   forwards the protocol message to the injected inspector.

2. **Reflex exports a dev-only helper used by the inspector.**

   ```ts
   restoreStateForDevtools(nextState);
   ```

   The inspector calls it after DevTools forwards the restore message.

The first option keeps the runtime boundary explicit and restore visible in the event trace. The second option is simpler internally but should not make the DevTools package import Reflex again. Prefer the traced inspector operation unless implementation cost proves too high.

---

## Headless hot-reload loop

Expected agent loop:

```text
app_status
dispatch setup events
snapshot_state { name: "bug-before-action" }
dispatch_event event/under-test
eval_sub affected/sub

edit code
headless reloads
app_status -> sessionEpoch changed
restore_state { name: "bug-before-action" }
dispatch_event event/under-test
eval_sub affected/sub
```

Fast scenario loop:

```text
run_scenario { name: "bug-repro" }
edit
reload
run_scenario { name: "bug-repro" }
edit
reload
run_scenario { name: "bug-repro" }
```

This avoids both manual reseeding and broad state reads.

---

## Interaction with `eval_sub`

Headless mode has no mounted React components, so `get_active_subs` is usually not enough. Scenario checks should use `eval_sub`:

```text
restore_state { name: "bug-before-action" }
dispatch_event { eventName: "expenses/set-category", params: ["food"] }
eval_sub { id: "expenses/category-total", params: ["food"] }
```

`run_scenario` can bundle those subscription evaluations as a convenience, but `eval_sub` remains the primitive.

---

## Interaction with client logs

Restore and scenario execution should attach client logs observed during the operation window:

```json
{
  "event": { "outcome": "succeeded" },
  "clientLogs": {
    "warnings": 0,
    "errors": 1,
    "sinceId": 144
  }
}
```

If a restore succeeds but a subscription computation throws afterward, the scenario result should be `effects-failed` or `checks-failed`, not a green result.

---

## Storage

Phase 1 can be in-memory server storage:

- survives SDK reconnects;
- disappears when the devtools server stops;
- simple enough for the first agent loop.

Phase 2 can add optional disk persistence:

```text
.reflex/devtools-fixtures.json
```

Disk persistence should be opt-in or project-local. Do not silently write large app states into source control paths without clear configuration.

---

## Safety

State snapshots may contain user data, tokens, or local test secrets. Guardrails:

- dev-only and MCP-gated, like dispatch;
- never expose on public networks;
- bounded list responses;
- explicit delete tool;
- optional redaction hook before storing snapshots;
- optional max snapshot size;
- snapshots stored outside git by default when persisted.

---

## Implementation phases

### P0: Fast checkpoint loop

- Add server-side fixture storage separate from trace storage.
- Add `snapshot_state`, `list_snapshots`, `delete_snapshot`.
- Add SDK restore protocol.
- Add `restore_state`.
- Include `sessionEpoch` and staleness warnings in every response. _(identity/epoch now ride successful runtime-scoped responses and `get_trace` accepts an expected epoch; consistent error-response propagation and cursor-reset warnings remain open)_
- ~~Scaffold `effects.headless.ts` and `coeffects.headless.ts` with safe defaults for common browser APIs.~~ ✅ shipped (reference scaffold in `examples/devtools-playground`)
- ~~Make `app_status` report `runtime`, `effectMode`, and registered effect adapter modes.~~ ✅ shipped

### P1: Scenario runner

- Record agent-dispatched events separately from session trace storage.
- Add `replay_events`.
- Add `save_scenario` and `run_scenario`.
- Allow scenario checks to include `eval_sub`.
- Add fixture-backed network modes: `stub`, `record`, `replay`, and explicit `passthrough`.

### P2: Durability and migrations

- Optional disk persistence.
- Snapshot redaction hooks.
- App-provided state version/migration hooks.
- `appMapHash` and schema compatibility checks.
- App-provided redaction and adapter-policy hooks for sensitive side-effect payloads.

---

## Design rule

Do not make the agent rebuild complex state after every edit.

For hot reload and headless restart, the default recovery path should be:

```text
detect epoch change
restore named pre-action snapshot
dispatch event under test
evaluate affected subscriptions
return one bounded result
```

That is the difference between a usable autonomous debugging loop and a loop that spends most of its time reconstructing setup.
