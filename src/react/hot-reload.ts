import { createElement, Fragment, useEffect, useReducer, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { consoleLog } from '../core/logging';
import { clearSubsForHotReload } from '../runtime/subscriptions/cache';

type HotReloadCallback = () => void;

const hotReloadCallbacks = new Set<HotReloadCallback>();
let hotReloadKeyCounter = 0;

/** Register a callback and return an unregister function. */
export function registerHotReloadCallback(callback: HotReloadCallback): () => void {
  hotReloadCallbacks.add(callback);
  return () => {
    hotReloadCallbacks.delete(callback);
  };
}

/** Invoke every hot-reload callback, logging and isolating callback failures. */
export function triggerHotReload(): void {
  consoleLog('log', '[reflex] Triggering hot reload callbacks');

  for (const callback of hotReloadCallbacks) {
    try {
      callback();
    } catch (error) {
      consoleLog('error', '[reflex] Error in hot reload callback:', error);
    }
  }
}

/** Remove all registered hot-reload callbacks. */
export function clearHotReloadCallbacks(): void {
  hotReloadCallbacks.clear();
}

/** Re-render the calling component whenever subscription definitions are hot-reloaded. */
export function useHotReload(): void {
  const [, forceUpdate] = useReducer((version: number) => version + 1, 0);

  useEffect(() => registerHotReloadCallback(forceUpdate), []);
}

/** Return a key that changes after each subscription hot reload. */
export function useHotReloadKey(): string {
  const [key, setKey] = useState(() => `hot-reload-${++hotReloadKeyCounter}`);

  useEffect(() => {
    const updateKey = () => {
      setKey(`hot-reload-${++hotReloadKeyCounter}`);
    };

    return registerHotReloadCallback(updateKey);
  }, []);

  return key;
}

/**
 * Create bundler-agnostic HMR hooks for a subscription module.
 *
 * Disposal clears subscription definitions and cache state. Acceptance
 * notifies mounted React consumers only when the bundler supplies a module.
 */
export function setupSubsHotReload(): {
  dispose: () => void;
  accept: (newModule?: unknown) => void;
} {
  const dispose = () => {
    clearSubsForHotReload();
  };

  const accept = (newModule?: unknown) => {
    if (newModule) {
      consoleLog('log', '[reflex] Hot reloading subs module');
      triggerHotReload();
    }
  };

  return { dispose, accept };
}

/** Remount descendants whenever subscription definitions are hot-reloaded. */
export function HotReloadWrapper({ children }: { children: ReactNode }): ReactElement {
  const key = useHotReloadKey();
  return createElement(Fragment, { key }, children);
}
