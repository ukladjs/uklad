import type { Id, EventHandler, EffectHandler, CoEffectHandler, Interceptor, ErrorHandler, SubHandler, SubDepsHandler, SubConfig } from './types';
import { consoleLog } from './loggers';
import {
    assertSubscriptionsCanBeCleared,
    inspectSubscription,
    type SubscriptionDiagnostic,
    type SubscriptionNode,
} from './subscription-runtime';
import { scheduleAfterRender } from './schedule';

type Kind = 'event' | 'fx' | 'cofx' | 'sub' | 'subDeps' | 'error';
type RegistryHandler = EventHandler | EffectHandler | CoEffectHandler | ErrorHandler | SubHandler | SubDepsHandler;

const kindToIdToHandler: Record<Kind, Record<string, RegistryHandler>> = {
    event: {}, fx: {}, cofx: {}, sub: {}, subDeps: {}, error: {}
};

export function getHandler<T extends RegistryHandler = RegistryHandler>
    (kind: Kind, id: Id): T | undefined {
    const handler = kindToIdToHandler[kind][id] as T | undefined;

    if (!handler) {
        consoleLog('error', `[reflex] no ${kind} handler registered for:`, id);
    }

    return handler;
}

export function getHandlers(): Record<Kind, Record<string, RegistryHandler>> {
    return kindToIdToHandler;
}

export function registerHandler<T extends RegistryHandler = RegistryHandler>
    (kind: Kind, id: Id, handlerFn: T): T {
    if (kindToIdToHandler[kind][id]) {
        consoleLog('warn', `[reflex] overwriting ${kind} handler for:`, id);
    }

    kindToIdToHandler[kind][id] = handlerFn;
    return handlerFn;
}

export function clearHandlers(): void;
export function clearHandlers(kind: Kind): void;
export function clearHandlers(kind: Kind, id: string): void;
export function clearHandlers(kind?: Kind, id?: string): void {
    if (kind == null || kind === 'sub' || kind === 'subDeps') assertSubscriptionsCanBeCleared();
    clearHandlerEntries(kind, id);
}

function clearHandlerEntries(kind?: Kind, id?: string): void {
    if (kind == null) {
        for (const k in kindToIdToHandler) {
            kindToIdToHandler[k as Kind] = {};
        }
        clearRootSubSources();
        clearSubscriptionCacheEntries();
    } else if (id == null) {
        if (!(kind in kindToIdToHandler)) {
            consoleLog('error', `[reflex] Unknown kind: ${kind}`);
            return;
        }
        kindToIdToHandler[kind] = {};
        if (kind === 'sub') {
            clearRootSubSources();
        }
        if (kind === 'sub' || kind === 'subDeps') {
            clearSubscriptionCacheEntries();
        }
    } else {
        if (!(kind in kindToIdToHandler)) {
            consoleLog('error', `[reflex] Unknown kind: ${kind}`);
            return;
        }
        if (kindToIdToHandler[kind][id]) {
            delete kindToIdToHandler[kind][id];
        } else {
            consoleLog('warn', `[reflex] can't clear ${kind} handler for ${id}. Handler not found.`);
        }
        if (kind === 'sub') clearRootSubSource(id);
        if (kind === 'sub' || kind === 'subDeps') clearSubscriptionCacheEntriesForId(id);
    }
}

export function hasHandler(kind: Kind, id: string): boolean {
    return !!kindToIdToHandler[kind][id];
}

// === Root Subscription Source Registry Functions ===
// Keep both directions so subscription creation can distinguish a root cell
// without asking the engine-owned node for implementation details.
const rootSubIdBySource = new Map<string, Id>();
const rootSubSourceById = new Map<Id, string>();
const rootSubscriptionKeys = new Set<string>();

export function setRootSubSource(subId: Id, sourceKey: string): void {
    const previousSource = rootSubSourceById.get(subId);
    if (previousSource !== undefined && previousSource !== sourceKey
        && rootSubIdBySource.get(previousSource) === subId) {
        rootSubIdBySource.delete(previousSource);
    }

    const previousSubId = rootSubIdBySource.get(sourceKey);
    if (previousSubId !== undefined && previousSubId !== subId) {
        rootSubSourceById.delete(previousSubId);
        rootSubscriptionKeys.delete(JSON.stringify([previousSubId]));
    }

    rootSubIdBySource.set(sourceKey, subId);
    rootSubSourceById.set(subId, sourceKey);
    rootSubscriptionKeys.add(JSON.stringify([subId]));
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
    rootSubscriptionKeys.delete(JSON.stringify([subId]));
    if (sourceKey !== undefined && rootSubIdBySource.get(sourceKey) === subId) {
        rootSubIdBySource.delete(sourceKey);
    }
}

