import { scheduleAfterRender } from '../../core/scheduling';
import { clearHandlerEntriesForRuntime, SUBSCRIPTION_HANDLER_KINDS } from '../handlers';
import { isRuntimeDisposed, type RuntimeScope } from '../scope';
import {
  assertSubscriptionsCanBeClearedForRuntime,
  inspectSubscriptionForRuntime,
  type SubscriptionDiagnostic,
  type SubscriptionNode,
} from './engine';
import { getRootSubKey } from './keys';

import type { Id, SubConfig } from '../../types';

interface SubscriptionEntry {
  node: SubscriptionNode<any>;
  subId: Id;
  dependencyKeys: readonly string[];
}

export interface SubscriptionCacheState {
  readonly rootSubIdBySource: Map<string, Id>;
  readonly rootSubSourceById: Map<Id, string>;
  readonly rootSubscriptionKeys: Set<string>;
  readonly subscriptionCache: Map<string, SubscriptionEntry>;
  readonly dependentSubscriptionKeys: Map<string, Set<string>>;
  readonly subConfigById: Map<Id, SubConfig>;
  provisionalCurrent: Map<string, SubscriptionNode<any>>;
  provisionalPrevious: Map<string, SubscriptionNode<any>>;
  provisionalSweepScheduled: boolean;
}

function getCacheState(runtime: RuntimeScope): SubscriptionCacheState {
  return (runtime.subscriptionCache ??= {
    rootSubIdBySource: new Map(),
    rootSubSourceById: new Map(),
    rootSubscriptionKeys: new Set(),
    subscriptionCache: new Map(),
    dependentSubscriptionKeys: new Map(),
    subConfigById: new Map(),
    provisionalCurrent: new Map(),
    provisionalPrevious: new Map(),
    provisionalSweepScheduled: false,
  });
}

/** @internal Set root subscription metadata for one runtime. */
export function setRootSubSourceForRuntime(
  runtime: RuntimeScope,
  subId: Id,
  sourceKey: string,
): void {
  const state = getCacheState(runtime);
  const previousSource = state.rootSubSourceById.get(subId);
  if (
    previousSource !== undefined &&
    previousSource !== sourceKey &&
    state.rootSubIdBySource.get(previousSource) === subId
  ) {
    state.rootSubIdBySource.delete(previousSource);
  }

  const previousSubId = state.rootSubIdBySource.get(sourceKey);
  if (previousSubId !== undefined && previousSubId !== subId) {
    state.rootSubSourceById.delete(previousSubId);
    state.rootSubscriptionKeys.delete(getRootSubKey(previousSubId));
  }

  state.rootSubIdBySource.set(sourceKey, subId);
  state.rootSubSourceById.set(subId, sourceKey);
  state.rootSubscriptionKeys.add(getRootSubKey(subId));
}

/** @internal Get a root subscription id in one runtime. */
export function getRootSubIdBySourceForRuntime(
  runtime: RuntimeScope,
  sourceKey: string,
): Id | undefined {
  return getCacheState(runtime).rootSubIdBySource.get(sourceKey);
}

/** @internal Get a root source key in one runtime. */
export function getRootSubSourceByIdForRuntime(
  runtime: RuntimeScope,
  subId: Id,
): string | undefined {
  return getCacheState(runtime).rootSubSourceById.get(subId);
}

/** @internal Clear one runtime's root-source metadata for an id. */
export function clearRootSubSourceForRuntime(runtime: RuntimeScope, subId: Id): void {
  const state = getCacheState(runtime);
  const sourceKey = state.rootSubSourceById.get(subId);
  state.rootSubSourceById.delete(subId);
  state.rootSubscriptionKeys.delete(getRootSubKey(subId));
  if (sourceKey !== undefined && state.rootSubIdBySource.get(sourceKey) === subId) {
    state.rootSubIdBySource.delete(sourceKey);
  }
}

