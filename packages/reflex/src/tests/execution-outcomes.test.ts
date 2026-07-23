import {
  observeExecutionOutcomesForKernel,
  type ExecutionOutcome,
  type QueuedOutcome,
} from '../events/outcomes';
import {
  getOperationSnapshotForKernel,
  MAX_RETAINED_OPERATION_SNAPSHOTS,
} from '../events/operation-coordinator';
import { createReflexRuntime, getRuntimeKernelForTests } from '../runtime/runtime';
import { waitForScheduled } from './test-utils';

describe('execution outcomes', () => {
  it('records explicit root and synchronous dispatch-effect causality', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'execution-outcomes',
    });
    runtime.regEvent('root', (_coeffects, amount: number) => [['dispatch', ['increment', amount]]]);
    runtime.regEvent('increment', ({ draftState }, amount: number) => {
      draftState.count += amount;
    });

    const kernel = getRuntimeKernelForTests(runtime);
    const outcomes: ExecutionOutcome[] = [];
    const stop = observeExecutionOutcomesForKernel(kernel, {
      onExecutionOutcome(outcome) {
        outcomes.push(outcome);
      },
    });

    runtime.dispatch(['root', 3]);
    await runtime.flush();

    const queued = outcomes.filter(
      (outcome): outcome is QueuedOutcome => outcome.type === 'queued',
    );
    expect(queued).toHaveLength(2);
    const root = queued[0]!.envelope;
    const child = queued[1]!.envelope;

    expect(child.operationId).toBe(root.operationId);
    expect(child.parentEventInstanceId).toBe(root.eventInstanceId);
    expect(child.sourceEffectId).toBe('dispatch');
    expect(child.sourceEffectIndex).toBe(0);
    expect(root.acceptedSequence).toBeLessThan(child.acceptedSequence);

    expect(
      outcomes.some(
        (outcome) =>
          outcome.type === 'commit' &&
          outcome.envelope.eventInstanceId === root.eventInstanceId &&
          outcome.status === 'unchanged',
      ),
    ).toBe(true);
    expect(
      outcomes.some(
        (outcome) =>
          outcome.type === 'effect' &&
          outcome.envelope.eventInstanceId === root.eventInstanceId &&
          outcome.effectId === 'dispatch' &&
          outcome.status === 'succeeded',
      ),
    ).toBe(true);
    expect(
      outcomes.some(
        (outcome) =>
          outcome.type === 'commit' &&
          outcome.envelope.eventInstanceId === child.eventInstanceId &&
          outcome.status === 'committed',
      ),
    ).toBe(true);
    expect(runtime.getState()).toEqual({ count: 3 });
    expect(getOperationSnapshotForKernel(kernel, root.operationId)).toMatchObject({
      status: 'completed',
      rootEventInstanceId: root.eventInstanceId,
      eventInstanceIds: [root.eventInstanceId, child.eventInstanceId],
      committedRevisions: [1],
      events: [
        { eventInstanceId: root.eventInstanceId, status: 'completed' },
        {
          eventInstanceId: child.eventInstanceId,
          parentEventInstanceId: root.eventInstanceId,
          sourceEffectId: 'dispatch',
          sourceEffectIndex: 0,
          status: 'completed',
        },
      ],
    });

    stop();
    runtime.dispose();
  });

  it('isolates outcome observers and preserves accepted queue order under re-entry', async () => {
    const runtime = createReflexRuntime({
      initialState: { order: [] as string[] },
      runtimeId: 'outcome-isolation',
    });
    runtime.regEvent('first', ({ draftState }) => {
      draftState.order.push('first');
    });
    runtime.regEvent('second', ({ draftState }) => {
      draftState.order.push('second');
    });

    const kernel = getRuntimeKernelForTests(runtime);
    const queued: QueuedOutcome[] = [];
    let reentered = false;
    observeExecutionOutcomesForKernel(kernel, {
      onExecutionOutcome(outcome) {
        if (outcome.type !== 'queued') return;
        queued.push(outcome);
        if (outcome.envelope.event[0] !== 'first' || reentered) return;
        reentered = true;
        expect(Object.isFrozen(outcome.envelope.event)).toBe(true);
        try {
          (outcome.envelope.event as unknown as string[])[0] = 'second';
        } catch {
          // The immutable observer snapshot is expected to reject this mutation.
        }
        runtime.dispatch(['second']);
      },
    });

    runtime.dispatch(['first']);
    await runtime.flush();

    expect(queued.map((outcome) => outcome.envelope.event[0])).toEqual(['first', 'second']);
    expect(queued[0]!.envelope.acceptedSequence).toBeLessThan(queued[1]!.envelope.acceptedSequence);
    expect(runtime.getState().order).toEqual(['first', 'second']);
    runtime.dispose();
  });

  it('records distinct causation for repeated dispatch effects and direct synchronous descendants', async () => {
    const runtime = createReflexRuntime({
      initialState: { values: [] as number[] },
      runtimeId: 'cause',
    });
    runtime.regEvent('root', ({ draftState }) => {
      draftState.values.push(0);
      runtime.dispatch(['child', 3]);
      return [
        ['dispatch', ['child', 1]],
        ['dispatch', ['child', 2]],
      ];
    });
    runtime.regEvent('child', ({ draftState }, value: number) => {
      draftState.values.push(value);
    });

    const kernel = getRuntimeKernelForTests(runtime);
    const queued: QueuedOutcome[] = [];
    observeExecutionOutcomesForKernel(kernel, {
      onExecutionOutcome(outcome) {
        if (outcome.type === 'queued') queued.push(outcome);
      },
    });

    runtime.dispatch(['root']);
    await runtime.flush();

    const [root, directChild, firstEffectChild, secondEffectChild] = queued.map(
      (outcome) => outcome.envelope,
    );
    expect(directChild).toMatchObject({
      operationId: root!.operationId,
      parentEventInstanceId: root!.eventInstanceId,
    });
    expect(firstEffectChild).toMatchObject({ sourceEffectId: 'dispatch', sourceEffectIndex: 0 });
    expect(secondEffectChild).toMatchObject({ sourceEffectId: 'dispatch', sourceEffectIndex: 1 });
    expect(runtime.getState().values).toEqual([0, 3, 1, 2]);
    runtime.dispose();
  });

  it('retains structured failures and does not reopen a rejected operation at publication', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'failure-outcomes',
    });
    runtime.regEvent('root', ({ draftState }) => {
      draftState.count += 1;
      return [['dispatch', ['rejected-child']]];
    });
    runtime.regEvent('rejected-child', () => {});
    runtime.observeLifecycle({
      onEventStarted(event) {
        return event[0] === 'rejected-child';
      },
    });

    const kernel = getRuntimeKernelForTests(runtime);
    let operationId = '';
    observeExecutionOutcomesForKernel(kernel, {
      onExecutionOutcome(outcome) {
        if (outcome.type === 'queued' && outcome.envelope.event[0] === 'root') {
          operationId = outcome.envelope.operationId;
        }
      },
    });
    runtime.dispatch(['root']);
    await runtime.flush();

    expect(getOperationSnapshotForKernel(kernel, operationId)).toMatchObject({
      status: 'rejected',
      publishedRevision: 1,
    });
    runtime.dispose();
  });

  it('settles a pending publication as failed when its runtime is disposed', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'dispose-outcomes',
    });
    runtime.regEvent('increment', ({ draftState }) => {
      draftState.count += 1;
    });
    const kernel = getRuntimeKernelForTests(runtime);
    let operationId = '';
    observeExecutionOutcomesForKernel(kernel, {
      onExecutionOutcome(outcome) {
        if (outcome.type === 'queued') operationId = outcome.envelope.operationId;
      },
    });

    runtime.dispatch(['increment']);
    await waitForScheduled();
    runtime.dispose();

    expect(getOperationSnapshotForKernel(kernel, operationId)).toMatchObject({ status: 'failed' });
  });

  it('bounds retained terminal operation snapshots', async () => {
    const runtime = createReflexRuntime({ initialState: {}, runtimeId: 'retention-outcomes' });
    runtime.regEvent('noop', () => {});
    const kernel = getRuntimeKernelForTests(runtime);
    const operationIds: string[] = [];
    observeExecutionOutcomesForKernel(kernel, {
      onExecutionOutcome(outcome) {
        if (outcome.type === 'queued') operationIds.push(outcome.envelope.operationId);
      },
    });

    for (let index = 0; index <= MAX_RETAINED_OPERATION_SNAPSHOTS; index++) {
      runtime.dispatch(['noop']);
    }
    await runtime.flush();

    expect(getOperationSnapshotForKernel(kernel, operationIds[0]!)).toBeUndefined();
    expect(getOperationSnapshotForKernel(kernel, operationIds.at(-1)!)).toMatchObject({
      status: 'completed',
    });
    runtime.dispose();
  });
});
