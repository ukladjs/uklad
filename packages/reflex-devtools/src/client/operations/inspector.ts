import { acquireOperationClient, createOperationClient } from './client.js';
import type { ReflexInspector } from '../types.js';
import type { OperationEventVector } from './runtime.js';
import type {
  OperationClient,
  OperationHandle,
  OperationSnapshot,
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
  const operationRuntime = assertOperationRuntime(inspector, runtime);
  return decorateOperationInspector(inspector, operationRuntime, createOperationClient(operationRuntime));
}

/** DevTools-owned attachment for the optional execution observer. */
export interface OperationInspectorAttachment {
  readonly inspector: ReflexOperationInspector;
  dispose(): void;
}

export function acquireOperationInspector(
  inspector: ReflexInspector,
  runtime = inspector.getOperationRuntime?.(),
): OperationInspectorAttachment {
  const operationRuntime = assertOperationRuntime(inspector, runtime);
  const attachment = acquireOperationClient(operationRuntime);
  return {
    inspector: decorateOperationInspector(inspector, operationRuntime, attachment.client),
    dispose: attachment.dispose,
  };
}

function assertOperationRuntime(
  inspector: ReflexInspector,
  runtime: ReturnType<NonNullable<ReflexInspector['getOperationRuntime']>> | undefined,
) {
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
  return runtime;
}

function decorateOperationInspector(
  inspector: ReflexInspector,
  runtime: ReturnType<NonNullable<ReflexInspector['getOperationRuntime']>>,
  operations: OperationClient,
): ReflexOperationInspector {
  return Object.freeze({
    ...inspector,
    operationApiVersion: 1 as const,
    runtimeInstanceId: runtime.runtimeInstanceId,
    startEvent(event: OperationEventVector): OperationHandle {
      return operations.start(event);
    },
    executeEvent(event: OperationEventVector): Promise<OperationWaitResult> {
      return operations.dispatchAndWait(event);
    },
    getOperation(operationId: string): OperationSnapshot | undefined {
      return operations.get(operationId);
    },
  });
}
