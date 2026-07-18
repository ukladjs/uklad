import { getGlobalEqualityCheckForRuntime } from '../core/equality';
import { consoleLog } from '../core/logging';
import { mergeTraceForRuntime, withTraceForRuntime } from '../core/tracing';
import {
  getHandlerForRuntime,
  hasHandlerForRuntime,
  SUB_DEPS_HANDLER_KIND,
  SUB_HANDLER_KIND,
} from '../runtime/handlers';
import { defaultRuntimeScope, type RuntimeScope } from '../runtime/scope';
import {
  cacheSubscriptionForRuntime,
  evictCachedSubscriptionForRuntime,
  getCachedSubscriptionForRuntime,
  getRootSubSourceByIdForRuntime,
  getSubConfigForRuntime,
  markProvisionalSubscriptionForRuntime,
  renewProvisionalSubscriptionTreeForRuntime,
  unmarkProvisionalSubscriptionForRuntime,
} from '../runtime/subscriptions/cache';
import {
  createSubscriptionForRuntime,
  readSubscriptionForRuntime,
} from '../runtime/subscriptions/engine';
import { getSubVectorKey } from '../runtime/subscriptions/keys';

import type { SubscriptionKind, SubscriptionNode } from '../runtime/subscriptions/engine';
import type {
  EqualityCheckFn,
  Id,
  SubDepsHandler,
  SubHandler,
  SubParams,
  SubPayloads,
  SubResult,
  SubVector,
  SubscribeVector,
} from '../types';

interface SubscriptionBuildFrame {
  subVector: SubVector;
  key: string;
  subId: Id;
  computeFn: SubHandler;
  params: any[];
  kind: SubscriptionKind;
  equalityCheck: EqualityCheckFn;
  dependencyVectors: SubVector[];
  dependencies: SubscriptionNode<any>[];
  dependencyKeys: string[];
  nextDependency: number;
}

/**
 * Return the canonical opaque subscription for a query vector, or `null` when
 * its handler is missing. Computed subscriptions have one terminal lifetime:
 * after their last live consumer releases them, a later lookup builds a fresh
 * graph from the registry.
 */
export function getOrCreateSubscription(subVector: SubVector): SubscriptionNode<any> | null {
  return getOrCreateSubscriptionForRuntime(defaultRuntimeScope, subVector);
}

/** @internal Return the canonical subscription owned by one runtime. */
export function getOrCreateSubscriptionForRuntime(
  runtime: RuntimeScope,
  subVector: SubVector,
): SubscriptionNode<any> | null {
  const frames: SubscriptionBuildFrame[] = [];
  const buildingKeys = new Set<string>();

  const resolve = (query: SubVector): SubscriptionNode<any> | undefined => {
    const subId = query[0];
    if (!hasHandlerForRuntime(runtime, SUB_HANDLER_KIND, subId)) {
      consoleLog('error', `[reflex] no sub handler registered for: ${subId}`);
      return undefined;
    }

    const rootSource = getRootSubSourceByIdForRuntime(runtime, subId);
    if (rootSource !== undefined && query.length !== 1) {
      throw new Error(`[reflex] Root subscription '${subId}' does not accept parameters.`);
    }

    const key = getSubVectorKey(query);
    const existing = getCachedSubscriptionForRuntime(runtime, key);
    if (existing) {
      renewProvisionalSubscriptionTreeForRuntime(runtime, key);
      mergeTraceForRuntime(runtime, { tags: { 'cached?': true, subscriptionKey: key } });
      return existing;
    }
    if (buildingKeys.has(key)) {
      throw new Error(`[reflex] Circular subscription dependency detected at ${key}.`);
    }

    const params = query.length > 1 ? query.slice(1) : [];
    const depsFn = getHandlerForRuntime(runtime, SUB_DEPS_HANDLER_KIND, subId) as SubDepsHandler;
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

    withTraceForRuntime(
      runtime,
      { operation: subId, opType: 'sub/create', tags: { queryV: query } },
      () => {},
    );
    buildingKeys.add(key);
    frames.push({
      subVector: query,
      key,
      subId,
      computeFn: getHandlerForRuntime(runtime, SUB_HANDLER_KIND, subId) as SubHandler,
      params,
      kind: rootSource === undefined ? 'computed' : 'root',
      equalityCheck:
        getSubConfigForRuntime(runtime, subId)?.equalityCheck ??
        getGlobalEqualityCheckForRuntime(runtime),
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
    const subscription: SubscriptionNode<any> = createSubscriptionForRuntime(runtime, {
      key,
      query,
      kind,
      compute: (...dependencyValues) =>
        params.length > 0
          ? computeFn(...dependencyValues, ...params)
          : computeFn(...dependencyValues),
      dependencies,
      equalityCheck,
      onActive: () => unmarkProvisionalSubscriptionForRuntime(runtime, key, subscription),
      onUnused: () => evictCachedSubscriptionForRuntime(runtime, key, subscription),
    });
    cacheSubscriptionForRuntime(runtime, key, subscription, subId, dependencyKeys);
    if (kind === 'computed') {
      markProvisionalSubscriptionForRuntime(runtime, key, subscription);
    }

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

/**
 * Read a subscription imperatively.
 *
 * The API remains permissive until `SubPayloads` is augmented. After
 * augmentation, declared ids infer both their parameter tuple and result type,
 * matching the `useSubscription` contract.
 */
export function getSubscriptionValue<K extends keyof SubPayloads & Id>(
  subVector: [K, ...SubParams<K>],
): SubResult<K>;
export function getSubscriptionValue<T>(subVector: SubscribeVector): T;
export function getSubscriptionValue<T>(subVector: SubVector): T {
  return getSubscriptionValueForRuntime<T>(defaultRuntimeScope, subVector);
}

/** @internal Read a subscription value from one runtime. */
export function getSubscriptionValueForRuntime<T>(runtime: RuntimeScope, subVector: SubVector): T {
  const subscription = getOrCreateSubscriptionForRuntime(runtime, subVector);
  return subscription ? readSubscriptionForRuntime(runtime, subscription) : (undefined as T);
}
