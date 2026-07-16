# Roadmap: Reflex DevTools + MCP

DevTools-specific improvements for [Reflex DevTools](../packages/reflex-devtools). Coordinated library-side work remains tracked in the [Reflex roadmap](../ROADMAP.md) with **(pairs with …)** notes.

The canonical agent scenario these tools serve is [agent-workflow.md](agent-workflow.md) — a worked task showing which tool answers which question at each loop stage. New tools should be justified against it (and it flags the currently-proposed ones: `explain_event`, `replay_events`).

---

## Reflex DevTools + MCP (tools)

### P1

- [ ] **`find_state_changes(path)` tool.**
  The server already stores Immer patches per trace (`server/storage.ts`); index them by path and answer "which events wrote `todos.3.done`, in order?" server-side, returning `[{event, timestamp, patch}]`. This is *the* debugging question — answering it in one cheap call instead of having an agent scan fat traces is the biggest context-efficiency win available in the stack.

- [ ] **`sinceId` cursor on `get_traces` + a `sessionEpoch` in every response.**
  The dispatch→verify loop needs "everything that happened after my action." Limit-from-the-end is ambiguous under concurrent activity. Cheap to add. (Dispatch-returns-outcome has shipped, so this is no longer the fallback verify mechanism — but it's still the right primitive for observing activity *not* initiated by the agent: user clicks, timers, subscriptions firing.)
  Design caveat, generalized: trace ids restart at 1 when a new Reflex runtime instance loads, and server storage clears on SDK reconnect, so a held cursor can outlive its id space — and during active agentic development (edit → reload → dispatch) restarts are the *common* case, not the edge case. So don't special-case `get_traces`: the server keeps a monotonic `sessionEpoch` (bumped on SDK reconnect / storage clear) and includes it in **every** API response, so any tool call tells the agent "the app restarted since you last looked". `get_traces` responses carry `latestId`, and an epoch change is reported as an explicit "session reset — cursor invalid" instead of a silently empty list that reads as "nothing happened".

- [ ] **`get_client_logs` — runtime errors outside the event pipeline.**
  The outcome loop reports handler/effect errors, but a greenfield agent's most common failures live outside events: render crashes, uncaught exceptions, unhandled rejections, React warnings, reflex dev-mode warnings. Today those require a browser-automation MCP — token-heavy and flaky. Capture `console.error`/`console.warn`, `window.onerror`, and `unhandledrejection` in the SDK, ship them as a new message type into a server-side ring buffer, and expose `get_client_logs(sinceId)` with the same cursor/epoch semantics as traces. This makes reflex-devtools the *single* health check for the whole app — probably the highest-leverage missing tool for the "agents build new projects" goal. Stretch: attach logs observed during a dispatch's in-flight window to the `dispatch_event` response.

- [ ] **Expose the static manifest through MCP.** *(pairs with lib P1: static manifest generator — promoted lib-side so this item isn't blocked behind a P2)*
  Add `get_reflex_map`, `find_reflex_id(query)`, `get_event_contract(id)`, `get_sub_graph(id)`, and `get_handler_source_location(id)` tools backed by `.reflex/map.json` when present, with runtime `get_handlers` as the fallback. This makes the MCP server the agent's first stop for both "what exists?" and "what happened?".

- [ ] **Agent eval harness — the roadmap's fitness function.**
  Scripted agent tasks against the `devtools-playground` ("fix this handler bug", "add a derived sub + panel", "debug a wrong state path"), run headless (e.g. `claude -p` / Codex CLI) with the MCP connected vs. file-tools-only, scored on success rate, turns, and tokens. This is the only thing that turns "is this toolset efficient for agents?" from taste into data — run it before building the P2s and let the results reorder them. Pairs with lib "agent-facing examples and eval scenarios" (those fixtures are this harness's content — build them together).

### P2

- [ ] **Shape mode for `get_app_state`.**
  Add `depth` or `shape: true` returning keys + types + collection sizes — the runtime equivalent of reading `db.ts`, and the right first call on an unfamiliar large app. (`get_app_state` already takes a `path` for scoped reads; shape mode is the discovery step that tells the agent which paths are worth reading — the full dump is unusable on a real-sized db.)

- [ ] **State fixtures: `snapshot_state` / `restore_state` (and a dev-only `set_state`).**
  Testing "dispatch X when there are 50 todos and one is overdue" currently means dispatching a setup sequence or clicking through the UI. The server already maintains the authoritative state mirror (`server/storage.ts` applies patches); snapshotting is storing that value under an id. Restore pushes it back through a `restore-to-client` message, and the injected Reflex inspector performs the core-owned restore operation so DevTools never imports or registers against the runtime directly. The restore should still flow through a traced, subscription-safe core path. A generic `set_state(path, value)` micro-fixture rides the same mechanism. Dev-only and gated behind `--mcp` like dispatch. Pairs naturally with (but does not depend on) lib feature-parity P1 "undo/redo effect".

- [ ] **Source locations in `get_handlers`.** *(depends on lib P1: source capture)*
  Return file:line per handler id, so the agent goes from runtime observation to the exact source line with zero greps.
