/**
 * Internal adapters for first-party integrations and their tests.
 *
 * This entrypoint is intentionally not re-exported from the package root or
 * vanilla API. Application code should use the production runtime client;
 * integrations should depend on the smallest capability they need here.
 */
import { createReflexRuntimeForTests, getRuntimeAdminForTests } from './runtime/runtime';

/** @internal Test-only owner facade with administrative operations attached. */
export { createReflexRuntimeForTests };

import type { ReflexRuntime } from './runtime/api';
import type { ReflexContracts } from './contracts';
import type { ContractDispatchVector, ContractState } from './contracts';
import type { Interceptor } from './types';

export function getRuntimeIntegration<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
): {
  readonly getState: () => ContractState<TContracts>;
  readonly flush: () => Promise<void>;
  readonly dispatchSync: (event: ContractDispatchVector<TContracts>) => void;
  /**
   * Add and remove a runtime-wide interceptor.
   *
   * Interceptors are not scoped to a module, so an integration that adds one
   * owns its lifetime: remove it by id from the installing module's cleanup so
   * it is torn down with the rest of the integration.
   */
  readonly addInterceptor: (interceptor: Interceptor<ContractState<TContracts>>) => void;
  readonly removeInterceptor: (id: string) => void;
} {
  const implementation = getRuntimeAdminForTests(runtime);
  return Object.freeze({
    getState: implementation.getState.bind(implementation),
    flush: implementation.flush.bind(implementation),
    dispatchSync: implementation.dispatchSync.bind(implementation),
    addInterceptor: implementation.addInterceptor.bind(implementation),
    removeInterceptor: implementation.removeInterceptor.bind(implementation),
  });
}
