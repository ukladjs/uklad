# Roadmap: Reflex DevTools + MCP

DevTools-specific improvements for [Reflex DevTools](../packages/reflex-devtools). This backlog is scheduled through the phased [Reflex roadmap](../ROADMAP.md) (Phase 1 security baseline, Phase 3 eval harness and tool prioritization); coordinated library-side pairings from the [archived roadmap](reflex-old-roadmap.md) still apply.

The canonical agent scenario these tools serve is [agent-workflow.md](agent-workflow.md) — a worked task showing which tool answers which question at each loop stage. New tools should be justified against it (and it flags the currently-proposed ones: `explain_event`, `replay_events`).

---

## Reflex DevTools + MCP (tools)

### Instance-scoped routing

- [x] **Multiple simultaneous runtime sessions.** Runtime inspectors now carry
  stable IDs and names; the server retains independent storage and reconnect
  epochs per ID; the dashboard and every MCP tool select a runtime; state,
  subscriptions, handlers, traces, dispatch, and evaluation are routed without
  cross-runtime fallback. Omitting a runtime ID is accepted only when selection
  is unambiguous.

### P1

- [x] **Secure DevTools/MCP transport and capability baseline.**
  The server now defaults to `127.0.0.1`, generates separate runtime/UI/MCP
  role tokens with loopback-only bootstrap, authenticates HTTP and WebSocket
  clients, validates Host and exact browser origins (including localhost
  cross-origin access), and refuses non-loopback binding without explicit
  remote mode, exact allowlists, and configured credentials. `--mcp`
  is read-only; dispatch and the reserved restore capability require separate
  grants. Runtime/server redaction, bounded control and telemetry payloads,
  event-specific runtime bounds, mutation audit records, reconnect-safe session
  handling, and a fail-closed protocol-version handshake complete the Phase 1
  trust boundary. Remote use still requires TLS or an SSH tunnel.

- [ ] **`find_state_changes(path)` tool.**
  The server already stores Immer patches per trace (`server/storage.ts`); index them by path and answer "which events wrote `todos.3.done`, in order?" server-side, returning `[{event, timestamp, patch}]`. This is *the* debugging question — answering it in one cheap call instead of having an agent scan fat traces is the biggest context-efficiency win available in the stack.

