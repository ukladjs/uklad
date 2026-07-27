/**
 * Internal adapter for first-party integrations such as reflex-persist.
 *
 * This entrypoint is intentionally not re-exported from the package root or
 * vanilla API. Application code should use the production runtime client;
 * integrations should depend on the smallest capability they need here.
 */
import { createReflexRuntimeForTests, getRuntimeAdminForTests } from './runtime/runtime';

export { createReflexRuntimeForTests };

import type { ReflexRuntime } from './runtime/api';
import type { ReflexContracts } from './contracts';
import type { ContractDispatchVector, ContractState } from './contracts';

export function getRuntimeIntegration<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
): {
  readonly getState: () => ContractState<TContracts>;
  readonly flush: () => Promise<void>;
  readonly dispatchSync: (event: ContractDispatchVector<TContracts>) => void;
} {
  const implementation = getRuntimeAdminForTests(runtime);
  return Object.freeze({
    getState: implementation.getState.bind(implementation),
    flush: implementation.flush.bind(implementation),
    dispatchSync: implementation.dispatchSync.bind(implementation),
  });
}