export function clearRootSubSources(): void {
    rootSubIdBySource.clear();
    rootSubSourceById.clear();
    rootSubscriptionKeys.clear();
}

// === Subscription Cache Functions ===
interface SubscriptionEntry {
    node: SubscriptionNode<any>;
    subId: Id;
    dependencyKeys: string[];
}

const subscriptionCache = new Map<string, SubscriptionEntry>();
// Reverse cache edges make invalidation proportional to the removed subgraph.
// They are registry metadata only; the runtime still owns all live DAG edges.
const dependentSubscriptionKeys = new Map<string, Set<string>>();

export function getCachedSubscription(key: string): SubscriptionNode<any> | undefined {
    return subscriptionCache.get(key)?.node;
}

export function cacheSubscription(key: string, subscription: SubscriptionNode<any>, subId: Id, dependencyKeys: string[]): void {
    if (subscriptionCache.has(key)) {
        throw new Error(`[reflex] Subscription cache invariant violated: duplicate canonical key ${key}.`);
    }
    subscriptionCache.set(key, { node: subscription, subId, dependencyKeys });
    for (const dependencyKey of new Set(dependencyKeys)) {
        let dependents = dependentSubscriptionKeys.get(dependencyKey);
        if (!dependents) {
            dependents = new Set();
            dependentSubscriptionKeys.set(dependencyKey, dependents);
        }
        dependents.add(key);
    }
}

export function hasCachedSubscription(key: string): boolean {
    return subscriptionCache.has(key);
}

/** Public, cache-only diagnostics for devtools. Runtime nodes stay opaque. */
export function getSubscriptionDiagnostics(): readonly SubscriptionDiagnostic[] {
    return Array.from(subscriptionCache.values(), entry => inspectSubscription(entry.node));
}

export function hasCachedSubscriptionForId(subId: Id): boolean {
    for (const entry of subscriptionCache.values()) {
        if (entry.subId === subId) return true;
    }
    return false;
}

export function clearSubscriptionCache(): void
export function clearSubscriptionCache(key: string): void
export function clearSubscriptionCache(key?: string): void {
    assertSubscriptionsCanBeCleared();
    clearSubscriptionCacheEntries(key);
}

function clearSubscriptionCacheEntries(key?: string): void {
    if (key == null) {
        subscriptionCache.clear();
        dependentSubscriptionKeys.clear();
        provisionalCurrent.clear();
        provisionalPrevious.clear();
    } else {
        removeSubscriptionCacheClosure([key]);
    }
}

function clearSubscriptionCacheEntriesForId(subId: Id): void {
    const keys: string[] = [];
    for (const [key, entry] of subscriptionCache) {
        if (entry.subId === subId) keys.push(key);
    }
    removeSubscriptionCacheClosure(keys);
}

