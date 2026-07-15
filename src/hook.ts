import { useMemo, useSyncExternalStore } from 'react';
import type { Id, SubVector, SubPayloads, SubParams, SubResult, SubscribeVector } from './types';
import { getOrCreateSubscription, getSubVectorKey } from './subs';
import { getSubscriptionSnapshot, subscribeToSubscription } from './subscription-runtime';

/**
 * Subscribe a React component to a reflex subscription.
 *
 * Contract:
 * - `subVector` params must be JSON-serializable plain values (ids, strings,
 *   numbers, plain objects/arrays). Subscription nodes are cached and bindings are refreshed by
 *   `JSON.stringify(subVector)`: object key order matters, and `undefined`,
 *   functions, Symbols, BigInt, `Map`/`Set`/`RegExp`, non-finite numbers or
 *   circular references (at any depth) collide, go stale, or throw during
 *   key generation (warned in dev).
 * - Changing the serialized vector across renders re-subscribes automatically.
 * - `componentName` is a devtools tracing label; pass a static string. It is
 *   captured when the subscription (re)binds, not on every render.
 *
 * Typing: while `SubPayloads` is unaugmented this behaves as before —
 * `useSubscription<T>([id, ...params])`. Once the app augments `SubPayloads`,
 * declared sub ids infer params and result from the map, and undeclared ids
 * are rejected at compile time.
 */
export function useSubscription<K extends keyof SubPayloads & Id>(
  subVector: [K, ...SubParams<K>],
  componentName?: string,
): SubResult<K>;
export function useSubscription<T>(subVector: SubscribeVector, componentName?: string): T;
export function useSubscription<T>(
  subVector: SubVector,
  componentName: string = 'react component',
): T {
  // Key the store bindings on the serialized vector so changing subscription
  // parameters re-subscribes to the new subscription instead of silently keeping
  // the one captured on first mount. getSubVectorKey validates params in dev
  // before serializing, so unserializable params warn before any throw.
  const subVectorKey = getSubVectorKey(subVector);

  const store = useMemo(
    () => ({
      subscribe: (onStoreChange: () => void) => {
        const subscription = getOrCreateSubscription(subVector);
        return subscription
          ? subscribeToSubscription(subscription, onStoreChange, componentName)
          : () => {};
      },
      getSnapshot: (): T => {
        const subscription = getOrCreateSubscription(subVector);
        return subscription ? getSubscriptionSnapshot(subscription) : (undefined as T);
      },
    }),
    // The serialized key intentionally represents subVector identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [componentName, subVectorKey],
  );

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
