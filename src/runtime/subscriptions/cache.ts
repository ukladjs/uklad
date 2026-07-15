import { scheduleAfterRender } from '../../core/scheduling';
import { clearHandlerEntries, SUBSCRIPTION_HANDLER_KINDS } from '../handlers';
import {
  assertSubscriptionsCanBeCleared,
  inspectSubscription,
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

const rootSubIdBySource = new Map<string, Id>();
const rootSubSourceById = new Map<Id, string>();
const rootSubscriptionKeys = new Set<string>();

const subscriptionCache = new Map<string, SubscriptionEntry>();
const dependentSubscriptionKeys = new Map<string, Set<string>>();
const subConfigById = new Map<Id, SubConfig>();

let provisionalCurrent = new Map<string, SubscriptionNode<any>>();
let provisionalPrevious = new Map<string, SubscriptionNode<any>>();
let provisionalSweepScheduled = false;

// Root source metadata

export function setRootSubSource(subId: Id, sourceKey: string): void {
  const previousSource = rootSubSourceById.get(subId);
  if (
    previousSource !== undefined &&
    previousSource !== sourceKey &&
    rootSubIdBySource.get(previousSource) === subId
  ) {
    rootSubIdBySource.delete(previousSource);
  }

  const previousSubId = rootSubIdBySource.get(sourceKey);
  if (previousSubId !== undefined && previousSubId !== subId) {
    rootSubSourceById.delete(previousSubId);
    rootSubscriptionKeys.delete(getRootSubKey(previousSubId));
  }

  rootSubIdBySource.set(sourceKey, subId);
  rootSubSourceById.set(subId, sourceKey);
  rootSubscriptionKeys.add(getRootSubKey(subId));
}

export function getRootSubIdBySource(sourceKey: string): Id | undefined {
  return rootSubIdBySource.get(sourceKey);
}

export function getRootSubSourceById(subId: Id): string | undefined {
  return rootSubSourceById.get(subId);
}

export function clearRootSubSource(subId: Id): void {
  const sourceKey = rootSubSourceById.get(subId);
  rootSubSourceById.delete(subId);
  rootSubscriptionKeys.delete(getRootSubKey(subId));
  if (sourceKey !== undefined && rootSubIdBySource.get(sourceKey) === subId) {
    rootSubIdBySource.delete(sourceKey);
  }
}

function clearRootSubSources(): void {
  rootSubIdBySource.clear();
  rootSubSourceById.clear();
  rootSubscriptionKeys.clear();
}

// Canonical query cache

export function getCachedSubscription(key: string): SubscriptionNode<any> | undefined {
  return subscriptionCache.get(key)?.node;
}

export function cacheSubscription(
  key: string,
  subscription: SubscriptionNode<any>,
  subId: Id,
  dependencyKeys: readonly string[],
): void {
  if (subscriptionCache.has(key)) {
    throw new Error(
      `[reflex] Subscription cache invariant violated: duplicate canonical key ${key}.`,
    );
  }

  const ownedDependencyKeys = [...dependencyKeys];
  subscriptionCache.set(key, { node: subscription, subId, dependencyKeys: ownedDependencyKeys });
  for (const dependencyKey of new Set(ownedDependencyKeys)) {
    const dependents = dependentSubscriptionKeys.get(dependencyKey) ?? new Set<string>();
    dependents.add(key);
    dependentSubscriptionKeys.set(dependencyKey, dependents);
  }
}

/** @internal Exposed for focused cache lifecycle tests. */
export function hasCachedSubscription(key: string): boolean {
  return subscriptionCache.has(key);
}

export function hasCachedSubscriptionForId(subId: Id): boolean {
  for (const entry of subscriptionCache.values()) {
    if (entry.subId === subId) return true;
  }
  return false;
}

/** Return cache-only diagnostics without exposing runtime-owned nodes. */
export function getSubscriptionDiagnostics(): readonly SubscriptionDiagnostic[] {
  return Array.from(subscriptionCache.values(), ({ node }) => inspectSubscription(node));
}

export function clearSubscriptionCache(): void;
export function clearSubscriptionCache(key: string): void;
export function clearSubscriptionCache(key?: string): void {
  assertSubscriptionsCanBeCleared();
  clearSubscriptionCacheEntries(key);
}

/** Clear cache state after the caller has enforced lifecycle safety. */
function clearSubscriptionCacheEntries(key?: string): void {
  if (key === undefined) {
    subscriptionCache.clear();
    dependentSubscriptionKeys.clear();
    provisionalCurrent.clear();
    provisionalPrevious.clear();
    return;
  }
  removeSubscriptionCacheClosure([key]);
}

function clearSubscriptionCacheEntriesForId(subId: Id): void {
  const keys: string[] = [];
  for (const [key, entry] of subscriptionCache) {
    if (entry.subId === subId) keys.push(key);
  }
  removeSubscriptionCacheClosure(keys);
}

/** Remove entries and every cached parent that transitively depends on them. */
function removeSubscriptionCacheClosure(initialKeys: Iterable<string>): void {
  const keysToRemove = new Set<string>();
  const pendingKeys = Array.from(initialKeys);

  while (pendingKeys.length > 0) {
    const key = pendingKeys.pop()!;
    if (keysToRemove.has(key)) continue;
    keysToRemove.add(key);
    for (const dependentKey of dependentSubscriptionKeys.get(key) ?? []) {
      pendingKeys.push(dependentKey);
    }
  }

  for (const key of keysToRemove) {
    const entry = subscriptionCache.get(key);
    if (entry) {
      subscriptionCache.delete(key);
      for (const dependencyKey of new Set(entry.dependencyKeys)) {
        const dependents = dependentSubscriptionKeys.get(dependencyKey);
        dependents?.delete(key);
        if (dependents?.size === 0) dependentSubscriptionKeys.delete(dependencyKey);
      }
    }
    dependentSubscriptionKeys.delete(key);
    provisionalCurrent.delete(key);
    provisionalPrevious.delete(key);
  }
}

/** Remove an unused computed cell without evicting persistent root cells. */
export function evictCachedSubscription(key: string, subscription: SubscriptionNode<any>): void {
  if (rootSubscriptionKeys.has(key) || subscriptionCache.get(key)?.node !== subscription) return;
  removeSubscriptionCacheClosure([key]);
}

// Provisional lifetime

function scheduleProvisionalSweep(): void {
  if (provisionalSweepScheduled) return;
  provisionalSweepScheduled = true;
  scheduleAfterRender(() => {
    provisionalSweepScheduled = false;
    sweepProvisionalSubscriptions();
  });
}

export function markProvisionalSubscription(
  key: string,
  subscription: SubscriptionNode<any>,
): void {
  // Root cells are persistent DB wake-up anchors, even without observers.
  if (rootSubscriptionKeys.has(key)) return;
  provisionalCurrent.set(key, subscription);
  scheduleProvisionalSweep();
}

export function unmarkProvisionalSubscription(
  key: string,
  subscription: SubscriptionNode<any>,
): void {
  if (provisionalCurrent.get(key) === subscription) provisionalCurrent.delete(key);
  if (provisionalPrevious.get(key) === subscription) provisionalPrevious.delete(key);
}

/** Renew the complete dormant dependency component reached from a cache hit. */
export function renewProvisionalSubscriptionTree(rootKey: string): void {
  const pendingKeys = [rootKey];
  const visited = new Set<string>();
  let renewed = false;

  while (pendingKeys.length > 0) {
    const key = pendingKeys.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const entry = subscriptionCache.get(key);
    if (!entry) continue;

    const isCurrent = provisionalCurrent.get(key) === entry.node;
    const isPrevious = provisionalPrevious.get(key) === entry.node;
    if (!isCurrent && !isPrevious) continue;
    if (isPrevious) {
      provisionalPrevious.delete(key);
      provisionalCurrent.set(key, entry.node);
      renewed = true;
    }
    for (const dependencyKey of entry.dependencyKeys) pendingKeys.push(dependencyKey);
  }

  if (renewed) scheduleProvisionalSweep();
}

/** @internal Advance the provisional lease generation in lifecycle tests. */
export function sweepProvisionalSubscriptions(): void {
  const expiredKeys: string[] = [];
  for (const [key, subscription] of provisionalPrevious) {
    if (subscriptionCache.get(key)?.node === subscription) expiredKeys.push(key);
  }
  removeSubscriptionCacheClosure(expiredKeys);
  provisionalPrevious = provisionalCurrent;
  provisionalCurrent = new Map();
  if (provisionalPrevious.size > 0) scheduleProvisionalSweep();
}

// Subscription configuration and reset coordination

export function getSubConfig(subId: Id): SubConfig | undefined {
  return subConfigById.get(subId);
}

export function setSubConfig(subId: Id, config: SubConfig): void {
  subConfigById.set(subId, config);
}

export function clearSubConfigs(): void;
export function clearSubConfigs(subId: Id): void;
export function clearSubConfigs(subId?: Id): void {
  if (subId === undefined) subConfigById.clear();
  else subConfigById.delete(subId);
}

/** @internal Remove subscription definitions and all metadata derived from them. */
export function clearSubscriptionDefinitions(subId?: Id): void {
  if (subId === undefined) {
    for (const kind of SUBSCRIPTION_HANDLER_KINDS) clearHandlerEntries(kind);
    clearRootSubSources();
    clearSubscriptionCacheEntries();
    clearSubConfigs();
    return;
  }

  for (const kind of SUBSCRIPTION_HANDLER_KINDS) clearHandlerEntries(kind, subId);
  clearRootSubSource(subId);
  clearSubscriptionCacheEntriesForId(subId);
  clearSubConfigs(subId);
}

/** Clear every subscription definition and cached query. */
export function clearSubs(): void {
  assertSubscriptionsCanBeCleared();
  clearSubscriptionDefinitions();
}

/** @internal HMR immediately remounts the owning React tree after disposal. */
export function clearSubsForHotReload(): void {
  clearSubscriptionDefinitions();
}
