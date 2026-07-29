import type { ReactElement, ReactNode } from 'react';

import type {
  ContractSubscriptionId,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  ReflexContracts,
} from '../contracts';
import type { ReflexRuntime, ReflexRuntimeClient } from '../runtime/api';

/**
 * Props of the package-level provider, which selects a runtime without
 * selecting a contract. Locally typed bindings use
 * `ReflexTypedProviderProps` instead, so that their provider and hooks are
 * checked against one contract together.
 */
export interface ReflexProviderProps {
  readonly runtime: ReflexRuntime<any>;
  readonly children?: ReactNode;
}

/** Props of the provider returned by `createReflexHooks<TContracts>()`. */
export interface ReflexTypedProviderProps<TContracts extends ReflexContracts> {
  readonly runtime: ReflexRuntime<TContracts>;
  readonly children?: ReactNode;
}

/**
 * The subscription hook created for one contract.
 *
 * Kept as its own interface so existing annotations and test doubles that
 * supply only `useSubscription` still satisfy it.
 */
export interface ReflexHooks<TContracts extends ReflexContracts> {
  useSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    componentName?: string,
  ): ContractSubscriptionResult<TContracts, TId>;
}

/**
 * Everything `createReflexHooks<TContracts>()` returns: the hooks above, plus
 * the provider that binds them to a runtime built for the same contract.
 *
 * `ReflexProvider` is a function-typed property rather than a method so its
 * `runtime` prop is checked contravariantly. That is what rejects a runtime
 * built for a different contract, and the provider is the only place the
 * pairing can be checked at all.
 */
export interface ReflexBindings<
  TContracts extends ReflexContracts,
> extends ReflexHooks<TContracts> {
  readonly ReflexProvider: (props: ReflexTypedProviderProps<TContracts>) => ReactElement;
  readonly useRuntime: () => ReflexRuntimeClient<TContracts>;
}
