import { scheduleAfterRender } from '../../core/scheduling';
import { getGlobalEqualityCheck } from '../../core/equality';
import { consoleLog } from '../../core/logging';
import { mergeRuntimeProbeSpan, withRuntimeProbeSpan } from '../probe';
import { SUB_DEPS_HANDLER_KIND, SUB_HANDLER_KIND, SUBSCRIPTION_HANDLER_KINDS } from '../handlers';
import { isRuntimeDisposed, type RuntimeCore } from '../core';
import { SubscriptionEngine } from './engine';
import { getRootSubKey, getSubVectorKey } from './keys';
import { normalizeSubscriptionConfig } from './validation';

import type { RuntimeProbeSubscription } from '../probe-types';
import type { RegistrationOwnership } from '../handler-types';
import type { SubscriptionDiagnostic, SubscriptionListenerKind, SubscriptionNode } from './types';
import type {
  EqualityCheckFn,
  Id,
  SubConfig,
  SubDepsHandler,
  SubHandler,
  SubResult,
  SubVector,
} from '../../types';

interface SubscriptionBuildFrame {
  subVector: SubVector;
  key: string;
  subId: Id;
  computeFn: SubHandler;
  params: any[];
  kind: 'root' | 'computed';
  equalityCheck: EqualityCheckFn;
  dependencyVectors: SubVector[];
  dependencies: SubscriptionNode<any>[];
  dependencyKeys: string[];
  nextDependency: number;
}

interface SubscriptionEntry {
  node: SubscriptionNode<any>;
  subId: Id;
  dependencyKeys: readonly string[];
}

export class SubscriptionRuntime {
  readonly rootSubIdBySource: Map<string, Id>;
  readonly rootSubSourceById: Map<Id, string>;
  readonly rootSubscriptionKeys: Set<string>;
  readonly subscriptionCache: Map<string, SubscriptionEntry>;
  readonly dependentSubscriptionKeys: Map<string, Set<string>>;
  readonly subConfigById: Map<Id, SubConfig>;
  provisionalCurrent: Map<string, SubscriptionNode<any>>;
  provisionalPrevious: Map<string, SubscriptionNode<any>>;
  provisionalSweepScheduled: boolean;
  equalityCheck: EqualityCheckFn | undefined;

  readonly engine: SubscriptionEngine;
  private readonly getRuntime: () => RuntimeCore;

  constructor(getRuntime: () => RuntimeCore) {
    this.getRuntime = getRuntime;
    this.rootSubIdBySource = new Map();
    this.rootSubSourceById = new Map();
    this.rootSubscriptionKeys = new Set();
    this.subscriptionCache = new Map();
    this.dependentSubscriptionKeys = new Map();
    this.subConfigById = new Map();
    this.provisionalCurrent = new Map();
    this.provisionalPrevious = new Map();
    this.provisionalSweepScheduled = false;
    this.equalityCheck = undefined;
    this.engine = new SubscriptionEngine(getRuntime);
  }

