import type { ReactElement, ReactNode } from 'react';

import type {
  ContractSubscriptionId,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  UkladContracts,
} from '../contracts';
import type { UkladRuntime, UkladRuntimeClient } from '../runtime/api';

/**
 * Props of the package-level provider, which selects a runtime without
 * selecting a contract. Locally typed bindings use
 * `UkladTypedProviderProps` instead, so that their provider and hooks are
 * checked against one contract together.
 */
export interface UkladProviderProps {
  readonly runtime: UkladRuntime<any>;
  readonly children?: ReactNode;
}

/** Props of the provider returned by `createUkladHooks<TContracts>()`. */
export interface UkladTypedProviderProps<TContracts extends UkladContracts> {
  readonly runtime: UkladRuntime<TContracts>;
  readonly children?: ReactNode;
}

/**
 * The subscription hook created for one contract.
 *
 * Kept as its own interface so existing annotations and test doubles that
 * supply only `useSubscription` still satisfy it.
 */
export interface UkladHooks<TContracts extends UkladContracts> {
  useSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    componentName?: string,
  ): ContractSubscriptionResult<TContracts, TId>;
}

/**
 * Everything `createUkladHooks<TContracts>()` returns: the hooks above, plus
 * the provider that binds them to a runtime built for the same contract.
 *
 * `UkladProvider` is a function-typed property rather than a method so its
 * `runtime` prop is checked contravariantly. That is what rejects a runtime
 * built for a different contract, and the provider is the only place the
 * pairing can be checked at all.
 */
export interface UkladBindings<TContracts extends UkladContracts> extends UkladHooks<TContracts> {
  readonly UkladProvider: (props: UkladTypedProviderProps<TContracts>) => ReactElement;
  readonly useRuntime: () => UkladRuntimeClient<TContracts>;
}
