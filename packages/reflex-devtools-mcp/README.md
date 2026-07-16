# 🤖 Reflex DevTools MCP Server

**The bridge that lets AI agents observe and drive a running Reflex app**

This package is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects AI agents — Claude Code, Codex, Cursor, Claude Desktop — to a running Reflex application through the [Reflex DevTools](https://github.com/flexsurfer/reflex/tree/main/packages/reflex-devtools) server. Agents inspect state and traces, dispatch events, and verify outcomes from the response instead of re-reading source files.

**Note:** Trace storage lives in the DevTools server (started with `--mcp`). This MCP server is a stateless API client — install it once, globally, and it works across every project.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![NPM Version](https://img.shields.io/npm/v/%40flexsurfer%2Freflex-devtools-mcp)](https://www.npmjs.com/package/@flexsurfer/reflex-devtools-mcp)

---

## ✨ How it fits together

```
┌─────────────────┐    WebSocket    ┌─────────────────────────┐    HTTP    ┌─────────────────┐
│   Your App      │◀───────────────▶│   DevTools Server       │◀──────────▶│   MCP Server    │
│  + Reflex SDK   │                 │   + Trace Storage       │            │  (this package) │
│ (browser tab or │                 │   + REST API            │            └────────┬────────┘
│  headless Node) │                 │  project-local, --mcp   │                     │ MCP (stdio)
└─────────────────┘                 └─────────────────────────┘                     ▼
                                                                            ┌─────────────────┐
                                                                            │    AI Agent     │
                                                                            │ (Claude Code,   │
                                                                            │  Codex, Cursor) │
                                                                            └─────────────────┘
```

Two processes, two scopes:

- **DevTools server** — project-local, installed as a dev dependency, run in the project folder (`npm run devtools:mcp`). Holds trace storage and talks to the app. Agents start this themselves.
- **MCP bridge (this package)** — global, started by the AI client via version-pinned `npx`. Stateless; just translates MCP tool calls into DevTools API calls.

What agents can do through it:

- 🩺 **Check app health in one call** — is an app connected, browser or headless, tracing on, and did the session restart since the last look
- 📊 **Inspect execution traces** — compact trace lists plus per-trace detail (state patches, effects, errors)
- 🔍 **Query application state** — scoped by path, no full dumps
- 🧮 **Evaluate subscriptions on demand** — verify derived values before any component mounts them
- 🚀 **Dispatch events and observe the outcome** — trigger a handler and get back the state diff it committed, the effects it emitted, or the error if it failed
- 📚 **List handlers** — all registered events, effects, coeffects, and subscriptions
- ⚡ **Monitor subscriptions** — current values of active reactive queries

The app does not have to be a browser tab: a **[headless runtime](#-headless-runtime-for-autonomous-agent-loops)** connects the same way, so the whole loop works in CI and autonomous agent sessions with no browser at all.

---

## 🚀 Quick Start

### Recommended: the Reflex Agent Toolkit plugin

For Claude Code and Codex, don't configure this package by hand. The [Reflex Agent Toolkit](https://github.com/flexsurfer/reflex-agent-toolkit) plugin ships the MCP configuration *and* the workflow skill that teaches the agent when to use each tool:

**Claude Code**

```text
/plugin marketplace add flexsurfer/reflex-agent-toolkit
/plugin install reflex-agent-toolkit@reflex-agent-toolkit
```

**Codex**

```bash
codex plugin marketplace add flexsurfer/reflex-agent-toolkit
# then inside Codex: /plugins → install "Reflex Agent Toolkit"
```

Then ask for what you want — "Create a React/Vite site using Reflex (@flexsurfer/reflex)" — and the agent handles project setup (dependencies, tracing, the `devtools:mcp` script) itself.

### Manual client configuration

For Claude Desktop, Cursor, or any other MCP client, register the bridge with `npx` and the exact tested package version. One config works everywhere; only the file location differs:

- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- **Cursor:** `.cursor/mcp.json` in the project root

```json
{
  "mcpServers": {
    "reflex-devtools": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=@flexsurfer/reflex-devtools-mcp@0.1.13",
        "reflex-devtools-mcp",
        "--host",
        "127.0.0.1",
        "--port",
        "4000"
      ]
    }
  }
}
```

`--host`/`--port` point at the DevTools server; change them if yours runs elsewhere. Restart the client and the tools appear.

### App-side prerequisites

The bridge needs a DevTools server with a connected app to talk to. In the project (the agent toolkit skill does all of this automatically):

1. **Install DevTools:**
   ```bash
   npm install --save-dev @flexsurfer/reflex-devtools
   ```

2. **Enable it in development** (app entry point):
   ```typescript
   import { createReflexInspector } from '@flexsurfer/reflex';
   import { enableDevtools } from '@flexsurfer/reflex-devtools';

   if (import.meta.env.DEV) {
     enableDevtools(createReflexInspector());
   }
   ```

3. **Add and run the project-local server script.** The `--mcp` flag enables trace storage — without it, MCP tools return "MCP not enabled" errors:
   ```json
   {
     "scripts": {
       "devtools:mcp": "reflex-devtools --mcp --host 127.0.0.1 --port 4000"
     }
   }
   ```
   ```bash
   npm run devtools:mcp
   ```

4. **Start your Reflex app** — a browser tab, or a headless entry (`src/headless.ts` under `tsx`/`vite-node`) for browserless agent work.

> **⚠️ Security note:** DevTools and its MCP API are development-only and unauthenticated — `/api/dispatch` can mutate application state. Never expose the server to the public internet; keep it on `localhost` or a trusted local network.

---

## 🛠️ Available MCP Tools

The server advertises usage instructions to every MCP client at initialize time (the recommended retrieval order: check `app_status` first, discover handlers, read state by path, evaluate derived values with `eval_sub`, then act with `dispatch_event` and verify from its response), so agents get this workflow automatically — no extra prompt setup needed.

### 1. `app_status`

Cheap health/session check — the intended first call after a cold start and after every app reload. Reports:

- `appConnected` — is any app (browser or headless) connected to the DevTools server
- `sessionEpoch` — bumps every time the app reconnects; if it changed since your last look, the app restarted: trace ids reset, stored traces cleared, seeded state gone
- `runtime` — `"browser"`, `"react-native"`, or `"headless"`, plus `effectMode` and per-effect adapter modes when the app declares them
- `tracing`, handler counts per type, `stateAvailable`, `traceCount`, `mcpEnabled`

Degraded setups come back with explicit hints (server started without `--mcp`, no app connected) instead of errors.

**Parameters:** none

**Example prompts:**
- "Is my app connected and healthy?"
- "Did the app restart since we last checked?"

### 2. `get_traces`

List execution traces from your application as compact rows: id, operation, opType, duration, timestamp, and event args. Failed events carry an `error` summary; events whose effects threw carry an `effectErrors` count. Use `get_trace` with a row's id for full detail.

**Parameters:**
- `limit` (number, optional): Maximum traces to return (default: 50, max: 1000)
- `eventFilter` (string, optional): Filter by event/operation name (substring match)
- `minDuration` (number, optional): Filter traces by minimum duration in milliseconds
- `opType` (string, optional): Filter by operation type: `event`, `render`, `sub/create`, `sub/run`, `sub/dispose`

**Example prompts:**
- "Show me the last 10 event traces"
- "Find all traces with duration over 100ms"
- "Show me traces for the 'fetch-user' event"

### 3. `get_trace`

Get the full detail of a single trace by id: for events, the state patches committed, the effects emitted, and error details (message, stack, failing interceptor) if it failed.

**Parameters:**
- `id` (number, required): The trace id, as returned by `get_traces`

**Example prompts:**
- "Show me the full detail of trace 42"
- "What state changes did that failed event make before throwing?"

### 4. `get_app_state`

Retrieve the current application database state — scoped by path whenever possible.

**Parameters:**
- `path` (string, optional): Path to a specific part of state (e.g., `user.profile`, `items[0]`)

**Example prompts:**
- "Show me the user profile data"
- "What's in the items array?"

### 5. `dispatch_event`

Dispatch an event to the application and observe what it did. The response reports the outcome derived from the event's trace:

- `succeeded` — with the state patches it committed and the effects it emitted
- `failed` — with the error: a missing handler (typo'd event id) or a throwing handler chain; state was not committed
- `effects-failed` — state committed, but some effect handlers threw
- `unknown` — dispatched, but no trace was observed (e.g. tracing disabled or the app disconnected)

If no app is connected, the dispatch fails outright instead of pretending to succeed.
This tool requires the DevTools server to be started with `--mcp`.

**Parameters:**
- `eventName` (string, required): The event ID to dispatch
- `params` (array, optional): Parameters to pass to the event handler

**Example prompts:**
- "Dispatch a 'set-user' event with id 123 and name 'Test User'"
- "Trigger the 'clear-cache' event and tell me what state it changed"

### 6. `get_handlers`

List all registered handler ids, grouped by handler type.

**Parameters:**
- `type` (string, optional): Filter by handler type: `event`, `fx`, `cofx`, `sub`

**Example prompts:**
- "What event handlers are registered?"
- "List all registered effects"

### 7. `get_active_subs`

View all currently active subscriptions and their current values, including
mounted root subscriptions and dependencies kept active by computed subscriptions.

**Parameters:**
- `filter` (string, optional): Filter subscriptions by key name

**Example prompts:**
- "What subscriptions are currently active?"
- "Show me user-related subscriptions"

### 8. `eval_sub`

Evaluate any registered subscription against current app state. Unlike `get_active_subs`, the subscription does not need to be mounted by a component.

**Parameters:**
- `id` (string, required): Registered subscription id
- `args` (array, optional): Subscription arguments after the id

**Example prompts:**
- "Evaluate `user-by-id` with argument 123"
- "What does the new `expenses/category-total` subscription return for `food`?"

---

## 🧪 Headless runtime for autonomous agent loops

Reflex's state layer is React-free, so the app an agent drives does not need a browser tab. The convention is a `src/headless.ts` entry that imports the same state modules as `main.tsx` — just with Node-safe side-effect adapters and no React mount:

```typescript
// src/headless.ts — run under tsx (or vite-node when your project
// resolves dependencies through vite aliases)
import { createReflexInspector } from '@flexsurfer/reflex';
import { enableDevtools } from '@flexsurfer/reflex-devtools';
import './db';
import './events';
import './subs';
import './effects.headless';    // memory/no-op adapters instead of effects.browser
import './coeffects.headless';

enableDevtools(createReflexInspector(), {
  // runtime: 'headless' is auto-detected (no window)
  effectMode: 'safe',
  effects: { 'local-storage-set': 'memory', 'analytics-track': 'noop' }
});

setInterval(() => {}, 60_000); // keep the process alive if the server is down
```

Split runtime-specific side effects into adapter pairs so the headless world is safe by default: `effects.browser.ts` / `effects.headless.ts` and `coeffects.browser.ts` / `coeffects.headless.ts` register the **same effect ids** with different implementations (real `localStorage` vs an in-memory map, real analytics vs no-op). Handlers emit the same effect contract either way, and `dispatch_event` still reports the emitted effects, so an agent can verify "the handler emitted the right effect" without touching the real world. The `effects` map passed to `enableDevtools` is surfaced through `app_status` so agents can see which effects really execute.

Run it with a watcher for the edit → reload → re-verify loop (`tsx watch src/headless.ts`); each reload reconnects the SDK, which bumps `sessionEpoch` — visible in the next `app_status` call. The DevTools server enforces a single app session: a new connection supersedes the previous one, so a lingering older runtime can never double-execute dispatched events, and dispatches still in flight across a reload come back `outcome: "unknown"` ("session restarted") instead of hanging.

Headless mode needs **Node.js 22+** (the SDK uses the global `WebSocket`, stable since Node 22). On older Node it disables itself with an explicit warning.

The [DevTools playground](https://github.com/flexsurfer/reflex/tree/main/examples/devtools-playground) in this repo is the reference implementation (`pnpm dev:playground:headless` from the workspace root).

---

## 💡 The act-and-verify loop in practice

**You:** "Can you test what happens when a user logs in?"

**Agent:**
```
I'll dispatch a login event with test user data...

*calls dispatch_event with eventName: "user-login", params: [{"id": 999, "name": "Test User"}]*

The event succeeded. The response shows exactly what it did:
- outcome: "succeeded"
- stateChanges: user.id → 999, user.name → "Test User",
  user.isAuthenticated → true
- effectsEmitted: [["analytics-track", "login"]]

The login flow works — no follow-up state query needed.
```

**You:** "My app feels slow. Can you find bottlenecks?"

**Agent:**
```
*calls get_traces with minDuration: 50*

I found several events taking over 50ms:
- "fetch-user-data": 234ms (3 times)
- "process-large-list": 156ms (1 time)

*calls get_trace with id 87*

"fetch-user-data" emits a "fetch-api" effect on every keystroke —
consider debouncing the dispatch or caching the request.
```

---

## 🔧 Configuration

### DevTools Server (project-local)

```bash
reflex-devtools [options]

Options:
  -p, --port <port>         Port to run the server on (default: 4000)
  -h, --host <host>         Host to bind the server to (default: localhost)
  --mcp                     Enable MCP support with trace storage (required for MCP)
  --max-traces <number>     Maximum traces to store (default: 1000, requires --mcp)
  --help                    Show help message
```

Binding beyond `localhost` (e.g. `--host 0.0.0.0`) exposes the unauthenticated state-reading and dispatch API — only do this on trusted local networks, never on the public internet.

### MCP Bridge (this package)

```bash
reflex-devtools-mcp [options]

Options:
  -p, --port <port>         DevTools server port (default: 4000)
  -h, --host <host>         DevTools server host (default: localhost)
  --help                    Show help message
```

**Note:** Trace storage and limits are configured on the DevTools server, not the MCP bridge. `npx` runs the bridge over stdio and does not make it project-specific; the project-local `devtools:mcp` script is the separate process that exposes the running app on the configured loopback port.

---

## 🏗️ Development

### Building from Source

```bash
git clone https://github.com/flexsurfer/reflex.git
cd reflex
pnpm install
pnpm build
```

### Testing Locally

```bash
# Terminal 1: Start DevTools server with MCP support
node packages/reflex-devtools/dist/cli.js --mcp --host 127.0.0.1 --port 4000

# Terminal 2: Start the DevTools playground (browser)
pnpm dev:playground
#   …or headless (no browser):
pnpm dev:playground:headless

# Terminal 3: Run the test suites
pnpm test
```

For the `AGENTS.md` guidance template shipped with Reflex, see [`packages/reflex/templates/agent/AGENTS.md`](https://github.com/flexsurfer/reflex/blob/main/packages/reflex/templates/agent/AGENTS.md).

### Project Structure

```
packages/reflex-devtools-mcp/
├── src/
│   ├── index.ts           # Main MCP server implementation
│   ├── cli.ts             # CLI entry point
│   ├── httpClient.ts      # HTTP client for DevTools API
│   └── tools/             # MCP tool implementations
│       ├── appStatus.ts
│       ├── getTraces.ts
│       ├── getTrace.ts
│       ├── getAppState.ts
│       ├── evalSub.ts
│       ├── dispatchEvent.ts
│       ├── getHandlers.ts
│       └── getActiveSubs.ts
├── test/                  # Tool + stdio integration tests
├── dist/                  # Compiled output
└── README.md              # This file
```

---

## 🔗 Related Projects

- **[@flexsurfer/reflex](https://github.com/flexsurfer/reflex)** - The reactive state management library
- **[@flexsurfer/reflex-devtools](https://github.com/flexsurfer/reflex/tree/main/packages/reflex-devtools)** - Main DevTools package with web UI
- **[Reflex Agent Toolkit](https://github.com/flexsurfer/reflex-agent-toolkit)** - Claude Code / Codex plugin with skills + this MCP preconfigured
- **[Model Context Protocol](https://modelcontextprotocol.io)** - The MCP specification

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built with ❤️ for the Reflex community. Special thanks to:
- The [MCP](https://modelcontextprotocol.io) team for creating an amazing protocol
- Anthropic for Claude and MCP support
- All contributors to the Reflex ecosystem

---

<div align="center">

  **Debug Smarter with AI! 🤖✨**

  Made by [@flexsurfer](https://github.com/flexsurfer)

</div>
