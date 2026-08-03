import { createElement, Fragment, useCallback, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { consoleLog } from '../core/logging';
import { clearRuntimeSubsForHotReload, getRuntimeClientForInternalUse } from '../runtime/runtime';
import type { ReflexRuntime, ReflexRuntimeClient } from '../runtime/api';
import type { ReflexContracts } from '../contracts';
import { useReflexRuntime } from './context';

import type { Id } from '../types';

type HotReloadCallback = () => void;

interface HotReloadState {
  readonly callbacks: Set<HotReloadCallback>;
  version: number;
}

const hotReloadStates = new WeakMap<object, HotReloadState>();

/** Register a callback for one explicit runtime and return an unregister function. */
export function registerHotReloadCallback<TContracts extends ReflexContracts>(
  runtime: ReflexRuntimeClient<TContracts>,
  callback: HotReloadCallback,
): () => void {
  const callbacks = getHotReloadState(runtime).callbacks;
  callbacks.add(callback);
  return () => callbacks.delete(callback);
}

/** Invoke callbacks for one explicit runtime. */
export function triggerHotReload<TContracts extends ReflexContracts>(
  runtime: ReflexRuntimeClient<TContracts>,
): void {
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

/** Remove callbacks for one explicit runtime. */
export function clearHotReloadCallbacks<TContracts extends ReflexContracts>(
  runtime: ReflexRuntimeClient<TContracts>,
): void {
  getHotReloadState(runtime).callbacks.clear();
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

/**
 * Create bundler-agnostic HMR hooks scoped to one runtime. Pass the owning
 * module's subscription IDs to preserve unrelated definitions.
 */
export function setupSubsHotReload<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
  subscriptionIds?: readonly Id[],
): {
  dispose: () => void;
  accept: (newModule?: unknown) => void;
} {
  const dispose = () => {
    clearRuntimeSubsForHotReload(runtime, subscriptionIds);
  };
  const accept = (newModule?: unknown) => {
    if (newModule) {
      consoleLog('log', '[reflex] Hot reloading subs module');
      triggerHotReload(runtime);
    }
  };
  return { dispose, accept };
}

/** Remount descendants whenever the nearest runtime's definitions reload. */
export function HotReloadWrapper({ children }: { children: ReactNode }): ReactElement {
  const key = useHotReloadKey();
  return createElement(Fragment, { key }, children);
}

function getHotReloadState<TContracts extends ReflexContracts>(
  runtime: ReflexRuntimeClient<TContracts>,
): HotReloadState {
  const client = getRuntimeClientForInternalUse(runtime);
  let state = hotReloadStates.get(client);
  if (!state) {
    state = { callbacks: new Set(), version: 0 };
    hotReloadStates.set(client, state);
  }
  return state;
}

function useHotReloadVersion(): readonly [ReflexRuntimeClient<any>, number] {
  const runtime = useReflexRuntime();
  const subscribe = useCallback(
    (callback: HotReloadCallback) => registerHotReloadCallback(runtime, callback),
    [runtime],
  );
  const getSnapshot = useCallback(() => getHotReloadState(runtime).version, [runtime]);
  const version = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [runtime, version] as const;
}
