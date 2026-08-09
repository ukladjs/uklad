import { acquireOperationClient, createOperationClient } from './client.js';
import type { UkladInspector } from '../types.js';
import type { OperationEventVector } from './runtime.js';
import type {
  OperationClient,
  OperationEvidenceOptions,
  OperationHandle,
  OperationSnapshot,
  OperationWaitResult,
  UkladOperationInspector,
} from './types.js';

/**
 * Decorate a runtime-bound DevTools inspector with retained-operation APIs.
 * This stays internal to `enableDevtools`; applications configure operations
 * in the DevTools setup instead of importing a second package.
 */
export function createOperationInspector(
  inspector: UkladInspector,
  runtime = inspector.getOperationRuntime?.(),
  evidence?: Partial<OperationEvidenceOptions>,
): UkladOperationInspector {
  const operationRuntime = assertOperationRuntime(inspector, runtime);
  const operationEvidence = resolveOperationEvidence(evidence);
  return decorateOperationInspector(
    inspector,
    operationRuntime,
    createOperationClient(operationRuntime, operationEvidence),
    operationEvidence,
  );
}

/** DevTools-owned attachment for the optional execution observer. */
export interface OperationInspectorAttachment {
  readonly inspector: UkladOperationInspector;
  dispose(): void;
}

export function acquireOperationInspector(
  inspector: UkladInspector,
  runtime = inspector.getOperationRuntime?.(),
  evidence?: Partial<OperationEvidenceOptions>,
): OperationInspectorAttachment {
  const operationRuntime = assertOperationRuntime(inspector, runtime);
  const operationEvidence = resolveOperationEvidence(evidence);
  const attachment = acquireOperationClient(operationRuntime, operationEvidence);
  return {
    inspector: decorateOperationInspector(
      inspector,
      operationRuntime,
      attachment.client,
      operationEvidence,
    ),
    dispose: attachment.dispose,
  };
}

function assertOperationRuntime(
  inspector: UkladInspector,
  runtime: ReturnType<NonNullable<UkladInspector['getOperationRuntime']>> | undefined,
) {
  if (!runtime) {
    throw new Error(
      '[Uklad Devtools] operations requires the supplied inspector to expose operation support.',
    );
  }
  if (inspector.runtimeId !== runtime.runtimeId) {
    throw new Error(
      '[Uklad Devtools] operation support must belong to the runtime passed to enableDevtools().',
    );
  }
  return runtime;
}

function decorateOperationInspector(
  inspector: UkladInspector,
  runtime: ReturnType<NonNullable<UkladInspector['getOperationRuntime']>>,
  operations: OperationClient,
  operationEvidence: OperationEvidenceOptions,
): UkladOperationInspector {
  return Object.freeze({
    ...inspector,
    operationApiVersion: 1 as const,
    runtimeInstanceId: runtime.runtimeInstanceId,
    operationEvidence,
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

function resolveOperationEvidence(
  evidence: Partial<OperationEvidenceOptions> | undefined,
): OperationEvidenceOptions {
  return Object.freeze({
    stateChanges: evidence?.stateChanges === 'patches' ? 'patches' : 'none',
  });
}
