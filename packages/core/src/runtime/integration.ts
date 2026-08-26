import type { ContractDispatchVector, ContractState, UkladContracts } from '../contracts';
import type { Interceptor } from '../types';
import type { UkladRuntime } from './api';
import { getRuntimeAdminForInternalUse } from './runtime';

/**
 * Narrow administrative capability for first-party and third-party runtime
 * integrations. Application features should continue to use UkladRuntime and
 * module registrars rather than this attachment-level surface.
 */
export interface UkladRuntimeIntegration<TContracts extends UkladContracts> {
  readonly getState: () => ContractState<TContracts>;
  readonly flush: () => Promise<void>;
  readonly dispatchSync: (event: ContractDispatchVector<TContracts>) => void;
  /** Add a runtime-wide interceptor whose lifetime the integration owns. */
  readonly addInterceptor: (interceptor: Interceptor<ContractState<TContracts>>) => void;
  /** Remove a runtime-wide interceptor previously added by the integration. */
  readonly removeInterceptor: (id: string) => void;
}

/** Obtain the supported attachment capability for a runtime owner. */
export function getRuntimeIntegration<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
): UkladRuntimeIntegration<TContracts> {
  const implementation = getRuntimeAdminForInternalUse(runtime);
  return Object.freeze({
    getState: implementation.getState.bind(implementation),
    flush: implementation.flush.bind(implementation),
    dispatchSync: implementation.dispatchSync.bind(implementation),
    addInterceptor: implementation.addInterceptor.bind(implementation),
    removeInterceptor: implementation.removeInterceptor.bind(implementation),
  });
}
