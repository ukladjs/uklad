import type { EventVector, ReflexContracts, ReflexRuntime } from '@flexsurfer/reflex';

import { createOperationClient } from './client.js';
import type {
  OperationClient,
  OperationHandle,
  OperationLookup,
  OperationOptions,
  OperationReceipt,
  OperationWaitResult,
  ReflexOperationInspector,
} from './types.js';

/**
 * Decorate the core inspector with this package's retained-operation API.
 * Keeping this adapter here makes operations an opt-in package capability
 * rather than an additional responsibility of every Reflex runtime.
 */
export function createOperationInspector<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
  operations: OperationClient = createOperationClient(runtime),
): ReflexOperationInspector {
  const inspector = runtime.createInspector();
  return Object.freeze({
    ...inspector,
    operationApiVersion: 1 as const,
    runtimeInstanceId: runtime.runtimeInstanceId,
    startEvent(event: EventVector, options?: OperationOptions): OperationHandle {
      return operations.start(event, options);
    },
    executeEvent(event: EventVector, options?: OperationOptions): Promise<OperationWaitResult> {
      return operations.dispatchAndWait(event, options);
    },
    getOperation(lookup: string | OperationLookup): OperationReceipt | undefined {
      return operations.get(lookup);
    },
  });
}
