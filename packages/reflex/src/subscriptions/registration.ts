import { consoleLog } from '../core/logging';
import { getRenderStateForKernel } from '../runtime/state';
import {
  hasHandlerForKernel,
  registerHandlerForKernel,
  SUB_DEPS_HANDLER_KIND,
  SUB_HANDLER_KIND,
} from '../runtime/handlers';
import type { RuntimeKernel } from '../runtime/kernel';
import {
  clearRootSubSourceForKernel,
  clearSubConfigsForKernel,
  getRootSubIdBySourceForKernel,
  hasCachedSubscriptionForIdForKernel,
  setRootSubSourceForKernel,
  setSubConfigForKernel,
} from '../runtime/subscriptions/cache';

import type { Id, SubConfig, SubResult, SubVector } from '../types';

/**
 * Register a root or computed subscription.
 *
 * `regSub(id)` reads the top-level STATE key named by `id`; `regSub(id, key)`
 * maps a root subscription to another top-level key. Passing a compute function
 * requires a dependency function and optionally accepts a local equality check.
 * A registration cannot be replaced while one of its queries remains cached.
 *
 * When `SubPayloads` is augmented, the compute result is checked against the
 * declared result for `K`. Explicit result generics retain the legacy contract.
 */
/** @internal Register a root or computed subscription in one runtime. */
export function regSubForKernel<R = any, K extends Id = Id>(
  runtime: RuntimeKernel,
  id: K,
  computeFn?: ((...values: any[]) => SubResult<K, R>) | string,
  depsFn?: (...params: any[]) => SubVector[],
  config?: SubConfig,
): void {
  if (hasCachedSubscriptionForIdForKernel(runtime, id)) {
    const message = `[reflex] Cannot register subscription '${id}' while a cached query for that id exists. Clear unused subscriptions before re-registering it.`;
    consoleLog('error', message);
    throw new Error(message);
  }
  if (hasHandlerForKernel(runtime, SUB_HANDLER_KIND, id)) {
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
    clearRootSubSourceForKernel(runtime, id);
    registerHandlerForKernel(runtime, SUB_HANDLER_KIND, id, computeFn);
    registerHandlerForKernel(runtime, SUB_DEPS_HANDLER_KIND, id, depsFn);
  }

  // Re-registration replaces the complete definition, including its config.
  const normalizedConfig = normalizeSubConfig(id, config);
  if (normalizedConfig) {
    setSubConfigForKernel(runtime, id, normalizedConfig);
  } else {
    clearSubConfigsForKernel(runtime, id);
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

function registerRootSubscription(runtime: RuntimeKernel, id: Id, sourceKey: string): boolean {
  const conflictingSubId = getRootSubIdBySourceForKernel(runtime, sourceKey);
  if (conflictingSubId !== undefined && conflictingSubId !== id) {
    consoleLog(
      'error',
      `[reflex] Subscription '${id}' was not registered. Root key '${sourceKey}' is already used by subscription '${conflictingSubId}'.`,
    );
    return false;
  }

  setRootSubSourceForKernel(runtime, id, sourceKey);
  // Root handlers read the last flushed generation so new and cached queries
  // cannot observe different STATE versions between an event and its flush.
  registerHandlerForKernel(
    runtime,
    SUB_HANDLER_KIND,
    id,
    () => getRenderStateForKernel<Record<string, any>>(runtime)[sourceKey],
  );
  registerHandlerForKernel(runtime, SUB_DEPS_HANDLER_KIND, id, () => []);
  return true;
}
