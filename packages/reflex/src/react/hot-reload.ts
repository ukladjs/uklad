import { createElement, Fragment, useCallback, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { consoleLog } from '../core/logging';
import {
  clearRuntimeSubsForHotReload,
  defaultRuntime,
  type ReflexRuntime,
} from '../runtime/runtime';
import { clearSubsForHotReload } from '../runtime/subscriptions/cache';
import { useReflexRuntime } from './context';

type HotReloadCallback = () => void;

interface HotReloadState {
  readonly callbacks: Set<HotReloadCallback>;
  version: number;
}

const hotReloadStates = new WeakMap<object, HotReloadState>();

function getHotReloadState(runtime: ReflexRuntime<any>): HotReloadState {
  let state = hotReloadStates.get(runtime);
  if (!state) {
    state = { callbacks: new Set(), version: 0 };
    hotReloadStates.set(runtime, state);
  }
  return state;
}

/** Register a compatibility-runtime callback and return an unregister function. */
export function registerHotReloadCallback(callback: HotReloadCallback): () => void {
  return registerRuntimeHotReloadCallback(defaultRuntime, callback);
}

function registerRuntimeHotReloadCallback(
  runtime: ReflexRuntime<any>,
  callback: HotReloadCallback,
): () => void {
  const callbacks = getHotReloadState(runtime).callbacks;
  callbacks.add(callback);
  return () => callbacks.delete(callback);
}

/** Invoke callbacks for the compatibility runtime. */
export function triggerHotReload(): void {
  triggerRuntimeHotReload(defaultRuntime);
}

function triggerRuntimeHotReload(runtime: ReflexRuntime<any>): void {
  consoleLog('log', '[reflex] Triggering hot reload callbacks');
  const state = getHotReloadState(runtime);
  state.version++;
  for (const callback of state.callbacks) {
    try {
      callback();
    } catch (error) {
      consoleLog('error', '[reflex] Error in hot reload callback:', error);
    }
  }
}

/** Remove compatibility-runtime callbacks. */
export function clearHotReloadCallbacks(): void {
  getHotReloadState(defaultRuntime).callbacks.clear();
}

/** Re-render whenever the nearest runtime's subscription definitions reload. */
export function useHotReload(): void {
  useHotReloadVersion();
}

/** Return a key that changes after the nearest runtime reloads subscriptions. */
export function useHotReloadKey(): string {
  const [runtime, version] = useHotReloadVersion();
  return `${runtime.runtimeId}:hot-reload-${version}`;
}

function useHotReloadVersion(): readonly [ReflexRuntime<any>, number] {
  const runtime = useReflexRuntime();
  const subscribe = useCallback(
    (callback: HotReloadCallback) => registerRuntimeHotReloadCallback(runtime, callback),
    [runtime],
  );
  const getSnapshot = useCallback(() => getHotReloadState(runtime).version, [runtime]);
  const version = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [runtime, version] as const;
}

/** Create bundler-agnostic HMR hooks scoped to one runtime. */
export function setupSubsHotReload(runtime: ReflexRuntime<any> = defaultRuntime): {
  dispose: () => void;
  accept: (newModule?: unknown) => void;
} {
  const dispose = () => {
    if (runtime === defaultRuntime) clearSubsForHotReload();
    else clearRuntimeSubsForHotReload(runtime);
  };
  const accept = (newModule?: unknown) => {
    if (newModule) {
      consoleLog('log', '[reflex] Hot reloading subs module');
      triggerRuntimeHotReload(runtime);
    }
  };
  return { dispose, accept };
}

/** Remount descendants whenever the nearest runtime's definitions reload. */
export function HotReloadWrapper({ children }: { children: ReactNode }): ReactElement {
  const key = useHotReloadKey();
  return createElement(Fragment, { key }, children);
}