function clearRootSubSourcesForRuntime(runtime: RuntimeScope): void {
  const state = getCacheState(runtime);
  state.rootSubIdBySource.clear();
  state.rootSubSourceById.clear();
  state.rootSubscriptionKeys.clear();
}

/** @internal Get a cached subscription from one runtime. */
export function getCachedSubscriptionForRuntime(
  runtime: RuntimeScope,
  key: string,
): SubscriptionNode<any> | undefined {
  return getCacheState(runtime).subscriptionCache.get(key)?.node;
}

/** @internal Cache a subscription in one runtime. */
export function cacheSubscriptionForRuntime(
  runtime: RuntimeScope,
  key: string,
  subscription: SubscriptionNode<any>,
  subId: Id,
  dependencyKeys: readonly string[],
): void {
  const state = getCacheState(runtime);
  if (state.subscriptionCache.has(key)) {
    throw new Error(
      `[reflex] Subscription cache invariant violated: duplicate canonical key ${key}.`,
    );
  }

  const ownedDependencyKeys = [...dependencyKeys];
  state.subscriptionCache.set(key, {
    node: subscription,
    subId,
    dependencyKeys: ownedDependencyKeys,
  });
  for (const dependencyKey of new Set(ownedDependencyKeys)) {
    const dependents = state.dependentSubscriptionKeys.get(dependencyKey) ?? new Set<string>();
    dependents.add(key);
    state.dependentSubscriptionKeys.set(dependencyKey, dependents);
  }
}

/** @internal Test cache membership in one runtime. */
export function hasCachedSubscriptionForRuntime(runtime: RuntimeScope, key: string): boolean {
  return getCacheState(runtime).subscriptionCache.has(key);
}

/** @internal Test whether one runtime has a cached query for an id. */
export function hasCachedSubscriptionForIdForRuntime(runtime: RuntimeScope, subId: Id): boolean {
  for (const entry of getCacheState(runtime).subscriptionCache.values()) {
    if (entry.subId === subId) return true;
  }
  return false;
}

/** @internal Return cache-only diagnostics for one runtime. */
export function getSubscriptionDiagnosticsForRuntime(
  runtime: RuntimeScope,
): readonly SubscriptionDiagnostic[] {
  return Array.from(getCacheState(runtime).subscriptionCache.values(), ({ node }) =>
    inspectSubscriptionForRuntime(runtime, node),
  );
}

/** @internal Clear all or one cache key in a runtime. */
export function clearSubscriptionCacheForRuntime(runtime: RuntimeScope, key?: string): void {
  assertSubscriptionsCanBeClearedForRuntime(runtime);
  clearSubscriptionCacheEntriesForRuntime(runtime, key);
}

function clearSubscriptionCacheEntriesForRuntime(runtime: RuntimeScope, key?: string): void {
  const state = getCacheState(runtime);
  if (key === undefined) {
    state.subscriptionCache.clear();
    state.dependentSubscriptionKeys.clear();
    state.provisionalCurrent.clear();
    state.provisionalPrevious.clear();
    return;
  }
  removeSubscriptionCacheClosure(runtime, [key]);
}

function clearSubscriptionCacheEntriesForIdForRuntime(runtime: RuntimeScope, subId: Id): void {
  const keys: string[] = [];
  for (const [key, entry] of getCacheState(runtime).subscriptionCache) {
    if (entry.subId === subId) keys.push(key);
  }
  removeSubscriptionCacheClosure(runtime, keys);
}

