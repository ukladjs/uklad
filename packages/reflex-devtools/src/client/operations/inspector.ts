import { createOperationClient } from './client.js';
import type { ReflexInspector } from '../types.js';
import type { OperationEventVector } from './runtime.js';
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
 * Decorate a runtime-bound DevTools inspector with retained-operation APIs.
 * This stays internal to `enableDevtools`; applications configure operations
 * in the DevTools setup instead of importing a second package.
 */
export function createOperationInspector(
  inspector: ReflexInspector,
  runtime = inspector.getOperationRuntime?.(),
): ReflexOperationInspector {
  if (!runtime) {
    throw new Error(
      '[Reflex Devtools] operations requires runtime.createInspector() to expose operation support.',
    );
  }
  if (inspector.runtimeId !== runtime.runtimeId) {
    throw new Error(
      '[Reflex Devtools] operation support must belong to the runtime passed to enableDevtools().',
    );
  }
  const operations: OperationClient = createOperationClient(runtime);
  return Object.freeze({
    ...inspector,
    operationApiVersion: 1 as const,
    runtimeInstanceId: runtime.runtimeInstanceId,
    startEvent(event: OperationEventVector, options?: OperationOptions): OperationHandle {
      return operations.start(event, options);
    },
    executeEvent(event: OperationEventVector, options?: OperationOptions): Promise<OperationWaitResult> {
      return operations.dispatchAndWait(event, options);
    },
    getOperation(lookup: string | OperationLookup): OperationReceipt | undefined {
      return operations.get(lookup);
    },
  });
}
