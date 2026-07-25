import type { ReactNode } from 'react';

import type {
  ContractSubscriptionId,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  ReflexContracts,
} from '../contracts';
import type { ReflexRuntime } from '../runtime/api';

export interface ReflexProviderProps {
  readonly runtime: ReflexRuntime<any>;
  readonly children?: ReactNode;
}

export interface ReflexHooks<TContracts extends ReflexContracts> {
  useSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    componentName?: string,
  ): ContractSubscriptionResult<TContracts, TId>;
}
