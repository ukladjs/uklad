/**
 * Headless entry point — the full Reflex state layer with no React mount.
 *
 * It installs the exact same feature modules as main.tsx; only the platform
 * pair differs (platform/headless is Node-safe: memory-backed or a documented
 * no-op). This is the second execution owner in this app, so it creates and
 * owns its own runtime rather than reusing the browser one.
 *
 * The devtools SDK connects over WebSocket exactly as in the browser, so every
 * MCP tool — app_status, get_state, eval_sub, dispatch_event, dispatch_and_wait,
 * get_traces — works against this process.
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
import { enableMapSet } from '@flexsurfer/reflex/vanilla';
import { createReflexInspector } from '@flexsurfer/reflex/devtools';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import { enableDevtools } from '@flexsurfer/reflex-devtools';

import { appIds } from './app/reflex/catalog';
import type { AppContracts } from './app/reflex/contracts';
import { registerFeatureModules } from './app/reflex/register';
import { createPlaygroundRuntime } from './app/reflex/runtime';
import { headlessCoeffectModes, registerHeadlessCoeffects } from './platform/headless/coeffects';
import { headlessEffectModes, registerHeadlessEffects } from './platform/headless/effects';

const serverUrl = process.env.REFLEX_DEVTOOLS_SERVER_URL ?? '127.0.0.1:4000';

enableMapSet();

const headlessRuntime = createPlaygroundRuntime({
  runtimeId: 'devtools-playground.headless',
  name: 'DevTools Playground (Headless)',
});

registerFeatureModules(headlessRuntime);
headlessRuntime.registerModule(registerHeadlessEffects);
headlessRuntime.registerModule(registerHeadlessCoeffects);

// There is no React tree in this entry point, so keep the counter subscription
// active explicitly. It makes the headless playground exercise the same
// publication path a mounted counter panel would use, and lets
// dispatch_and_wait demonstrate its settled subscription evidence.
createReflexTestHarness<AppContracts>(headlessRuntime).watchSubscription(
  [appIds.subscriptions.counterValue],
  () => {},
);

enableDevtools(createReflexInspector(headlessRuntime), {
  serverUrl,
  operations: true,
  // runtime: 'headless' is auto-detected (no window); declare the
  // side-effect policy so app_status can report what really executes.
  effectMode: 'safe',
  effects: { ...headlessEffectModes, ...headlessCoeffectModes },
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
