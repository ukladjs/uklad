import { useMemo, useSyncExternalStore } from 'react';

import { getSubVectorKey } from '../runtime/subscriptions/keys';
import { useReflexRuntime } from './context';

import type {
  ContractSubscriptionId,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  ReflexContracts,
} from '../contracts';
import { subscribeForRender } from '../runtime/runtime';
import type { ReflexRuntime } from '../runtime/api';
import type { Id, SubParams, SubPayloads, SubResult, SubscribeVector, SubVector } from '../types';

/**
 * Subscribe a React component to the nearest Reflex runtime.
 *
 * A changed serialized vector or provider runtime rebinds the external store.
 * A provider is required so every hook reads from an explicit runtime owner.
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
  const runtime = useReflexRuntime();
  return useRuntimeSubscription(runtime, subVector, componentName);
}

function useRuntimeSubscription<T>(
  runtime: ReflexRuntime<any>,
  subVector: SubVector,
  componentName: string,
): T {
  const subVectorKey = getSubVectorKey(subVector);

  const store = useMemo(
    () => ({
      subscribe: (onStoreChange: () => void) =>
        subscribeForRender(runtime, subVector as never, onStoreChange, componentName),
      getSnapshot: (): T => runtime.getSubscriptionValue(subVector as never) as T,
    }),
    // The canonical serialized key deliberately represents subVector identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [componentName, runtime, subVectorKey],
  );

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export interface ReflexHooks<TContracts extends ReflexContracts> {
  useSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    componentName?: string,
  ): ContractSubscriptionResult<TContracts, TId>;
}

/** Create locally typed hooks for runtimes using `TContracts`. */
export function createReflexHooks<TContracts extends ReflexContracts>(): ReflexHooks<TContracts> {
  function useTypedSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    componentName: string = 'react component',
  ): ContractSubscriptionResult<TContracts, TId> {
    const runtime = useReflexRuntime<TContracts>();
    return useRuntimeSubscription<ContractSubscriptionResult<TContracts, TId>>(
      runtime,
      query as SubVector,
      componentName,
    );
  }

  return Object.freeze({ useSubscription: useTypedSubscription });
}