/** Remove keys and every cached parent that transitively depends on them. */
function removeSubscriptionCacheClosure(initialKeys: Iterable<string>): void {
    const keysToRemove = new Set<string>();
    const stack = Array.from(initialKeys);
    while (stack.length > 0) {
        const key = stack.pop()!;
        if (keysToRemove.has(key)) continue;
        keysToRemove.add(key);
        for (const dependentKey of dependentSubscriptionKeys.get(key) ?? []) {
            stack.push(dependentKey);
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
    if (rootSubscriptionKeys.has(key) || subscriptionCache.get(key)?.node !== subscription) {
        return;
    }
    removeSubscriptionCacheClosure([key]);
}

// === Provisional Subscriptions ===
// Subscription nodes are created lazily during render (getSnapshot), but a render may
// never commit (concurrent rendering, StrictMode, Suspense). Entries that
// were never watched or depended on cannot be disposed through the normal
// unwatch path, so they are tracked here and swept after surviving one full
// sweep cycle without going live. The sweep schedules itself from
// markProvisionalSubscription, independent of db updates, so entries created by
// an aborted render on an otherwise idle app are still cleaned up. Sweeping
// is always safe: a late subscriber re-creates the subscription through
// getOrCreateSubscription at the cost of a recompute.
let provisionalCurrent = new Map<string, SubscriptionNode<any>>();
let provisionalPrevious = new Map<string, SubscriptionNode<any>>();
let sweepScheduled = false;

function scheduleProvisionalSweep(): void {
    if (sweepScheduled) return;
    sweepScheduled = true;
    scheduleAfterRender(() => {
        sweepScheduled = false;
        sweepProvisionalSubscriptions();
    });
}

export function markProvisionalSubscription(key: string, subscription: SubscriptionNode<any>): void {
    // Canonical root cells are the db wake-up anchors and remain registered
    // even while nothing currently observes them.
    if (rootSubscriptionKeys.has(key)) return;
    provisionalCurrent.set(key, subscription);
    scheduleProvisionalSweep();
}

export function unmarkProvisionalSubscription(key: string, subscription: SubscriptionNode<any>): void {
    if (provisionalCurrent.get(key) === subscription) provisionalCurrent.delete(key);
    if (provisionalPrevious.get(key) === subscription) provisionalPrevious.delete(key);
}

/** Renew the complete dormant dependency component reached from a cache hit. */
export function renewProvisionalSubscriptionTree(rootKey: string): void {
    const stack = [rootKey];
    const visited = new Set<string>();
    let renewed = false;
    while (stack.length > 0) {
        const key = stack.pop()!;
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
        for (const dependencyKey of entry.dependencyKeys) stack.push(dependencyKey);
    }
    if (renewed) scheduleProvisionalSweep();
}

export function sweepProvisionalSubscriptions(): void {
    const expiredKeys: string[] = [];
    for (const [key, subscription] of provisionalPrevious) {
        if (subscriptionCache.get(key)?.node === subscription) {
            expiredKeys.push(key);
        }
    }
    removeSubscriptionCacheClosure(expiredKeys);
    provisionalPrevious = provisionalCurrent;
    provisionalCurrent = new Map();
    // Freshly promoted entries need one more cycle to be deleted
    if (provisionalPrevious.size > 0) {
        scheduleProvisionalSweep();
    }
}

export function clearSubs(): void {
    clearSubscriptionCache();
    clearHandlerEntries('sub');
    clearHandlerEntries('subDeps');
    clearSubConfigs();
}

/** @internal HMR immediately remounts the owning React tree after disposal. */
export function clearSubsForHotReload(): void {
    clearSubscriptionCacheEntries();
    clearHandlerEntries('sub');
    clearHandlerEntries('subDeps');
    clearSubConfigs();
}

// === Interceptor Registry Functions ===
const interceptorsRegistry = new Map<Id, Interceptor[]>();

export function getInterceptors(eventId: Id): Interceptor[] {
    return interceptorsRegistry.get(eventId) || [];
}

export function setInterceptors(eventId: Id, interceptors: Interceptor[]): void {
    interceptorsRegistry.set(eventId, interceptors);
}

export function hasInterceptors(eventId: Id): boolean {
    return interceptorsRegistry.has(eventId) && interceptorsRegistry.get(eventId)!.length > 0;
}

export function clearInterceptors(): void;
export function clearInterceptors(eventId: Id): void;
export function clearInterceptors(eventId?: Id): void {
    if (eventId == null) {
        interceptorsRegistry.clear();
    } else {
        interceptorsRegistry.delete(eventId);
    }
}

// === SubConfig Registry Functions ===
const subConfigRegistry = new Map<Id, SubConfig>();

export function getSubConfig(subId: Id): SubConfig | undefined {
    return subConfigRegistry.get(subId);
}

export function setSubConfig(subId: Id, config: SubConfig): void {
    subConfigRegistry.set(subId, config);
}

export function hasSubConfig(subId: Id): boolean {
    return subConfigRegistry.has(subId);
}

export function clearSubConfigs(): void;
export function clearSubConfigs(subId: Id): void;
export function clearSubConfigs(subId?: Id): void {
    if (subId == null) {
        subConfigRegistry.clear();
    } else {
        subConfigRegistry.delete(subId);
    }
}

export function clearAllRegistries(): void {
    clearHandlers();
    clearSubscriptionCache();
    clearInterceptors();
    clearSubConfigs();
}
