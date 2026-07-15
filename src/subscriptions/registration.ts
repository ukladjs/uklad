import { consoleLog } from '../core/logging';
import { getRenderDb } from '../runtime/app-db';
import {
  hasHandler,
  registerHandler,
  SUB_DEPS_HANDLER_KIND,
  SUB_HANDLER_KIND,
} from '../runtime/handlers';
import {
  clearRootSubSource,
  clearSubConfigs,
  getRootSubIdBySource,
  hasCachedSubscriptionForId,
  setRootSubSource,
  setSubConfig,
} from '../runtime/subscriptions/cache';

import type { Id, SubConfig, SubResult, SubVector } from '../types';

/**
 * Register a root or computed subscription.
 *
 * `regSub(id)` reads the top-level DB key named by `id`; `regSub(id, key)`
 * maps a root subscription to another top-level key. Passing a compute function
 * requires a dependency function and optionally accepts a local equality check.
 * A registration cannot be replaced while one of its queries remains cached.
 *
 * When `SubPayloads` is augmented, the compute result is checked against the
 * declared result for `K`. Explicit result generics retain the legacy contract.
 */
export function regSub<R = any, K extends Id = Id>(
  id: K,
  computeFn?: ((...values: any[]) => SubResult<K, R>) | string,
  depsFn?: (...params: any[]) => SubVector[],
  config?: SubConfig,
): void {
  if (hasCachedSubscriptionForId(id)) {
    const message = `[reflex] Cannot register subscription '${id}' while a cached query for that id exists. Clear unused subscriptions before re-registering it.`;
    consoleLog('error', message);
    throw new Error(message);
  }
  if (hasHandler(SUB_HANDLER_KIND, id)) {
    consoleLog('warn', `[reflex] Overriding. Subscription '${id}' already registered.`);
  }

  if (computeFn === undefined) {
    if (!registerRootSubscription(id, id)) return;
  } else if (typeof computeFn === 'string') {
    if (!registerRootSubscription(id, computeFn)) return;
  } else {
    if (!depsFn) {
      consoleLog(
        'error',
        `[reflex] Subscription '${id}' has computeFn but missing depsFn. Computed subscriptions must specify their dependencies.`,
      );
      return;
    }
    clearRootSubSource(id);
    registerHandler(SUB_HANDLER_KIND, id, computeFn);
    registerHandler(SUB_DEPS_HANDLER_KIND, id, depsFn);
  }

  // Re-registration replaces the complete definition, including its config.
  const normalizedConfig = normalizeSubConfig(id, config);
  if (normalizedConfig) {
    setSubConfig(id, normalizedConfig);
  } else {
    clearSubConfigs(id);
  }
}

function normalizeSubConfig(id: Id, config: SubConfig | undefined): SubConfig | undefined {
  if (config == null) return undefined;

  if (typeof config !== 'object') {
    consoleLog('warn', `[reflex] Subscription '${id}' config must be an object. Using defaults.`);
    return undefined;
  }

  if (config.equalityCheck === undefined || typeof config.equalityCheck === 'function') {
    return config;
  }

  consoleLog(
    'warn',
    `[reflex] Subscription '${id}' equalityCheck must be a function. Using the global equality check.`,
  );
  return undefined;
}

function registerRootSubscription(id: Id, sourceKey: string): boolean {
  const conflictingSubId = getRootSubIdBySource(sourceKey);
  if (conflictingSubId !== undefined && conflictingSubId !== id) {
    consoleLog(
      'error',
      `[reflex] Subscription '${id}' was not registered. Root key '${sourceKey}' is already used by subscription '${conflictingSubId}'.`,
    );
    return false;
  }

  setRootSubSource(id, sourceKey);
  // Root handlers read the last flushed generation so new and cached queries
  // cannot observe different DB versions between an event and its flush.
  registerHandler(SUB_HANDLER_KIND, id, () => getRenderDb<Record<string, any>>()[sourceKey]);
  registerHandler(SUB_DEPS_HANDLER_KIND, id, () => []);
  return true;
}
