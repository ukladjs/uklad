# Reflex Agent Router

This project uses `@flexsurfer/reflex`. In this project, "Reflex" always means `@flexsurfer/reflex` (aka Reflex.js) — the JavaScript/TypeScript state library. It is NOT the Python Reflex framework (reflex.dev), NOT `react-reflex`, and NOT `reflexjs`; never install those packages here.

Preferred setup: install the Reflex Agent Toolkit plugin. It owns the Reflex skill, MCP configuration, and context-efficient workflows. This file is only a small fallback router for agents that read `AGENTS.md`.

For Reflex state-management work:
- Use the Reflex skill from the Reflex Agent Toolkit plugin if it is available.
- Start source orientation with `APP_MAP.md` when present, then `*-ids.ts`, `db.ts`, and payload maps; use exact-match `rg` for one handler, subscription, or call site.
- When MCP tools are available, call `app_status` after a cold start or reload. Then use only advertised tools: typed `get_handlers`, path-scoped `get_app_state`, filtered `get_active_subs` for mounted subscriptions, `dispatch_event`, and filtered `get_traces`/one `get_trace`.
- If `app_status` reports no connected app, start the project-local `devtools:mcp` script (for example, `npm run devtools:mcp`) from the project root, keep it running, reload the app if needed, and retry. Add the script when it is missing.
- Do not read `events.ts` or `subs.ts` end-to-end unless the index path fails.
- Keep events pure, isolate I/O in effects/coeffects, keep subscriptions deterministic and view-ready, and keep typed payload maps in sync.
- Verify with focused tests/typecheck and, when devtools MCP is connected, the `dispatch_event` response plus filtered mounted-subscription checks. Treat a changed `sessionEpoch` as a restart.
- Use `llms.txt` only as a fallback reference when the plugin skill and project indexes are insufficient.