  register<R = any, K extends Id = Id>(
    id: K,
    computeFn?: ((...values: any[]) => SubResult<K, R>) | string,
    depsFn?: (...params: any[]) => SubVector[],
    config?: SubConfig,
  ): RegistrationOwnership | undefined {
    const runtime = this.getRuntime();
    if (this.hasCachedId(id)) {
      const message = `[reflex] Cannot register subscription '${id}' while a cached query for that id exists. Clear unused subscriptions before re-registering it.`;
      consoleLog('error', message);
      throw new Error(message);
    }
    if (runtime.registry.has(SUB_HANDLER_KIND, id)) {
      consoleLog('warn', `[reflex] Overriding. Subscription '${id}' already registered.`);
    }

    let handlers: readonly [RegistrationOwnership, RegistrationOwnership] | undefined;
    if (computeFn === undefined) {
      handlers = this.registerRoot(id, id);
    } else if (typeof computeFn === 'string') {
      handlers = this.registerRoot(id, computeFn);
    } else {
      if (!depsFn) {
        consoleLog(
          'error',
          `[reflex] Subscription '${id}' has computeFn but missing depsFn. Computed subscriptions must specify their dependencies.`,
        );
        return undefined;
      }
      this.clearRootSource(id);
      handlers = [
        runtime.registry.register(SUB_HANDLER_KIND, id, computeFn),
        runtime.registry.register(SUB_DEPS_HANDLER_KIND, id, depsFn),
      ];
    }
    if (!handlers) return undefined;

    const normalizedConfig = normalizeSubscriptionConfig(id, config);
    if (normalizedConfig) this.subConfigById.set(id, normalizedConfig);
    else this.subConfigById.delete(id);

    const [computeOwnership, depsOwnership] = handlers;
    const isCurrent = () => computeOwnership.current && depsOwnership.current;
    const assertReleasable = (): void => {
      if (isCurrent()) this.assertDefinitionCanBeCleared(id);
    };
    const release = (): boolean => {
      if (!isCurrent()) return false;
      this.assertDefinitionCanBeCleared(id);
      this.clearDefinitions(id);
      return true;
    };
    return Object.freeze({
      get current(): boolean {
        return isCurrent();
      },
      assertReleasable,
      release,
    });
  }

  getOrCreate(subVector: SubVector): SubscriptionNode<any> | null {
    const runtime = this.getRuntime();
    const frames: SubscriptionBuildFrame[] = [];
    const buildingKeys = new Set<string>();

    const resolve = (query: SubVector): SubscriptionNode<any> | undefined => {
      const subId = query[0];
      if (!runtime.registry.has(SUB_HANDLER_KIND, subId)) {
        consoleLog('error', `[reflex] no sub handler registered for: ${subId}`);
        return undefined;
      }

      const rootSource = this.rootSubSourceById.get(subId);
      if (rootSource !== undefined && query.length !== 1) {
        throw new Error(`[reflex] Root subscription '${subId}' does not accept parameters.`);
      }

      const key = getSubVectorKey(query);
      const existing = this.subscriptionCache.get(key)?.node;
      if (existing) {
        this.renewProvisionalTree(key);
        mergeRuntimeProbeSpan(runtime, () => ({
          'cached?': true,
          subscriptionKey: key,
        }));
        return existing;
      }
      if (buildingKeys.has(key)) {
        throw new Error(`[reflex] Circular subscription dependency detected at ${key}.`);
      }

      const params = query.length > 1 ? query.slice(1) : [];
      const depsFn = runtime.registry.get(SUB_DEPS_HANDLER_KIND, subId) as SubDepsHandler;
      if (typeof depsFn !== 'function') {
        throw new Error(`[reflex] Subscription '${subId}' has no dependency handler.`);
      }
      const dependencyVectors = depsFn(...(params as any[]));
      if (!Array.isArray(dependencyVectors)) {
        throw new Error(
          `[reflex] Subscription '${subId}' dependency handler must return an array.`,
        );
      }
      for (const dependencyVector of dependencyVectors) {
        if (!Array.isArray(dependencyVector) || typeof dependencyVector[0] !== 'string') {
          throw new Error(
            `[reflex] Subscription '${subId}' returned an invalid dependency vector.`,
          );
        }
      }

      withRuntimeProbeSpan(
        runtime,
        () => ({ operation: subId, opType: 'sub/create', tags: { queryV: query } }),
        () => {},
      );
      buildingKeys.add(key);
      frames.push({
        subVector: query,
        key,
        subId,
        computeFn: runtime.registry.get(SUB_HANDLER_KIND, subId) as SubHandler,
        params,
        kind: rootSource === undefined ? 'computed' : 'root',
        equalityCheck:
          this.subConfigById.get(subId)?.equalityCheck ?? getGlobalEqualityCheck(runtime),
        dependencyVectors,
        dependencies: [],
        dependencyKeys: [],
        nextDependency: 0,
      });
      return undefined;
    };

    const initial = resolve(subVector);
    if (initial) return initial;
    if (frames.length === 0) return null;

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.nextDependency < frame.dependencyVectors.length) {
        const dependencyVector = frame.dependencyVectors[frame.nextDependency++]!;
        const depth = frames.length;
        const dependency = resolve(dependencyVector);
        if (dependency) {
          frame.dependencies.push(dependency);
          frame.dependencyKeys.push(getSubVectorKey(dependencyVector));
        } else if (frames.length === depth) {
          throw new Error(
            `[reflex] Subscription '${frame.subId}' depends on missing subscription '${dependencyVector[0]}'.`,
          );
        }
        continue;
      }