function removeSubscriptionCacheClosure(
  runtime: RuntimeScope,
  initialKeys: Iterable<string>,
): void {
  const state = getCacheState(runtime);
  const keysToRemove = collectSubscriptionCacheClosureKeys(state, initialKeys);

  for (const key of keysToRemove) {
    const entry = state.subscriptionCache.get(key);
    if (entry) {
      state.subscriptionCache.delete(key);
      for (const dependencyKey of new Set(entry.dependencyKeys)) {
        const dependents = state.dependentSubscriptionKeys.get(dependencyKey);
        dependents?.delete(key);
        if (dependents?.size === 0) state.dependentSubscriptionKeys.delete(dependencyKey);
      }
    }
    state.dependentSubscriptionKeys.delete(key);
    state.provisionalCurrent.delete(key);
    state.provisionalPrevious.delete(key);
  }
}

function collectSubscriptionCacheClosureKeys(
  state: SubscriptionCacheState,
  initialKeys: Iterable<string>,
): Set<string> {
  const keys = new Set<string>();
  const pendingKeys = Array.from(initialKeys);

  while (pendingKeys.length > 0) {
    const key = pendingKeys.pop()!;
    if (keys.has(key)) continue;
    keys.add(key);
    for (const dependentKey of state.dependentSubscriptionKeys.get(key) ?? []) {
      pendingKeys.push(dependentKey);
    }
  }
  return keys;
}

/** @internal Assert that clearing one definition cannot detach an active graph. */
export function assertSubscriptionDefinitionCanBeClearedForRuntime(
  runtime: RuntimeScope,
  subId: Id,
): void {
  const state = getCacheState(runtime);
  const definitionKeys: string[] = [];
  for (const [key, entry] of state.subscriptionCache) {
    if (entry.subId === subId) definitionKeys.push(key);
  }

  const affectedKeys = collectSubscriptionCacheClosureKeys(state, definitionKeys);
  for (const key of affectedKeys) {
    const node = state.subscriptionCache.get(key)?.node;
    if (node && inspectSubscriptionForRuntime(runtime, node).active) {
      throw new Error(
        `[reflex] Cannot clear subscription '${subId}' while its subscription graph is active.`,
      );
    }
  }
}

/** @internal Evict an unused computed subscription from one runtime. */
export function evictCachedSubscriptionForRuntime(
  runtime: RuntimeScope,
  key: string,
  subscription: SubscriptionNode<any>,
): void {
  const state = getCacheState(runtime);
  if (
    state.rootSubscriptionKeys.has(key) ||
    state.subscriptionCache.get(key)?.node !== subscription
  ) {
    return;
  }
  removeSubscriptionCacheClosure(runtime, [key]);
}

function scheduleProvisionalSweepForRuntime(runtime: RuntimeScope): void {
  const state = getCacheState(runtime);
  if (state.provisionalSweepScheduled) return;
  state.provisionalSweepScheduled = true;
  scheduleAfterRender(() => {
    state.provisionalSweepScheduled = false;
    if (isRuntimeDisposed(runtime)) return;
    sweepProvisionalSubscriptionsForRuntime(runtime);
  });
}

/** @internal Mark a newly read computed subscription provisional in one runtime. */
export function markProvisionalSubscriptionForRuntime(
  runtime: RuntimeScope,
  key: string,
  subscription: SubscriptionNode<any>,
): void {
  const state = getCacheState(runtime);
  if (state.rootSubscriptionKeys.has(key)) return;
  state.provisionalCurrent.set(key, subscription);
  scheduleProvisionalSweepForRuntime(runtime);
}

/** @internal Remove a provisional mark in one runtime. */
export function unmarkProvisionalSubscriptionForRuntime(
  runtime: RuntimeScope,
  key: string,
  subscription: SubscriptionNode<any>,
): void {
  const state = getCacheState(runtime);
  if (state.provisionalCurrent.get(key) === subscription) state.provisionalCurrent.delete(key);
  if (state.provisionalPrevious.get(key) === subscription) state.provisionalPrevious.delete(key);
}