- [ ] **`sinceId` cursor on `get_traces` + explicit cursor-reset responses.**
  The dispatch→verify loop needs "everything that happened after my action." Limit-from-the-end is ambiguous under concurrent activity. Cheap to add. (Dispatch-returns-outcome has shipped, so this is no longer the fallback verify mechanism — but it's still the right primitive for observing activity *not* initiated by the agent: user clicks, timers, subscriptions firing.)
  Design caveat, generalized: trace ids restart at 1 when a new Reflex runtime instance loads, and server storage clears on SDK reconnect, so a held cursor can outlive its id space — and during active agentic development (edit → reload → dispatch) reconnects are the *common* case, not the edge case. Successful runtime-scoped responses now carry `runtimeId`, `runtimeName`, and the selected DevTools connection's `sessionEpoch`; `get_trace` can reject an expected stale epoch. The remaining cursor work is to add `latestId`/`sinceId` to `get_traces`, return an explicit "session reset — cursor invalid" result on mismatch, and propagate identity consistently on error responses. A transient reconnect can change the epoch without restarting the application runtime, and an evicted bounded-registry entry starts a fresh epoch history if that ID later reconnects.

- [ ] **`get_client_logs` — runtime errors outside the event pipeline.**
  The outcome loop reports handler/effect errors, but a greenfield agent's most common failures live outside events: render crashes, uncaught exceptions, unhandled rejections, React warnings, reflex dev-mode warnings. Today those require a browser-automation MCP — token-heavy and flaky. Capture `console.error`/`console.warn`, `window.onerror`, and `unhandledrejection` in the SDK, ship them as a new message type into a server-side ring buffer, and expose `get_client_logs(sinceId)` with the same cursor/epoch semantics as traces. This makes reflex-devtools the *single* health check for the whole app — probably the highest-leverage missing tool for the "agents build new projects" goal. Stretch: attach logs observed during a dispatch's in-flight window to the `dispatch_event` response.

- [ ] **Expose the static manifest through MCP.** *(pairs with lib P1: static manifest generator — promoted lib-side so this item isn't blocked behind a P2)*
  Add `get_reflex_map`, `find_reflex_id(query)`, `get_event_contract(id)`, `get_sub_graph(id)`, and `get_handler_source_location(id)` tools backed by `.reflex/map.json` when present, with runtime `get_handlers` as the fallback. This makes the MCP server the agent's first stop for both "what exists?" and "what happened?".

- [ ] **Agent eval harness — the roadmap's fitness function.**
  Scripted agent tasks against the `devtools-playground` ("fix this handler bug", "add a derived sub + panel", "debug a wrong state path"), run headless (e.g. `claude -p` / Codex CLI) with the MCP connected vs. file-tools-only, scored on success rate, turns, and tokens. This is the only thing that turns "is this toolset efficient for agents?" from taste into data — run it before building the P2s and let the results reorder them. Pairs with lib "agent-facing examples and eval scenarios" (those fixtures are this harness's content — build them together).

### P2

- [ ] **Principal-scoped UI/MCP capabilities.**
  Replace the current server-wide dispatch/restore grants with explicit capability sets per authenticated role. The dashboard and MCP principal must be independently configurable, and status responses plus advertised MCP tools must reflect the caller's effective permissions.

- [ ] **Proxy-aware HTTP abuse controls and remote-deployment guidance.**
  Add bounded rate limiting for bootstrap, authentication failures, and control endpoints with `Retry-After` responses. Trust forwarded client addresses only behind explicit trusted-proxy configuration, and document reverse-proxy limits so remote mode does not rely on spoofable `X-Forwarded-For` values or accidentally expose loopback bootstrap.

- [ ] **Configurable storage-retention byte limits.**
  `TraceStorage`'s `maxAppStateBytes`, `maxActiveSubscriptionBytes`, and `maxTraceStorageBytes` (`server/storage.ts`) are fixed at their 8/8/16 MiB defaults because the server only threads `maxTraces` into the constructor. Surface them through `ServerConfig` and matching CLI flags (e.g. `--max-app-state-kib`), validated with the same `boundedInteger` bounds as the payload limits, so large-app-db and heavy-subscription inspection is possible without editing source. Consider whether the 8 MiB transport ceiling (`REFLEX_DEVTOOLS_MAX_RUNTIME_PAYLOAD_BYTES`) should rise in step, since a retained appDb cannot exceed what the transport admits.

- [ ] **Simplify truncation-boundary credential scrubbing.** *(post-beta; behavior-preserving)*
  `redaction.ts` carries five `INCOMPLETE_*` patterns whose only job is catching a credential sliced in half by the error-text length cap. The behavior is correct and covered by `redaction-security.test.mjs`, but the surface is disproportionate to the residual risk. Replace them with a single coarse rule — when the input was truncated, drop or redact the trailing partial line before the marker — and keep the existing tests green as the acceptance criterion. Deliberately not done before `0.2.0-beta`: rewriting tested credential masking to reduce line count is the wrong risk trade so close to a release.

- [ ] **Decide the audit surface: ship `get_audit` or drop the client method.**
  `DevToolsAPIClient.getAuditRecords()` exists with no caller — the server already exposes authenticated `GET /api/audit`, but no MCP tool reads it. Either expose a read-only `get_audit` tool (useful when an agent must show *what it changed*, and the natural companion to `dispatch_event`'s `auditRequestId`), or delete the dead method. Resolve as a product decision, not as dead-code cleanup.

- [ ] **Conventional CLI help/host flags.**
  Reserve `-h` for help and move the host shorthand to `-H` while preserving compatibility through a coordinated beta change or deprecation path. Keep `--host` and `--help` stable.

- [ ] **Typed protocol modules and instance-ready server boundaries.**
  Decode untrusted messages from `unknown` into shared discriminated unions, then extract protocol validation, authentication/origin policy, audit handling, HTTP routing, and WebSocket session handling from the server entrypoint. Keep this behavior-preserving and align the session/routing boundary with Phase 2 multi-runtime work.

- [ ] **Shape mode for `get_app_state`.**
  Add `depth` or `shape: true` returning keys + types + collection sizes — the runtime equivalent of reading `db.ts`, and the right first call on an unfamiliar large app. (`get_app_state` already takes a `path` for scoped reads; shape mode is the discovery step that tells the agent which paths are worth reading — the full dump is unusable on a real-sized db.)

- [ ] **State fixtures: `snapshot_state` / `restore_state` (and a dev-only `set_state`).**
  Testing "dispatch X when there are 50 todos and one is overdue" currently means dispatching a setup sequence or clicking through the UI. The server already maintains the authoritative state mirror (`server/storage.ts` applies patches); snapshotting is storing that value under an id. Restore pushes it back through a `restore-to-client` message, and the injected Reflex inspector performs the core-owned restore operation so DevTools never imports or registers against the runtime directly. The restore should still flow through a traced, subscription-safe core path. A generic `set_state(path, value)` micro-fixture rides the same mechanism. Dev-only, requires `--mcp`, and must additionally require the separate `--allow-restore` capability; it must never inherit dispatch permission implicitly. Pairs naturally with (but does not depend on) lib feature-parity P1 "undo/redo effect".

- [ ] **Source locations in `get_handlers`.** *(depends on lib P1: source capture)*
  Return file:line per handler id, so the agent goes from runtime observation to the exact source line with zero greps.
