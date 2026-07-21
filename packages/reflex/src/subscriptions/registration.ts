import { consoleLog } from '../core/logging';
import { getRenderDbForRuntime } from '../runtime/app-db';
import {
  hasHandlerForRuntime,
  registerHandlerForRuntime,
  SUB_DEPS_HANDLER_KIND,
  SUB_HANDLER_KIND,
} from '../runtime/handlers';
import type { RuntimeScope } from '../runtime/scope';
import {
  clearRootSubSourceForRuntime,
  clearSubConfigsForRuntime,
  getRootSubIdBySourceForRuntime,
  hasCachedSubscriptionForIdForRuntime,
  setRootSubSourceForRuntime,
  setSubConfigForRuntime,
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
/** @internal Register a root or computed subscription in one runtime. */
export function regSubForRuntime<R = any, K extends Id = Id>(
  runtime: RuntimeScope,
  id: K,
  computeFn?: ((...values: any[]) => SubResult<K, R>) | string,
  depsFn?: (...params: any[]) => SubVector[],
  config?: SubConfig,
): void {
  if (hasCachedSubscriptionForIdForRuntime(runtime, id)) {
    const message = `[reflex] Cannot register subscription '${id}' while a cached query for that id exists. Clear unused subscriptions before re-registering it.`;
    consoleLog('error', message);
    throw new Error(message);
  }
  if (hasHandlerForRuntime(runtime, SUB_HANDLER_KIND, id)) {
    consoleLog('warn', `[reflex] Overriding. Subscription '${id}' already registered.`);
  }

  if (computeFn === undefined) {
    if (!registerRootSubscription(runtime, id, id)) return;
  } else if (typeof computeFn === 'string') {
    if (!registerRootSubscription(runtime, id, computeFn)) return;
  } else {
    if (!depsFn) {
      consoleLog(
        'error',
        `[reflex] Subscription '${id}' has computeFn but missing depsFn. Computed subscriptions must specify their dependencies.`,
      );
      return;
    }
    clearRootSubSourceForRuntime(runtime, id);
    registerHandlerForRuntime(runtime, SUB_HANDLER_KIND, id, computeFn);
    registerHandlerForRuntime(runtime, SUB_DEPS_HANDLER_KIND, id, depsFn);
  }

  // Re-registration replaces the complete definition, including its config.
  const normalizedConfig = normalizeSubConfig(id, config);
  if (normalizedConfig) {
    setSubConfigForRuntime(runtime, id, normalizedConfig);
  } else {
    clearSubConfigsForRuntime(runtime, id);
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

function registerRootSubscription(runtime: RuntimeScope, id: Id, sourceKey: string): boolean {
  const conflictingSubId = getRootSubIdBySourceForRuntime(runtime, sourceKey);
  if (conflictingSubId !== undefined && conflictingSubId !== id) {
    consoleLog(
      'error',
      `[reflex] Subscription '${id}' was not registered. Root key '${sourceKey}' is already used by subscription '${conflictingSubId}'.`,
    );
    return false;
  }

  setRootSubSourceForRuntime(runtime, id, sourceKey);
  // Root handlers read the last flushed generation so new and cached queries
  // cannot observe different DB versions between an event and its flush.
  registerHandlerForRuntime(
    runtime,
    SUB_HANDLER_KIND,
    id,
    () => getRenderDbForRuntime<Record<string, any>>(runtime)[sourceKey],
  );
  registerHandlerForRuntime(runtime, SUB_DEPS_HANDLER_KIND, id, () => []);
  return true;
}
