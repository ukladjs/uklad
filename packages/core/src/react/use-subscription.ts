import { useMemo, useSyncExternalStore } from 'react';

import { getSubVectorKey } from '../runtime/subscriptions/keys';
import { useUkladRuntime } from './context';

import type {
  ContractSubscribeVector,
  ContractSubscriptionId,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  DefaultContracts,
} from '../contracts';
import { getSubscriptionValueForInternalUse, subscribeForRender } from '../runtime/runtime';
import type { UkladRuntimeClient } from '../runtime/api';
import type { SubVector } from '../types';

export type { UkladBindings, UkladHooks } from './types';

/**
 * Subscribe a React component to the nearest Uklad runtime.
 *
 * A changed serialized vector or provider runtime rebinds the external store.
 * A provider is required so every hook reads from an explicit runtime owner.
 *
 * This entry point checks against the ambient `DefaultContracts`, because a
 * React context type is fixed when the context is created and so cannot carry
 * a per-runtime contract. Applications owning more than one runtime should use
 * `createUkladHooks<TContracts>()` instead, which pairs a provider and hooks
 * over a private context so the contract they are checked against is the one
 * the provided runtime was built for.
 */
export function useSubscription<TId extends ContractSubscriptionId<DefaultContracts>>(
  query: ContractSubscriptionVector<DefaultContracts, TId>,
  componentName?: string,
): ContractSubscriptionResult<DefaultContracts, TId>;
export function useSubscription<T>(
  query: ContractSubscribeVector<DefaultContracts>,
  componentName?: string,
): T;
export function useSubscription<T>(
  subVector: SubVector,
  componentName: string = 'react component',
): T {
  const runtime = useUkladRuntime();
  return useRuntimeSubscription(runtime, subVector, componentName);
}

/** @internal Shared subscription store used by every React entry point. */
export function useRuntimeSubscription<T>(
  runtime: UkladRuntimeClient<any>,
  subVector: SubVector,
  componentName: string,
): T {
  const subVectorKey = getSubVectorKey(subVector);

  const store = useMemo(
    () => ({
      subscribe: (onStoreChange: () => void) =>
        subscribeForRender(runtime, subVector as never, onStoreChange, componentName),
      getSnapshot: (): T => getSubscriptionValueForInternalUse(runtime, subVector as never) as T,
    }),
    // The canonical serialized key deliberately represents subVector identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [componentName, runtime, subVectorKey],
  );

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
