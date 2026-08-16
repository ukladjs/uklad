**Reactive state management for React & React Native — built for AI agentic development**

Pure event handlers over an instance-owned state, derived subscriptions, isolated side effects. An architecture coding agents can generate, observe at runtime, and verify — and humans can still read.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![NPM Version](https://img.shields.io/npm/v/%40ukladjs%2Fcore)](https://www.npmjs.com/package/@ukladjs/core)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ukladjs/uklad/pulls)

## 🤖 AI Agentic Development

Uklad is designed to be written _and driven_ by coding agents. The whole setup is two steps.

**1. Install the [Uklad Agent Toolkit](https://github.com/ukladjs/agent-toolkit) plugin** — once, globally:

Claude Code:

```text
/plugin marketplace add ukladjs/agent-toolkit
/plugin install uklad-agent-toolkit@ukladjs
```

Codex:

```bash
codex plugin marketplace add ukladjs/agent-toolkit
# then inside Codex: /plugins → install "Uklad Agent Toolkit"
```

**2. Ask for what you want:**

```text
> Create a React/Vite site using Uklad (@ukladjs/core).

> Migrate this app's state management to Uklad (@ukladjs/core).
```

The plugin ships the Uklad skill (workflow, conventions, progressive references) and the [DevTools](https://github.com/ukladjs/uklad/tree/main/packages/devtools) MCP configuration. From there the agent handles the project itself: installs compatible dependencies, enables development-only operation evidence, starts the project-local DevTools server, and **verifies its own changes at runtime**. On an operation-enabled runtime, `dispatch_and_wait` returns one immutable snapshot for the settled event cascade, including bounded state patches and errors; `dispatch_event` remains the compatibility path for older runtimes.

### Why agents are effective with Uklad

- **All logic is pure functions** over an instance-owned state. Every change is small, isolated, and deterministic — easy to generate, easy to review.
- **Everything is addressable by id.** Events, subscriptions, and effects are registered under ids, so an agent looks up the one handler it needs instead of reading store files end-to-end.
- **The running app is observable.** Through the DevTools MCP an agent checks app health, lists handlers, reads state by path, watches live subscription values, and inspects traces of everything that happened — including what it didn't initiate.
- **No browser required.** The state layer is React-free: a headless entry runs the full app under Node, so autonomous agent loops and CI drive the real thing.

### Add the project router

After installing `@ukladjs/core`, add a short managed Uklad section to the nearest package-level `AGENTS.md`:

```bash
npx --no-install uklad-agent init
```

The command requires a direct `@ukladjs/core` dependency, preserves all existing project guidance, and owns only the text between `<!-- uklad-agent:start -->` and `<!-- uklad-agent:end -->`. It is safe to rerun when Uklad guidance changes.

Useful variants:

```bash
npx --no-install uklad-agent init --dry-run
npx --no-install uklad-agent init --root packages/my-app
npx --no-install uklad-agent init --remove
```

The generated router tells agents that the project uses Uklad, directs compatible agents to the Uklad skill, and points other agents at the detailed fallback shipped in `node_modules/@ukladjs/core/templates/agent/AGENTS.md`. In a monorepo, run it from the consuming package or pass `--root`; this keeps Uklad guidance scoped to the code it governs.

Claude Code users can include the same router by adding `@AGENTS.md` to their existing `CLAUDE.md`. A small starter file remains available at `node_modules/@ukladjs/core/templates/agent/CLAUDE.md`.

For the runtime loop, the project needs a local DevTools script (the plugin's setup skill creates it when missing):

```json
{
  "scripts": {
    "devtools:mcp": "uklad-devtools --mcp --allow-dispatch --host 127.0.0.1 --port 4000 --allow-origin http://localhost:5173"
  }
}
```

Omit `--allow-dispatch` for a read-only inspection session. Mutation is never
enabled implicitly by `--mcp`. Replace the `--allow-origin` value with the
exact origin of your browser dev server, or omit it for a headless-only app.

Manual MCP client configs are included as templates:

```bash
# Codex (trusted projects only)
mkdir -p .codex && cp node_modules/@ukladjs/core/templates/agent/codex-config.toml .codex/config.toml

# Claude Code / Cursor
cp node_modules/@ukladjs/core/templates/agent/mcp.json .mcp.json
mkdir -p .cursor && cp node_modules/@ukladjs/core/templates/agent/mcp.json .cursor/mcp.json
```

## ✨ The architecture in 30 seconds

```bash
npm install @ukladjs/core@0.2.2
```

Declare application names once, beside one complete contract:

```ts
// app/uklad/catalog.ts
export const stateKeys = { counterValue: 'counterValue' } as const;
export const appIds = {
  events: { counterIncrement: 'counter/increment' },
  subscriptions: { counterValue: 'counter/value' },
  effects: {},
  coeffects: {},
} as const;

// app/uklad/contracts.ts
import type { UkladContracts } from '@ukladjs/core/vanilla';
import { appIds, stateKeys } from './catalog';

export interface AppContracts extends UkladContracts {
  state: { [stateKeys.counterValue]: number };
  events: { [appIds.events.counterIncrement]: [] };
  subscriptions: {
    [appIds.subscriptions.counterValue]: { params: []; result: number };
  };
  effects: {};
  coeffects: {};
}
```

```tsx
import { createUkladRuntime } from '@ukladjs/core/vanilla';
import { createUkladHooks } from '@ukladjs/core/react';
import { appIds, stateKeys } from './app/uklad/catalog';
import type { AppContracts } from './app/uklad/contracts';

const runtime = createUkladRuntime<AppContracts>({
  initialState: { [stateKeys.counterValue]: 0 },
  runtimeId: 'counter-app',
  name: 'Counter app',
});

// A module owns its registrations and can be disposed safely.
runtime.registerModule((registrar) => {
  registrar.regEvent(appIds.events.counterIncrement, ({ draftState }) => {
    draftState.counterValue += 1;
  });
  registrar.regRootSub(appIds.subscriptions.counterValue, stateKeys.counterValue);
});

const { UkladProvider, useRuntime, useSubscription } = createUkladHooks<AppContracts>();

function Counter() {
  const count = useSubscription([appIds.subscriptions.counterValue]);
  const { dispatch } = useRuntime();
  return <button onClick={() => dispatch([appIds.events.counterIncrement])}>Count: {count}</button>;
}

function Root() {
  return (
    <UkladProvider runtime={runtime}>
      <Counter />
    </UkladProvider>
  );
}
```

Each runtime owns its state, event queue, handlers, subscription graph,
tracing, and inspector. Create one per browser root, SSR request, embedded
widget, story, test, or agent sandbox whenever those worlds must be isolated.

There is no package-global runtime. React hooks require a `UkladProvider` and
receive a dispatch/subscription-only client facade. Registration, persistence,
and lifecycle work go through the runtime owner; inspection and focused test
access require the explicit `@ukladjs/core/devtools` and
`@ukladjs/core/testing` subpaths.

### Browserless E2E scenarios

`@ukladjs/core/testing` also exports `createUkladHeadlessScenario(runtime)` for
application-semantic E2E tests. Mount named subscription-backed views with
`app.mountView`, drive them through standard `app.dispatch` calls, await
`app.settle()`, and assert the observed view values before unmounting or
disposing the scenario. It exercises the real event and subscription lifecycle
without requiring a browser; retain a small browser smoke test for DOM wiring,
accessibility, and layout.

### Subscription runtime

Uklad settles changed subscription graphs in one STATE-driven topological wave before notifying React. Active snapshots are cache-only, dormant reads are memoized pulls, equality cuts off downstream work, and computed nodes are evicted when their last consumer leaves. Computed subscriptions use safe shallow structural equality by default: newly allocated arrays, plain objects, Maps, Sets, and typed arrays remain stable when their immediate contents do. Nested values retain identity semantics; pass a runtime or per-subscription comparator when another policy is intentional. The runtime invariants and work budgets are documented in the [central subscription-runtime documentation](https://github.com/ukladjs/uklad/blob/main/docs/architecture/subscription-runtime.md).

For an external lifecycle that should follow one live subscription instance,
`regSubExt` attaches a controller without changing the subscription's pure
data definition. Its signals are passive reads, and any mapped value returns
through Uklad's normal event → state → subscription path. The first integration
is [`@ukladjs/tanstack-query`](https://github.com/ukladjs/uklad/tree/main/packages/tanstack-query): TanStack Query owns the server cache while Uklad exposes a clean domain read model. See the [integration guide](https://github.com/ukladjs/uklad/blob/main/docs/architecture/tanstack-query.md).

Side effects (HTTP, storage, timers, navigation) live in **effects/coeffects**, registered by id and emitted from event handlers as data — which is what keeps handlers pure, apps portable across web/mobile/desktop, and behavior verifiable by tools.

## 🎯 Why Uklad?

🎯 **Predictable State Management** - Unidirectional data flow with pure functions  
🧩 **Composable Architecture** - Build complex apps from simple, reusable pieces  
🔄 **Reactive Subscriptions** - UI automatically updates when state changes  
🌐 **Multi-Platform Support** - With effects separation, it's super easy to support multiple platforms with the same codebase, including web, mobile, and desktop  
🤖 **AI Friendly** - All logic is expressed through pure, isolated functions, making each change understandable, verifiable, and deterministic — and the DevTools MCP lets agents verify changes against the running app  
🛠️ **Integrated DevTools** - [`@ukladjs/devtools`](https://github.com/ukladjs/uklad/tree/main/packages/devtools) provides deep visibility into your app's state, events, and subscriptions in real time — a dashboard for humans, an MCP API for agents  
⚡ **Interceptor Pattern** - Powerful middleware system for cross-cutting concerns  
🛡️ **Type Safety** - Full TypeScript support with excellent IDE experience  
🧪 **Testability** - Pure functions make testing straightforward and reliable

## 📚 Learn More

- [Re-frame parity tradeoffs](https://github.com/ukladjs/uklad/blob/main/docs/compatibility/re-frame-parity.md) - What Uklad gains, pays,
  and should improve in its JavaScript implementation

- Examples
  - [TodoMVC](https://github.com/ukladjs/uklad/tree/main/examples/todomvc) - Classic todo app implementation showcasing core uklad patterns
  - [TodoMVC with TanStack Query](https://github.com/ukladjs/uklad/tree/main/examples/todomvc-query) - Server-state ownership and query-subscription integration
  - [Issue Triage Board](https://github.com/flexsurfer/reflex-demo) - Demo app built with uklad architecture rules ([Live Video](https://www.youtube.com/watch?v=xwv5SwlF4Dg))
  - [Einbürgerungstest](https://github.com/flexsurfer/einburgerungstest/) - Cross-platform web/mobile app built with uklad ([Live Demo](https://www.ebtest.org/))
  - [StarRupture Planner](https://github.com/flexsurfer/starrupture-planner) - Production planning tool built with uklad ([Live Demo](https://www.starrupture-planner.com/))

## 🌱 Heritage: re-frame and ClojureScript

Uklad is **re-frame for the JavaScript world**. After many years of building applications with [re-frame](https://day8.github.io/re-frame/re-frame/) in ClojureScript, I wanted to bring the same architectural elegance to the JavaScript/TypeScript ecosystem. This is not just another state management library — it's a **battle-tested** pattern that has been a joy to work with for over a decade.

📚 **Want to understand the philosophy behind this approach?** Check out the amazing [re-frame documentation](https://day8.github.io/re-frame/re-frame/) which describes the greatness of this framework in the finest details. Everything you learn there applies to uklad! Though we do lose some of ClojureScript's natural immutability magic. Immer helps bridge this gap, but it's not quite as elegant or efficient as CLJS persistent data structures.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or file an issue with questions, suggestions, or ideas. Implementation changes should follow the [code conventions and module ownership rules](https://github.com/ukladjs/uklad/blob/main/docs/engineering/code-conventions.md).

## 📄 License

MIT © [flexsurfer](https://github.com/flexsurfer)

---

_Bringing the wisdom of ClojureScript's re-frame to the JavaScript world — now with an agent loop the original never had._
