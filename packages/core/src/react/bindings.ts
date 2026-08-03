import { createContext, createElement, useContext } from 'react';

import { getRuntimeClient } from '../runtime/runtime';
import { UkladProvider as UkladRuntimeProvider } from './context';
import { useRuntimeSubscription } from './use-subscription';

import type { ReactElement } from 'react';
import type {
  ContractSubscriptionId,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  UkladContracts,
} from '../contracts';
import type { UkladRuntimeClient } from '../runtime/api';
import type { SubVector } from '../types';
import type { UkladBindings, UkladTypedProviderProps } from './types';

/**
 * Create a provider and hooks that are checked against `TContracts` together.
 *
 * The package-level `UkladProvider` and `useSubscription` read one context
 * whose type is fixed when the context is created, so they can only ever check
 * against the ambient `DefaultContracts`. Hooks typed with a local contract
 * cannot use it: nothing would relate the contract they were created with to
 * the runtime a provider happens to supply, and two runtimes sharing a
 * subscription id with different result types would then disagree silently.
 *
 * So each call owns a private context. The returned provider accepts only a
 * `UkladRuntime<TContracts>`, the returned hooks read only that context, and
 * the pair is the only thing that satisfies them — a runtime provided through
 * some other provider is a missing provider here, and throws.
 *
 * Call this once per contract and export the result, the same way a React
 * context is created once:
 *
 * ```ts
 * export const { UkladProvider, useSubscription, useRuntime } =
 *   createUkladHooks<TodoContracts>();
 * ```
 *
 * Two calls for the same contract produce two unrelated contexts, and hooks
 * from one will not see the other's provider.
 *
 * The returned provider also selects the runtime for the package-level context,
 * so `HotReloadWrapper`, `useHotReload`, and untyped hooks work beneath it
 * without a second provider.
 */
export function createUkladHooks<TContracts extends UkladContracts>(): UkladBindings<TContracts> {
  const BoundRuntimeContext = createContext<UkladRuntimeClient<TContracts> | null>(null);

  function useRuntime(): UkladRuntimeClient<TContracts> {
    const runtime = useContext(BoundRuntimeContext);
    if (!runtime) {
      throw new Error(
        '[uklad] These bindings require the <UkladProvider> returned by the same ' +
          'createUkladHooks() call. The package-level <UkladProvider> selects a runtime ' +
          'without selecting a contract, so it cannot satisfy locally typed bindings.',
      );
    }
    return runtime;
  }

  function UkladProvider({ runtime, children }: UkladTypedProviderProps<TContracts>): ReactElement {
    // The owner is normalized to its stable client identity, which is memoized
    // per runtime, so this context value is referentially stable across renders.
    const client = getRuntimeClient(runtime);
    return createElement(
      UkladRuntimeProvider,
      { runtime },
      createElement(BoundRuntimeContext.Provider, { value: client }, children),
    );
  }

  function useSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    componentName: string = 'react component',
  ): ContractSubscriptionResult<TContracts, TId> {
    const runtime = useRuntime();
    return useRuntimeSubscription<ContractSubscriptionResult<TContracts, TId>>(
      runtime,
      query as SubVector,
      componentName,
    );
  }

  return Object.freeze({ UkladProvider, useSubscription, useRuntime });
}
