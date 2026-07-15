import {
  createSubscription,
  readSubscription,
  type SubscriptionKind,
  type SubscriptionNode,
} from './subscription-runtime';
import { consoleLog } from './loggers';
import type {
  SubVector,
  Id,
  SubHandler,
  SubDepsHandler,
  SubConfig,
  SubPayloads,
  SubParams,
  SubResult,
  SubscribeVector,
} from './types';
import {
  getCachedSubscription,
  cacheSubscription,
  evictCachedSubscription,
  hasCachedSubscriptionForId,
  markProvisionalSubscription,
  unmarkProvisionalSubscription,
  renewProvisionalSubscriptionTree,
  getHandler,
  registerHandler,
  hasHandler,
  setSubConfig,
  getSubConfig,
  clearSubConfigs,
  setRootSubSource,
  getRootSubIdBySource,
  getRootSubSourceById,
  clearRootSubSource,
} from './registrar';
import { getRenderDb } from './db';
import { mergeTrace, withTrace } from './trace';
import { getGlobalEqualityCheck } from './settings';
import { IS_DEV } from './env';

const KIND = 'sub';
const KIND_DEPS = 'subDeps';

function registerRootSub(id: Id, sourceKey: string): boolean {
  const conflictingSubId = getRootSubIdBySource(sourceKey);
  if (conflictingSubId !== undefined && conflictingSubId !== id) {
    consoleLog(
      'error',
      `[reflex] Subscription '${id}' was not registered. Root key '${sourceKey}' is already used by subscription '${conflictingSubId}'.`,
    );
    return false;
  }

  setRootSubSource(id, sourceKey);
  // Root subs read top-level keys dynamically; stay untyped so this
  // compiles when the app augments AppDb (no string index signature there).
  // They read the render generation (last flushed db), not the live db:
  // between an event's commit and the flush, new and cached subscriptions
  // must serve the same generation.
  registerHandler(KIND, id, () => getRenderDb<Record<string, any>>()[sourceKey]);
  registerHandler(KIND_DEPS, id, () => []);
  return true;
}

// When the app augments SubPayloads, the computeFn return value is checked
// against the declared result for K (undeclared ids fall back to R). K only
// infers a literal when R isn't passed explicitly; `regSub<Todo[]>(id, ...)`
// keeps its current behavior.
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
  if (hasHandler(KIND, id)) {
    consoleLog('warn', `[reflex] Overriding. Subscription '${id}' already registered.`);
  }

  if (computeFn === undefined) {
    if (!registerRootSub(id, id)) return;
  } else if (typeof computeFn === 'string') {
    if (!registerRootSub(id, computeFn as string)) return;
  } else {
    // Computed subscriptions require depsFn
    if (!depsFn) {
      consoleLog(
        'error',
        `[reflex] Subscription '${id}' has computeFn but missing depsFn. Computed subscriptions must specify their dependencies.`,
      );
      return;
    }
    clearRootSubSource(id);
    // Store computeFn and depsFn separately
    registerHandler(KIND, id, computeFn);
    registerHandler(KIND_DEPS, id, depsFn);
  }

  // Re-registration replaces the complete definition. In particular, an
  // omitted config must not retain an equality function from an older
  // registration of the same id.
  if (config) {
    setSubConfig(id, config);
  } else {
    clearSubConfigs(id);
  }
}

/**
 * Subscription cache keys are produced with JSON.stringify(subVector), so
 * values that don't survive JSON serialization — at any nesting depth — can
 * collide on one cache entry, silently go stale, or throw during key
 * generation:
 * - undefined, functions, Symbols: dropped or serialized to null (collisions)
 * - Map, Set, RegExp: serialize to "{}" (collisions)
 * - NaN, Infinity: serialize to null (collide with each other)
 * - BigInt, circular references: JSON.stringify throws
 * `visiting` tracks the current descent path (added before recursing into an
 * object, removed after) so circular structures are detected without flagging
 * shared non-circular references.
 */
function isNonSerializableValue(value: unknown, visiting: WeakSet<object>): boolean {
  if (value === undefined) return true;
  const type = typeof value;
  if (type === 'function' || type === 'symbol' || type === 'bigint') return true;
  if (type === 'number' && !Number.isFinite(value)) return true;
  if (value === null || type !== 'object') return false;
  if (value instanceof Map || value instanceof Set || value instanceof RegExp) return true;
  if (visiting.has(value)) return true; // circular: JSON.stringify would throw
  visiting.add(value);
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  const result = values.some((v) => isNonSerializableValue(v, visiting));
  visiting.delete(value);
  return result;
}

export function hasNonSerializableSubParam(params: readonly unknown[]): boolean {
  const visiting = new WeakSet<object>();
  return params.some((p) => isNonSerializableValue(p, visiting));
}

const warnedNonSerializableSubIds = new Set<Id>();

