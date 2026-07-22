/**
 * Headless runtime entry — the full Reflex state layer with no React mount.
 *
 * Installs the exact same state/events/subs modules as main.tsx; only the
 * side-effect adapters differ (effects.headless / coeffects.headless are
 * Node-safe: memory-backed or no-op). The devtools SDK connects over
 * WebSocket exactly as in the browser, so every MCP tool — app_status,
 * get_app_state, eval_sub, dispatch_event, dispatch_and_wait, get_traces — works against this process.
 *
 * Run it (devtools server first, then this; needs Node >= 22 for the
 * global WebSocket the SDK connects through):
 *   pnpm dev:server:mcp
 *   pnpm dev:playground:headless
 *
 * This app runs under vite-node so the vite aliases resolve @flexsurfer/*
 * to the local lib sources; a scaffolded project installing from npm can
 * run the same file under tsx instead.
 */
import { createReflexRuntime, enableMapSet } from '@flexsurfer/reflex/vanilla';
import { enableDevtools } from '@flexsurfer/reflex-devtools';
import { coeffectModes, installHeadlessCoeffects } from './coeffects.headless';
import { createInitialAppState, type PlaygroundContracts } from './state';
import { effectModes, installHeadlessEffects } from './effects.headless';
import { installPlaygroundEvents } from './events';
import { installPlaygroundSubscriptions } from './subs';

const serverUrl = process.env.REFLEX_DEVTOOLS_SERVER_URL ?? '127.0.0.1:4000';

enableMapSet();

const headlessRuntime = createReflexRuntime<PlaygroundContracts>({
  initialState: createInitialAppState(),
  runtimeId: 'devtools-playground.headless',
  name: 'DevTools Playground (Headless)',
});

headlessRuntime.registerModule(installPlaygroundEvents);
headlessRuntime.registerModule(installPlaygroundSubscriptions);
headlessRuntime.registerModule(installHeadlessEffects);
headlessRuntime.registerModule(installHeadlessCoeffects);

// There is no React tree in this entry point, so keep the counter subscription
// active explicitly. It makes the headless playground exercise the same
// publication path a mounted counter panel would use, and lets
// dispatch_and_wait demonstrate its settled subscription evidence.
headlessRuntime.watchSubscription(['counter'], () => {});

enableDevtools(headlessRuntime, {
  serverUrl,
  operations: {
    executionContext: {
      profile: 'headless',
      defaultEffectMode: 'suppressed',
    },
  },
  // runtime: 'headless' is auto-detected (no window); declare the
  // side-effect policy so app_status can report what really executes.
  effectMode: 'safe',
  effects: {
    ...effectModes,
    ...coeffectModes,
    'fake-effect': 'real',
  },
});

console.log(
  `[headless] ${headlessRuntime.runtimeName} (${headlessRuntime.runtimeId}) started — no browser, no React`,
);
console.log(`[headless] connecting to Reflex DevTools at ${serverUrl}`);
console.log('[headless] dispatch and inspect via the devtools MCP tools; Ctrl+C to stop');

// With the devtools server unreachable nothing would be left on the event
// loop and the process would exit; idle instead so a watcher keeps us alive
// and an agent can start the server and reconnect by saving any file.
setInterval(() => {}, 60_000);
