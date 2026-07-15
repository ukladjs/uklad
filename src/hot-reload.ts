import { createElement, Fragment, useEffect, useReducer, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { consoleLog } from './loggers';
import { clearSubsForHotReload } from './registrar';

// Hot reload callback management
type HotReloadCallback = () => void;
const hotReloadCallbacks = new Set<HotReloadCallback>();

/**
 * Register a callback to be called when subs are hot reloaded
 */
export function registerHotReloadCallback(callback: HotReloadCallback): () => void {
  hotReloadCallbacks.add(callback);

  // Return unregister function
  return () => {
    hotReloadCallbacks.delete(callback);
  };
}

/**
 * Trigger all registered hot reload callbacks
 */
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

/**
 * Clear all hot reload callbacks
 */
export function clearHotReloadCallbacks(): void {
  hotReloadCallbacks.clear();
}

/**
 * React hook that forces component re-render when subs are hot reloaded
 */
export function useHotReload(): void {
  const [, forceUpdate] = useReducer((version: number) => version + 1, 0);

  useEffect(() => {
    return registerHotReloadCallback(forceUpdate);
  }, []);
}

// Key counter for generating unique keys
let keyCounter = 0;

/**
 * React hook that provides a key that changes when subs are hot reloaded
 * Useful for forcing complete re-mount of component trees
 */
export function useHotReloadKey(): string {
  const [key, setKey] = useState(() => `hot-reload-${++keyCounter}`);

  useEffect(() => {
    const updateKey = () => {
      setKey(`hot-reload-${++keyCounter}`);
    };

    return registerHotReloadCallback(updateKey);
  }, []);

  return key;
}

/**
 * Utility for setting up hot reload in subs modules
 * Returns dispose and accept functions for HMR
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

/**
 * React component that wraps children with hot reload support
 * Uses a key that changes when subs are hot reloaded to force re-mount
 */
export function HotReloadWrapper({ children }: { children: ReactNode }): ReactElement {
  const key = useHotReloadKey();
  return createElement(Fragment, { key }, children);
}
