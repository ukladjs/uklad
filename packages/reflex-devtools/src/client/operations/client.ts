import { OperationCoordinator } from './coordinator.js';
import type { DevtoolsOperationRuntime, OperationEventVector } from './runtime.js';
import type { OperationClient, OperationHandle, OperationSnapshot, OperationWaitResult } from './types.js';

/**
 * Thin adapter over the DevTools-owned coordinator.
 * Core reports execution facts; DevTools retains the resulting snapshots.
 */
export function createOperationClient(runtime: DevtoolsOperationRuntime): OperationClient {
  return createOperationAttachment(runtime).client;
}

function createOperationAttachment(runtime: DevtoolsOperationRuntime): {
  readonly client: OperationClient;
  dispose(): void;
} {
  const coordinator = new OperationCoordinator(runtime.runtimeInstanceId);
  const disposeExecution = runtime.observeExecution(coordinator);
  const disposeLifecycle = runtime.observeLifecycle({
    onEffect: (effect) => coordinator.onEffect(effect),
  });
  return Object.freeze({
    client: Object.freeze({
      start(event: OperationEventVector): OperationHandle {
      const operationId = runtime.dispatch(event as never);
      return {
        operationId,
        runtimeInstanceId: runtime.runtimeInstanceId,
        result: waitForOperation(runtime, coordinator, operationId),
      };
      },
      dispatchAndWait(event: OperationEventVector): Promise<OperationWaitResult> {
        return this.start(event).result;
      },
      get(operationId: string): OperationSnapshot | undefined {
        return coordinator.get(operationId);
      },
    }),
    dispose() {
      disposeLifecycle();
      disposeExecution();
    },
  });
}

/** Compatibility attachment; the coordinator has no DevTools lifecycle hook. */
export function acquireOperationClient(runtime: DevtoolsOperationRuntime): {
  readonly client: OperationClient;
  dispose(): void;
} {
  return createOperationAttachment(runtime);
}

async function waitForOperation(
  runtime: DevtoolsOperationRuntime,
  coordinator: OperationCoordinator,
  operationId: string,
): Promise<OperationWaitResult> {
  try {
    await runtime.flush();
  } catch (error) {
    const operation = coordinator.get(operationId);
    if (operation) return { operation };
    throw error;
  }
  const operation = coordinator.get(operationId);
  if (!operation) throw new Error(`[Reflex Devtools] operation '${operationId}' was not retained.`);
  return { operation };
}