/**
 * Produce the canonical cache key for a subscription vector. All key
 * generation must go through here: dev validation runs before
 * JSON.stringify, so unserializable params (BigInt, circular structures)
 * warn with an actionable message before the native throw, and colliding
 * keys (two different Maps both stringifying to "{}") warn before the
 * registry lookup can return another vector's cached subscription.
 */
export function getSubVectorKey(subVector: SubVector): string {
  if (IS_DEV && subVector.length > 1) {
    const subId = subVector[0];
    if (!warnedNonSerializableSubIds.has(subId) && hasNonSerializableSubParam(subVector.slice(1))) {
      warnedNonSerializableSubIds.add(subId);
      consoleLog(
        'warn',
        `[reflex] subscription '${subId}' called with a param that does not survive JSON.stringify (undefined, function, Symbol, BigInt, Map, Set, RegExp, non-finite number or circular reference, possibly nested). Subscription cache keys are JSON-serialized, so such params can collide, return stale data, or throw. Pass plain serializable values (ids, strings, numbers) instead.`,
      );
    }
  }
  return JSON.stringify(subVector);
}

interface SubscriptionBuildFrame {
  subVector: SubVector;
  key: string;
  subId: Id;
  computeFn: SubHandler;
  params: any[];
  kind: SubscriptionKind;
  equalityCheck: (left: any, right: any) => boolean;
  dependencyVectors: SubVector[];
  dependencies: SubscriptionNode<any>[];
  dependencyKeys: string[];
  nextDependency: number;
}

/**
 * Return the canonical opaque subscription for a query vector. Computed
 * subscriptions have one terminal lifetime: after their last live consumer
 * releases them, a later lookup builds a fresh graph from the registry.
 */
export function getOrCreateSubscription(subVector: SubVector): SubscriptionNode<any> | null {
  const frames: SubscriptionBuildFrame[] = [];
  const buildingKeys = new Set<string>();

  const resolve = (query: SubVector): SubscriptionNode<any> | undefined => {
    const subId = query[0];
    if (!hasHandler(KIND, subId)) {
      consoleLog('error', `[reflex] no sub handler registered for: ${subId}`);
      return undefined;
    }

    const rootSource = getRootSubSourceById(subId);
    if (rootSource !== undefined && query.length !== 1) {
      throw new Error(`[reflex] Root subscription '${subId}' does not accept parameters.`);
    }

    const key = getSubVectorKey(query);
    const existing = getCachedSubscription(key);
    if (existing) {
      renewProvisionalSubscriptionTree(key);
      mergeTrace({ tags: { 'cached?': true, subscriptionKey: key } });
      return existing;
    }
    if (buildingKeys.has(key)) {
      throw new Error(`[reflex] Circular subscription dependency detected at ${key}.`);
    }

    const params = query.length > 1 ? query.slice(1) : [];
    const depsFn = getHandler(KIND_DEPS, subId) as SubDepsHandler;
    if (typeof depsFn !== 'function') {
      throw new Error(`[reflex] Subscription '${subId}' has no dependency handler.`);
    }
    const dependencyVectors = depsFn(...(params as any[]));
    if (!Array.isArray(dependencyVectors)) {
      throw new Error(`[reflex] Subscription '${subId}' dependency handler must return an array.`);
    }
    for (const dependencyVector of dependencyVectors) {
      if (!Array.isArray(dependencyVector) || typeof dependencyVector[0] !== 'string') {
        throw new Error(`[reflex] Subscription '${subId}' returned an invalid dependency vector.`);
      }
    }

    withTrace({ operation: subId, opType: 'sub/create', tags: { queryV: query } }, () => {});
    buildingKeys.add(key);
    frames.push({
      subVector: query,
      key,
      subId,
      computeFn: getHandler(KIND, subId) as SubHandler,
      params,
      kind: rootSource === undefined ? 'computed' : 'root',
      equalityCheck: getSubConfig(subId)?.equalityCheck || getGlobalEqualityCheck(),
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
    const subscription: SubscriptionNode<any> = createSubscription({
      key,
      query,
      kind,
      compute: (...dependencyValues) =>
        params.length > 0
          ? computeFn(...dependencyValues, ...params)
          : computeFn(...dependencyValues),
      dependencies,
      equalityCheck,
      onActive: () => unmarkProvisionalSubscription(key, subscription),
      onUnused: () => evictCachedSubscription(key, subscription),
    });
    cacheSubscription(key, subscription, subId, dependencyKeys);
    if (kind === 'computed') markProvisionalSubscription(key, subscription);

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

// Same typing contract as useSubscription: untyped until SubPayloads is
// augmented, then declared ids infer params and result from the map.
export function getSubscriptionValue<K extends keyof SubPayloads & Id>(
  subVector: [K, ...SubParams<K>],
): SubResult<K>;
export function getSubscriptionValue<T>(subVector: SubscribeVector): T;
export function getSubscriptionValue<T>(subVector: SubVector): T {
  const subscription = getOrCreateSubscription(subVector);
  return subscription ? readSubscription(subscription) : (undefined as T);
}
