import { useMemo, useSyncExternalStore } from 'react';

import { getSubscriptionSnapshot, subscribeToSubscription } from '../runtime/subscriptions/engine';
import { getSubVectorKey } from '../runtime/subscriptions/keys';
import { getOrCreateSubscription } from '../subscriptions/queries';

import type { Id, SubParams, SubPayloads, SubResult, SubscribeVector, SubVector } from '../types';

/**
 * Subscribe a React component to a Reflex subscription.
 *
 * The subscription vector is JSON-serialized for cache identity. Parameters
 * must therefore be plain serializable values; unsupported values can collide,
 * become stale, or throw during key generation and are warned about in
 * development. A changed serialized vector rebinds the external store.
 * `componentName` is a static diagnostic label captured when that binding is
 * created.
 *
 * Before `SubPayloads` is augmented, callers may provide an explicit result
 * type. After augmentation, declared IDs infer their parameters and result,
 * and undeclared IDs are rejected.
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
    // The canonical serialized key deliberately represents subVector identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [componentName, subVectorKey],
  );

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