      const {
        key,
        subVector: query,
        kind,
        computeFn,
        params,
        equalityCheck,
        dependencies,
        dependencyKeys,
        subId,
      } = frame;
      const subscription: SubscriptionNode<any> = this.engine.create({
        key,
        query,
        kind,
        compute: (...dependencyValues) =>
          params.length > 0
            ? computeFn(...dependencyValues, ...params)
            : computeFn(...dependencyValues),
        dependencies,
        equalityCheck,
        onActive: () => this.unmarkProvisional(key, subscription),
        onUnused: () => this.evict(key, subscription),
      });
      this.cache(key, subscription, subId, dependencyKeys);
      if (kind === 'computed') this.markProvisional(key, subscription);

      frames.pop();
      buildingKeys.delete(key);
      const parent = frames[frames.length - 1];
      if (!parent) return subscription;
      parent.dependencies.push(subscription);
      parent.dependencyKeys.push(key);
    }

    throw new Error(
      '[reflex] Invariant violation: subscription graph construction ended without producing a subscription.',
    );
  }

  read<T>(query: SubVector): T {
    const subscription = this.getOrCreate(query);
    return subscription ? this.engine.read(subscription) : (undefined as T);
  }

  getSnapshot<T>(node: SubscriptionNode<T>): T {
    return this.engine.getSnapshot(node);
  }

  subscribe<T>(
    node: SubscriptionNode<T>,
    listener: () => void,
    label?: string,
    kind?: SubscriptionListenerKind,
  ): () => void {
    return this.engine.subscribe(node, listener, label, kind);
  }

  publish(
    roots: SubscriptionNode<any>[],
    includeEvidence: boolean = false,
  ): readonly RuntimeProbeSubscription[] {
    return this.engine.publish(roots, includeEvidence);
  }

  inspect(node: SubscriptionNode<any>): SubscriptionDiagnostic {
    return this.engine.inspect(node);
  }

  diagnostics(): readonly SubscriptionDiagnostic[] {
    return Array.from(this.subscriptionCache.values(), ({ node }) => this.engine.inspect(node));
  }

  getCached(key: string): SubscriptionNode<any> | undefined {
    return this.subscriptionCache.get(key)?.node;
  }

  getRootId(sourceKey: string): Id | undefined {
    return this.rootSubIdBySource.get(sourceKey);
  }

  hasCached(key: string): boolean {
    return this.subscriptionCache.has(key);
  }

  hasCachedId(subId: Id): boolean {
    for (const entry of this.subscriptionCache.values()) {
      if (entry.subId === subId) return true;
    }
    return false;
  }

  clearCache(key?: string): void {
    this.engine.assertClearAllowed();
    this.clearCacheEntries(key);
  }

  clearAll(): void {
    this.engine.assertClearAllowed();
    this.clearDefinitions();
  }

  clearForHotReload(subscriptionIds?: readonly Id[]): void {
    if (subscriptionIds === undefined) {
      this.clearDefinitions();
      return;
    }
    for (const id of new Set(subscriptionIds)) this.clearDefinitions(id);
  }

  clearDefinitions(subId?: Id): void {
    const runtime = this.getRuntime();
    if (subId === undefined) {
      for (const kind of SUBSCRIPTION_HANDLER_KINDS) runtime.registry.clear(kind);
      this.rootSubIdBySource.clear();
      this.rootSubSourceById.clear();
      this.rootSubscriptionKeys.clear();
      this.clearCacheEntries();
      this.subConfigById.clear();
      return;
    }
    for (const kind of SUBSCRIPTION_HANDLER_KINDS) runtime.registry.clear(kind, subId);
    this.clearRootSource(subId);
    const keys: string[] = [];
    for (const [key, entry] of this.subscriptionCache) {
      if (entry.subId === subId) keys.push(key);
    }
    this.removeCacheClosure(keys);
    this.subConfigById.delete(subId);
  }

  assertDefinitionCanBeCleared(subId: Id): void {
    const definitionKeys: string[] = [];
    for (const [key, entry] of this.subscriptionCache) {
      if (entry.subId === subId) definitionKeys.push(key);
    }
    const affectedKeys = this.collectCacheClosureKeys(definitionKeys);
    for (const key of affectedKeys) {
      const node = this.subscriptionCache.get(key)?.node;
      if (node && this.engine.inspect(node).active) {
        throw new Error(
          `[reflex] Cannot clear subscription '${subId}' while its subscription graph is active.`,
        );
      }
    }
  }

  assertClearAllowed(): void {
    this.engine.assertClearAllowed();
  }

  assertPublicationAllowed(): void {
    this.engine.assertPublicationAllowed();
  }

  private registerRoot(
    id: Id,
    sourceKey: string,
  ): readonly [RegistrationOwnership, RegistrationOwnership] | undefined {
    const runtime = this.getRuntime();
    const conflictingSubId = this.rootSubIdBySource.get(sourceKey);
    if (conflictingSubId !== undefined && conflictingSubId !== id) {
      consoleLog(
        'error',
        `[reflex] Subscription '${id}' was not registered. Root key '${sourceKey}' is already used by subscription '${conflictingSubId}'.`,
      );
      return undefined;
    }

    this.setRootSource(id, sourceKey);
    return [
      runtime.registry.register(
        SUB_HANDLER_KIND,
        id,
        () => runtime.state.getRender<Record<string, any>>()[sourceKey],
      ),
      runtime.registry.register(SUB_DEPS_HANDLER_KIND, id, () => []),
    ];
  }

  setRootSource(subId: Id, sourceKey: string): void {
    const previousSource = this.rootSubSourceById.get(subId);
    if (
      previousSource !== undefined &&
      previousSource !== sourceKey &&
      this.rootSubIdBySource.get(previousSource) === subId
    ) {
      this.rootSubIdBySource.delete(previousSource);
    }
    const previousSubId = this.rootSubIdBySource.get(sourceKey);
    if (previousSubId !== undefined && previousSubId !== subId) {
      this.rootSubSourceById.delete(previousSubId);
      this.rootSubscriptionKeys.delete(getRootSubKey(previousSubId));
    }
    this.rootSubIdBySource.set(sourceKey, subId);
    this.rootSubSourceById.set(subId, sourceKey);
    this.rootSubscriptionKeys.add(getRootSubKey(subId));
  }

  private clearRootSource(subId: Id): void {
    const sourceKey = this.rootSubSourceById.get(subId);
    this.rootSubSourceById.delete(subId);
    this.rootSubscriptionKeys.delete(getRootSubKey(subId));
    if (sourceKey !== undefined && this.rootSubIdBySource.get(sourceKey) === subId) {
      this.rootSubIdBySource.delete(sourceKey);
    }
  }

  private cache(
    key: string,
    node: SubscriptionNode<any>,
    subId: Id,
    dependencyKeys: readonly string[],
  ): void {
    if (this.subscriptionCache.has(key)) {
      throw new Error(
        `[reflex] Subscription cache invariant violated: duplicate canonical key ${key}.`,
      );
    }
    const ownedDependencyKeys = [...dependencyKeys];
    this.subscriptionCache.set(key, {
      node,
      subId,
      dependencyKeys: ownedDependencyKeys,
    });
    for (const dependencyKey of new Set(ownedDependencyKeys)) {
      const dependents = this.dependentSubscriptionKeys.get(dependencyKey) ?? new Set<string>();
      dependents.add(key);
      this.dependentSubscriptionKeys.set(dependencyKey, dependents);
    }
  }

  private evict(key: string, node: SubscriptionNode<any>): void {
    if (this.rootSubscriptionKeys.has(key) || this.subscriptionCache.get(key)?.node !== node) {
      return;
    }
    this.removeCacheClosure([key]);
  }

  private markProvisional(key: string, node: SubscriptionNode<any>): void {
    if (this.rootSubscriptionKeys.has(key)) return;
    this.provisionalCurrent.set(key, node);
    this.scheduleProvisionalSweep();
  }

  private unmarkProvisional(key: string, node: SubscriptionNode<any>): void {
    if (this.provisionalCurrent.get(key) === node) this.provisionalCurrent.delete(key);
    if (this.provisionalPrevious.get(key) === node) this.provisionalPrevious.delete(key);
  }

  private renewProvisionalTree(key: string): void {
    const pendingKeys = [key];
    const visited = new Set<string>();
    let renewed = false;
    while (pendingKeys.length > 0) {
      const pendingKey = pendingKeys.pop()!;
      if (visited.has(pendingKey)) continue;
      visited.add(pendingKey);
      const entry = this.subscriptionCache.get(pendingKey);
      if (!entry) continue;
      const isCurrent = this.provisionalCurrent.get(pendingKey) === entry.node;
      const isPrevious = this.provisionalPrevious.get(pendingKey) === entry.node;
      if (!isCurrent && !isPrevious) continue;
      if (isPrevious) {
        this.provisionalPrevious.delete(pendingKey);
        this.provisionalCurrent.set(pendingKey, entry.node);
        renewed = true;
      }
      for (const dependencyKey of entry.dependencyKeys) pendingKeys.push(dependencyKey);
    }
    if (renewed) this.scheduleProvisionalSweep();
  }

  sweepProvisional(): void {
    const expiredKeys: string[] = [];
    for (const [key, subscription] of this.provisionalPrevious) {
      if (this.subscriptionCache.get(key)?.node === subscription) expiredKeys.push(key);
    }
    this.removeCacheClosure(expiredKeys);
    this.provisionalPrevious = this.provisionalCurrent;
    this.provisionalCurrent = new Map();
    if (this.provisionalPrevious.size > 0) this.scheduleProvisionalSweep();
  }

  private scheduleProvisionalSweep(): void {
    if (this.provisionalSweepScheduled) return;
    this.provisionalSweepScheduled = true;
    scheduleAfterRender(() => {
      this.provisionalSweepScheduled = false;
      if (isRuntimeDisposed(this.getRuntime())) return;
      this.sweepProvisional();
    });
  }

  private clearCacheEntries(key?: string): void {
    if (key === undefined) {
      this.subscriptionCache.clear();
      this.dependentSubscriptionKeys.clear();
      this.provisionalCurrent.clear();
      this.provisionalPrevious.clear();
      return;
    }
    this.removeCacheClosure([key]);
  }

  private removeCacheClosure(initialKeys: Iterable<string>): void {
    const keysToRemove = this.collectCacheClosureKeys(initialKeys);
    for (const key of keysToRemove) {
      const entry = this.subscriptionCache.get(key);
      if (entry) {
        this.subscriptionCache.delete(key);
        for (const dependencyKey of new Set(entry.dependencyKeys)) {
          const dependents = this.dependentSubscriptionKeys.get(dependencyKey);
          dependents?.delete(key);
          if (dependents?.size === 0) this.dependentSubscriptionKeys.delete(dependencyKey);
        }
      }
      this.dependentSubscriptionKeys.delete(key);
      this.provisionalCurrent.delete(key);
      this.provisionalPrevious.delete(key);
    }
  }

  private collectCacheClosureKeys(initialKeys: Iterable<string>): Set<string> {
    const keys = new Set<string>();
    const pendingKeys = Array.from(initialKeys);
    while (pendingKeys.length > 0) {
      const key = pendingKeys.pop()!;
      if (keys.has(key)) continue;
      keys.add(key);
      for (const dependentKey of this.dependentSubscriptionKeys.get(key) ?? []) {
        pendingKeys.push(dependentKey);
      }
    }
    return keys;
  }
}