/** @internal Renew a dormant dependency component in one runtime. */
export function renewProvisionalSubscriptionTreeForRuntime(
  runtime: RuntimeScope,
  rootKey: string,
): void {
  const state = getCacheState(runtime);
  const pendingKeys = [rootKey];
  const visited = new Set<string>();
  let renewed = false;

  while (pendingKeys.length > 0) {
    const key = pendingKeys.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const entry = state.subscriptionCache.get(key);
    if (!entry) continue;

    const isCurrent = state.provisionalCurrent.get(key) === entry.node;
    const isPrevious = state.provisionalPrevious.get(key) === entry.node;
    if (!isCurrent && !isPrevious) continue;
    if (isPrevious) {
      state.provisionalPrevious.delete(key);
      state.provisionalCurrent.set(key, entry.node);
      renewed = true;
    }
    for (const dependencyKey of entry.dependencyKeys) pendingKeys.push(dependencyKey);
  }

  if (renewed) scheduleProvisionalSweepForRuntime(runtime);
}

/** @internal Advance one runtime's provisional lease generation. */
export function sweepProvisionalSubscriptionsForRuntime(runtime: RuntimeScope): void {
  const state = getCacheState(runtime);
  const expiredKeys: string[] = [];
  for (const [key, subscription] of state.provisionalPrevious) {
    if (state.subscriptionCache.get(key)?.node === subscription) expiredKeys.push(key);
  }
  removeSubscriptionCacheClosure(runtime, expiredKeys);
  state.provisionalPrevious = state.provisionalCurrent;
  state.provisionalCurrent = new Map();
  if (state.provisionalPrevious.size > 0) scheduleProvisionalSweepForRuntime(runtime);
}

/** @internal Get subscription configuration from one runtime. */
export function getSubConfigForRuntime(runtime: RuntimeScope, subId: Id): SubConfig | undefined {
  return getCacheState(runtime).subConfigById.get(subId);
}

/** @internal Set subscription configuration in one runtime. */
export function setSubConfigForRuntime(runtime: RuntimeScope, subId: Id, config: SubConfig): void {
  getCacheState(runtime).subConfigById.set(subId, config);
}

/** @internal Clear subscription configuration in one runtime. */
export function clearSubConfigsForRuntime(runtime: RuntimeScope, subId?: Id): void {
  const state = getCacheState(runtime);
  if (subId === undefined) state.subConfigById.clear();
  else state.subConfigById.delete(subId);
}

/** @internal Remove subscription definitions and metadata from one runtime. */
export function clearSubscriptionDefinitionsForRuntime(runtime: RuntimeScope, subId?: Id): void {
  if (subId === undefined) {
    for (const kind of SUBSCRIPTION_HANDLER_KINDS) {
      clearHandlerEntriesForRuntime(runtime, kind);
    }
    clearRootSubSourcesForRuntime(runtime);
    clearSubscriptionCacheEntriesForRuntime(runtime);
    clearSubConfigsForRuntime(runtime);
    return;
  }

  for (const kind of SUBSCRIPTION_HANDLER_KINDS) {
    clearHandlerEntriesForRuntime(runtime, kind, subId);
  }
  clearRootSubSourceForRuntime(runtime, subId);
  clearSubscriptionCacheEntriesForIdForRuntime(runtime, subId);
  clearSubConfigsForRuntime(runtime, subId);
}

/** @internal Clear every subscription definition and cached query in one runtime. */
export function clearSubsForRuntime(runtime: RuntimeScope): void {
  assertSubscriptionsCanBeClearedForRuntime(runtime);
  clearSubscriptionDefinitionsForRuntime(runtime);
}

/** @internal HMR-clear one runtime whose React tree is about to remount. */
export function clearSubsForHotReloadForRuntime(
  runtime: RuntimeScope,
  subscriptionIds?: readonly Id[],
): void {
  if (subscriptionIds === undefined) {
    clearSubscriptionDefinitionsForRuntime(runtime);
    return;
  }
  for (const subscriptionId of new Set(subscriptionIds)) {
    clearSubscriptionDefinitionsForRuntime(runtime, subscriptionId);
  }
}
