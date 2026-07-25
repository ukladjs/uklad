import { IS_DEV } from '../../core/environment';
import { consoleLog } from '../../core/logging';

import type { Id, SubVector } from '../../types';

const warnedNonSerializableSubIds = new Set<Id>();

/** @internal Exposed for focused tests of the cache-key serialization contract. */
export function hasNonSerializableSubParam(params: readonly unknown[]): boolean {
  const visiting = new WeakSet<object>();
  return params.some((param) => isNonSerializableValue(param, visiting));
}

/**
 * @internal Produce the canonical cache key for a subscription vector.
 *
 * Development validation runs before JSON.stringify so unsupported parameters
 * produce an actionable warning before they collide or throw.
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

/** @internal Produce the canonical cache key for a root subscription. */
export function getRootSubKey(subId: Id): string {
  return getSubVectorKey([subId]);
}

/**
 * Subscription cache keys use JSON serialization, so values that do not
 * survive JSON.stringify can collide, go stale, or throw during generation.
 */
function isNonSerializableValue(value: unknown, visiting: WeakSet<object>): boolean {
  if (value === undefined) return true;
  const type = typeof value;
  if (type === 'function' || type === 'symbol' || type === 'bigint') return true;
  if (type === 'number' && !Number.isFinite(value)) return true;
  if (value === null || type !== 'object') return false;
  if (value instanceof Map || value instanceof Set || value instanceof RegExp) return true;
  if (visiting.has(value)) return true;

  visiting.add(value);
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  const result = values.some((entry) => isNonSerializableValue(entry, visiting));
  visiting.delete(value);
  return result;
}
