/**
 * Test-only runtime adapters.
 *
 * This entrypoint deliberately exposes focused operations instead of the live
 * handler registry. Production applications should not import it.
 */
import { getRuntimeAdminForTests } from './runtime/runtime';

import type {
  ContractCoeffectId,
  ContractEffectParams,
  ContractDispatchVector,
  ContractState,
  ContractSubscribeVector,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  UkladDisposer,
  PermissiveUkladContracts,
  UkladContracts,
  WatchSubscriptionOptions,
} from './contracts';
import type {
  UkladRuntime,
  RuntimeCoeffectHandler,
  RuntimeEventHandler,
  RuntimeSubscriptionHandler,
} from './runtime/api';
import type { SubDepsHandler } from './types';

export interface UkladTestHarness<TContracts extends UkladContracts = PermissiveUkladContracts> {
  getState(): ContractState<TContracts>;
  flush(): Promise<void>;
  dispatchSync(event: ContractDispatchVector<TContracts>): void;
  restoreState(nextState: ContractState<TContracts>): void;
  getEventHandler<TId extends string>(id: TId): RuntimeEventHandler<TContracts, TId> | undefined;
  getEffectHandler<TId extends string>(
    id: TId,
  ): ((value: ContractEffectParams<TContracts, TId>) => void) | undefined;
  getCoeffectHandler<TId extends ContractCoeffectId<TContracts>>(
    id: TId,
  ): RuntimeCoeffectHandler<TContracts, TId> | undefined;
  getSubscriptionHandler<TId extends ContractSubscriptionId<TContracts>>(
    id: TId,
  ): RuntimeSubscriptionHandler<TContracts, TId> | undefined;
  getSubscriptionDependencies<TId extends ContractSubscriptionId<TContracts>>(
    id: TId,
  ):
    | ((
        ...params: ContractSubscriptionParams<TContracts, TId>
      ) => ContractSubscribeVector<TContracts>[])
    | undefined;
  getSubscriptionValue<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
  ): ContractSubscriptionResult<TContracts, TId>;
  watchSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    listener: (
      value: ContractSubscriptionResult<TContracts, TId>,
      previous?: ContractSubscriptionResult<TContracts, TId>,
    ) => void,
    options?: WatchSubscriptionOptions,
  ): UkladDisposer;
}

/** Create a frozen, explicitly test-only view over one runtime owner. */
export function createUkladTestHarness<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
): UkladTestHarness<TContracts> {
  const admin = getRuntimeAdminForTests(runtime);
  return Object.freeze({
    getState: admin.getState.bind(admin),
    flush: admin.flush.bind(admin),
    dispatchSync: admin.dispatchSync.bind(admin),
    restoreState: admin.restoreState.bind(admin),
    getEventHandler: (id: string) => admin.getHandlers().event[id],
    getEffectHandler: (id: string) => admin.getHandlers().fx[id],
    getCoeffectHandler: (id: string) => admin.getHandlers().cofx[id],
    getSubscriptionHandler: (id: string) => admin.getHandlers().sub[id],
    getSubscriptionDependencies: (id: string) => admin.getHandlers().subDeps[id],
    getSubscriptionValue: admin.getSubscriptionValue.bind(admin),
    watchSubscription: admin.watchSubscription.bind(admin),
  }) as UkladTestHarness<TContracts>;
}

export type { SubDepsHandler };
