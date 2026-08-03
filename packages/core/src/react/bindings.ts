import { createContext, createElement, useContext } from 'react';

import { getRuntimeClient } from '../runtime/runtime';
import { ReflexProvider as ReflexRuntimeProvider } from './context';
import { useRuntimeSubscription } from './use-subscription';

import type { ReactElement } from 'react';
import type {
  ContractSubscriptionId,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  ReflexContracts,
} from '../contracts';
import type { ReflexRuntimeClient } from '../runtime/api';
import type { SubVector } from '../types';
import type { ReflexBindings, ReflexTypedProviderProps } from './types';

/**
 * Create a provider and hooks that are checked against `TContracts` together.
 *
 * The package-level `ReflexProvider` and `useSubscription` read one context
 * whose type is fixed when the context is created, so they can only ever check
 * against the ambient `DefaultContracts`. Hooks typed with a local contract
 * cannot use it: nothing would relate the contract they were created with to
 * the runtime a provider happens to supply, and two runtimes sharing a
 * subscription id with different result types would then disagree silently.
 *
 * So each call owns a private context. The returned provider accepts only a
 * `ReflexRuntime<TContracts>`, the returned hooks read only that context, and
 * the pair is the only thing that satisfies them — a runtime provided through
 * some other provider is a missing provider here, and throws.
 *
 * Call this once per contract and export the result, the same way a React
 * context is created once:
 *
 * ```ts
 * export const { ReflexProvider, useSubscription, useRuntime } =
 *   createReflexHooks<TodoContracts>();
 * ```
 *
 * Two calls for the same contract produce two unrelated contexts, and hooks
 * from one will not see the other's provider.
 *
 * The returned provider also selects the runtime for the package-level context,
 * so `HotReloadWrapper`, `useHotReload`, and untyped hooks work beneath it
 * without a second provider.
 */
export function createReflexHooks<
  TContracts extends ReflexContracts,
>(): ReflexBindings<TContracts> {
  const BoundRuntimeContext = createContext<ReflexRuntimeClient<TContracts> | null>(null);

  function useRuntime(): ReflexRuntimeClient<TContracts> {
    const runtime = useContext(BoundRuntimeContext);
    if (!runtime) {
      throw new Error(
        '[reflex] These bindings require the <ReflexProvider> returned by the same ' +
          'createReflexHooks() call. The package-level <ReflexProvider> selects a runtime ' +
          'without selecting a contract, so it cannot satisfy locally typed bindings.',
      );
    }
    return runtime;
  }

  function ReflexProvider({
    runtime,
    children,
  }: ReflexTypedProviderProps<TContracts>): ReactElement {
    // The owner is normalized to its stable client identity, which is memoized
    // per runtime, so this context value is referentially stable across renders.
    const client = getRuntimeClient(runtime);
    return createElement(
      ReflexRuntimeProvider,
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

  return Object.freeze({ ReflexProvider, useSubscription, useRuntime });
}
