import type { ReflexContracts, ReflexRuntime } from '@flexsurfer/reflex';

import {
  createOperation,
  evictTerminalOperation,
  normalizeError,
  recordError,
  rejectOperation,
  requestFinalization,
} from './ledger.js';
import { MAX_OPERATIONS } from './limits.js';
import { observeOperationLifecycle } from './lifecycle.js';
import { snapshotOperation } from './receipt.js';
import type { MutableOperation, OperationState } from './state.js';
import { getState } from './state.js';
import type {
  OperationClient,
  OperationHandle,
  OperationWaitResult,
  OperationWaitStatus,
} from './types.js';
import { assertEvent, assertOptions, fingerprintOperation, normalizeTimeout, validateInput } from './validation.js';
import { cloneEvent, timestamp } from './values.js';

/**
 * Attach the operation ledger to one explicit runtime.
 *
 * The package owns receipt retention and its lifecycle observer. Reflex's
 * kernel only supplies generic queue, state, and effect evidence, so an
 * application can omit this package without changing normal runtime behavior.
 */
export function createOperationClient<TContracts extends ReflexContracts>(
  runtime: ReflexRuntime<TContracts>,
): OperationClient {
  const state = getState(runtime);
  if (state.client) return state.client;
  observeOperationLifecycle(runtime, state);

  const client: OperationClient = {
    start(event, options = {}) {
      assertEvent(event);
      assertOptions(options);
      validateInput(event, options);
      const fingerprint = fingerprintOperation(event, options);
      const existing = options.idempotencyKey
        ? state.idempotencyKeys.get(options.idempotencyKey)
        : undefined;
      if (existing) {
        const operation = state.operations.get(existing);
        if (operation && operation.fingerprint === fingerprint) {
          return operationHandle(runtime, state, operation, true, options.timeoutMs);
        }
        const conflict = createOperation(runtime, state, event, options, fingerprint);
        rejectOperation(
          conflict,
          'idempotency-conflict',
          'The operation or idempotency key was already used with a different event payload.',
        );
        return operationHandle(runtime, state, conflict, false, options.timeoutMs);
      }

      evictTerminalOperation(state);
      if (state.operations.size >= MAX_OPERATIONS) {
        const rejected = createOperation(runtime, state, event, options, fingerprint);
        rejectOperation(
          rejected,
          'capacity',
          `The runtime already retains ${MAX_OPERATIONS} operations and none can be evicted.`,
        );
        return operationHandle(runtime, state, rejected, false, options.timeoutMs);
      }

      const operation = createOperation(runtime, state, event, options, fingerprint);
      state.operations.set(operation.operationId, operation);
      if (operation.idempotencyKey) state.idempotencyKeys.set(operation.idempotencyKey, operation.operationId);
      const root = operation.events[0]!;
      state.pendingRoot = {
        operation,
        eventInstanceId: root.eventInstanceId,
        eventRecord: root,
      };
      try {
        runtime.dispatch(cloneEvent(event) as never);
      } catch (error: unknown) {
        state.pendingRoot = null;
        recordError(operation, root, normalizeError('missing-handler', error, root.eventInstanceId));
        root.status = 'failed';
        root.completedAt = timestamp();
        operation.pendingEvents = 0;
        operation.readyToPublish = true;
        requestFinalization(runtime, state, operation);
      }
      return operationHandle(runtime, state, operation, false, options.timeoutMs);
    },
    dispatchAndWait(event, options) {
      return client.start(event, options).result;
    },
    get(lookup) {
      const operationId =
        typeof lookup === 'string'
          ? lookup
          : 'operationId' in lookup
            ? lookup.operationId
            : state.idempotencyKeys.get(lookup.idempotencyKey);
      const operation = operationId ? state.operations.get(operationId) : undefined;
      return operation ? snapshotOperation(runtime, state, operation) : undefined;
    },
  };
  state.client = client;
  return client;
}

function operationHandle(
  runtime: ReflexRuntime<any>,
  state: OperationState,
  operation: MutableOperation,
  replayed: boolean,
  timeoutMs: number | undefined,
): OperationHandle {
  return {
    operationId: operation.operationId,
    runtimeInstanceId: runtime.runtimeInstanceId,
    result: waitForOperation(runtime, state, operation, replayed, normalizeTimeout(timeoutMs)),
  };
}

async function waitForOperation(
  runtime: ReflexRuntime<any>,
  state: OperationState,
  operation: MutableOperation,
  replayed: boolean,
  timeoutMs: number,
): Promise<OperationWaitResult> {
  if (operation.terminal) return waitResult(runtime, state, operation, replayed, 'settled');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  });
  const completed = operation.completionPromise.then(() => false);
  const didTimeOut = await Promise.race([timedOut, completed]);
  if (timer !== undefined) clearTimeout(timer);
  return waitResult(runtime, state, operation, replayed, didTimeOut ? 'timed-out' : 'settled', didTimeOut ? timeoutMs : undefined);
}

function waitResult(
  runtime: ReflexRuntime<any>,
  state: OperationState,
  operation: MutableOperation,
  replayed: boolean,
  status: OperationWaitStatus,
  timeoutMs?: number,
): OperationWaitResult {
  return {
    operation: snapshotOperation(runtime, state, operation),
    delivery: { status, timeoutMs: timeoutMs ?? null },
    replayed,
  };
}
