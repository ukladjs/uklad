import assert from 'node:assert/strict';
import test from 'node:test';

import { createUkladRuntime } from '@ukladjs/core';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import { createUkladInspector } from '@ukladjs/core/devtools';
import { createOperationClient } from '../dist/client/operations/client.js';
import { OperationCoordinator } from '../dist/client/operations/coordinator.js';
import { createOperationInspector } from '../dist/client/operations/inspector.js';

const waitForTraceFlush = () => new Promise((resolve) => setTimeout(resolve, 80));

function operationsFor(runtime, evidence) {
  return createOperationClient(createUkladInspector(runtime).getOperationRuntime(), evidence);
}

test('reads the DevTools operation snapshot after dispatch', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-test',
    initialState: { count: 0 },
  });
  const testHarness = createUkladTestHarness(runtime);
  runtime.registerModule((registrar) => {
    registrar.regEvent('increment', ({ draftState }, amount) => {
      draftState.count += amount;
    });
  });

  try {
    const operations = operationsFor(runtime);
    const { operation } = await operations.dispatchAndWait(['increment', 2]);

    assert.equal(testHarness.getState().count, 2);
    assert.equal(operation.schemaVersion, 0);
    assert.equal(operation.runtimeInstanceId, runtime.runtimeInstanceId);
    assert.equal(operation.completion, 'cascade-published');
    assert.equal(operation.status, 'completed');
    assert.equal(operation.eventInstanceIds.length, 1);
    assert.equal(operation.events[0].eventId, 'increment');
    assert.equal(operation.events[0].stateStatus, 'committed');
    assert.equal('statePatches' in operation.events[0], false);
    assert.deepEqual(operation.committedRevisions, [1]);
    assert.deepEqual(operation.errors, []);
    assert.deepEqual(operation.summary, {
      eventCount: 1,
      state: { committed: 1, unchanged: 0, skipped: 0 },
      effects: {
        total: 0,
        succeeded: 0,
        returned: 0,
        failed: 0,
        unhandled: 0,
        invalid: 0,
        detached: 0,
      },
      errorCount: 0,
    });
    assert.equal(operation.hasDetachedEffects, false);
    assert.deepEqual(operation.evidence, {
      stateChanges: 'none',
      retainedStatePatchCount: 0,
      statePatchesTruncated: false,
    });
    assert.deepEqual(operations.get(operation.operationId), operation);
  } finally {
    runtime.dispose();
  }
});

test('collects opt-in forward state patches without tracing', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-state-patches',
    initialState: { count: 0 },
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('increment', ({ draftState }, amount) => {
      draftState.count += amount;
    });
  });

  try {
    const { operation } = await operationsFor(runtime, {
      stateChanges: 'patches',
    }).dispatchAndWait(['increment', 2]);

    assert.deepEqual(operation.evidence, {
      stateChanges: 'patches',
      retainedStatePatchCount: 1,
      statePatchesTruncated: false,
    });
    assert.deepEqual(operation.events[0].statePatches, [
      { op: 'replace', path: ['count'], value: 2 },
    ]);
  } finally {
    runtime.dispose();
  }
});

test('retains parent and effect lineage for a dispatch cascade', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-cascade',
    initialState: { count: 0 },
  });
  const testHarness = createUkladTestHarness(runtime);
  runtime.registerModule((registrar) => {
    registrar.regEvent('root', () => [['dispatch', ['child', 3]]]);
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('child', ({ draftState }, amount) => {
      draftState.count += amount;
    });
  });

  try {
    const { operation } = await operationsFor(runtime).dispatchAndWait(['root']);
    const [root, child] = operation.events;

    assert.equal(operation.status, 'completed');
    assert.equal(testHarness.getState().count, 3);
    assert.equal(root.status, 'completed');
    assert.equal(child.status, 'completed');
    assert.equal(root.eventId, 'root');
    assert.equal(root.stateStatus, 'unchanged');
    assert.equal(child.eventId, 'child');
    assert.equal(child.stateStatus, 'committed');
    assert.equal(child.parentEventInstanceId, root.eventInstanceId);
    assert.equal(child.sourceEffectId, 'dispatch');
    assert.equal(child.sourceEffectIndex, 0);
  } finally {
    runtime.dispose();
  }
});

test('shares core event metadata between operation snapshots and traces', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-trace-correlation',
    initialState: { count: 0 },
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('root', () => [['dispatch', ['child', 3]]]);
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('child', ({ draftState }, amount) => {
      draftState.count += amount;
    });
  });

  const inspector = createUkladInspector(runtime);
  const traces = [];
  const unsubscribe = inspector.subscribeTraces((batch) => traces.push(...batch));
  try {
    const { operation } = await createOperationClient(
      inspector.getOperationRuntime(),
    ).dispatchAndWait(['root']);
    await waitForTraceFlush();

    const [rootEvent, childEvent] = operation.events;
    const rootTrace = traces.find((trace) => trace.eventInstanceId === rootEvent.eventInstanceId);
    const childTrace = traces.find((trace) => trace.eventInstanceId === childEvent.eventInstanceId);

    assert.equal(rootTrace.runtimeInstanceId, operation.runtimeInstanceId);
    assert.equal(rootTrace.operation, 'root');
    assert.equal(rootTrace.parentEventInstanceId, undefined);
    assert.equal(rootTrace.acceptedRevision, rootEvent.acceptedRevision);
    assert.equal(rootTrace.startedRevision, rootEvent.startedRevision);
    assert.equal(rootTrace.committedRevision, rootEvent.committedRevision);
    assert.equal(rootTrace.stateStatus, rootEvent.stateStatus);
    assert.equal(childTrace.runtimeInstanceId, operation.runtimeInstanceId);
    assert.equal(childTrace.operation, 'child');
    assert.equal(childTrace.parentEventInstanceId, rootEvent.eventInstanceId);
    assert.equal(childTrace.acceptedRevision, childEvent.acceptedRevision);
    assert.equal(childTrace.startedRevision, childEvent.startedRevision);
    assert.equal(childTrace.committedRevision, childEvent.committedRevision);
    assert.equal(childTrace.stateStatus, childEvent.stateStatus);
    assert.equal(childEvent.parentEventInstanceId, rootEvent.eventInstanceId);
  } finally {
    unsubscribe();
    runtime.dispose();
  }
});

test('keeps concurrently accepted root operations separate', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-concurrent',
    initialState: { count: 0 },
  });
  const testHarness = createUkladTestHarness(runtime);
  runtime.registerModule((registrar) => {
    registrar.regEvent('increment', ({ draftState }, amount) => {
      draftState.count += amount;
    });
  });

  try {
    const operations = operationsFor(runtime);
    const [first, second] = await Promise.all([
      operations.dispatchAndWait(['increment', 1]),
      operations.dispatchAndWait(['increment', 10]),
    ]);

    assert.equal(testHarness.getState().count, 11);
    assert.notEqual(first.operation.operationId, second.operation.operationId);
    assert.equal(first.operation.events.length, 1);
    assert.equal(second.operation.events.length, 1);
    assert.deepEqual(first.operation.committedRevisions, [1]);
    assert.deepEqual(second.operation.committedRevisions, [2]);
  } finally {
    runtime.dispose();
  }
});

test('records effect evidence through the execution probe', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-effects',
    initialState: { saved: false },
  });
  runtime.registerModule((registrar) => {
    registrar.regEffect('save', () => {});
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('save', ({ draftState }) => {
      draftState.saved = true;
      return [['save', { source: 'operation-test' }]];
    });
  });

  try {
    const operations = operationsFor(runtime);
    const { operation } = await operations.dispatchAndWait(['save']);
    const [event] = operation.events;

    assert.equal(operation.status, 'completed');
    assert.equal(event.effects.length, 1);
    assert.deepEqual(event.effects[0].id, 'save');
    assert.deepEqual(event.effects[0].value, { source: 'operation-test' });
    assert.equal(event.effects[0].index, 0);
    assert.equal(event.effects[0].status, 'returned');
    assert.equal(event.effects[0].durationMs >= 0, true);
    assert.throws(() => {
      event.effects[0].value.source = 'mutated';
    }, TypeError);
    assert.deepEqual(operations.get(operation.operationId).events[0].effects[0].value, {
      source: 'operation-test',
    });
    assert.deepEqual(operation.summary.effects, {
      total: 1,
      succeeded: 0,
      returned: 1,
      failed: 0,
      unhandled: 0,
      invalid: 0,
      detached: 0,
    });
  } finally {
    runtime.dispose();
  }
});

test('reports publishing until the committed revision is published', () => {
  const coordinator = new OperationCoordinator('operations-publishing');
  const reference = coordinator.accept(['increment']);

  coordinator.queued(reference, 0);
  coordinator.started(reference, 0);
  coordinator.transition(reference, 'completed');
  coordinator.committed(reference, 'committed', 1);
  coordinator.finished(reference, 'completed');

  assert.equal(coordinator.get(reference.operationId).status, 'publishing');
  coordinator.published(1);
  assert.equal(coordinator.get(reference.operationId).status, 'completed');
});

test('bounds retained state patches and reports truncation', () => {
  const coordinator = new OperationCoordinator('operations-patch-limit', {
    stateChanges: 'patches',
  });
  const reference = coordinator.accept(['bulk-update']);
  const patches = Array.from({ length: 129 }, (_, index) => ({
    op: 'replace',
    path: ['items', index],
    value: index,
  }));

  coordinator.transition(reference, 'completed', undefined, patches);
  const operation = coordinator.get(reference.operationId);

  assert.equal(operation.events[0].statePatches.length, 128);
  assert.equal(operation.events[0].statePatchesTruncated, true);
  assert.deepEqual(operation.evidence, {
    stateChanges: 'patches',
    retainedStatePatchCount: 128,
    statePatchesTruncated: true,
  });
});

test('retains terminal failure and effect-error states', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-failures',
    initialState: { count: 0 },
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('explode', () => {
      throw new Error('expected failure');
    });
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('unhandled-effect', () => [['not-registered', { retry: false }]]);
  });

  try {
    const operations = operationsFor(runtime);
    const failed = await operations.dispatchAndWait(['explode']);
    const effectFailure = await operations.dispatchAndWait(['unhandled-effect']);
    const missing = await operations.dispatchAndWait(['missing-handler']);

    assert.equal(failed.operation.status, 'failed');
    assert.equal(failed.operation.events[0].status, 'failed');
    assert.equal(effectFailure.operation.status, 'completed-with-errors');
    assert.equal(effectFailure.operation.events[0].effects[0].status, 'unhandled');
    assert.equal(effectFailure.operation.events[0].stateStatus, 'unchanged');
    assert.equal(effectFailure.operation.summary.effects.unhandled, 1);
    assert.equal(missing.operation.status, 'failed');
    assert.equal(missing.operation.events[0].stateStatus, 'skipped');
  } finally {
    runtime.dispose();
  }
});

test('records a rejected detached effect as a late failure', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-detached-rejection',
    initialState: { saved: false },
  });
  let rejectEffect;
  runtime.registerModule((registrar) => {
    registrar.regEffect('save', () => new Promise((_resolve, reject) => (rejectEffect = reject)));
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('save', () => [['save', { source: 'detached-test' }]]);
  });

  try {
    const operations = operationsFor(runtime);
    const { operation } = await operations.dispatchAndWait(['save']);

    assert.equal(operation.status, 'completed');
    assert.equal(operation.events[0].effects.length, 1);
    assert.equal(operation.events[0].effects[0].status, 'detached');
    assert.equal(operation.summary.effects.detached, 1);
    assert.equal(operation.hasDetachedEffects, true);

    rejectEffect(new Error('detached effect failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const settled = operations.get(operation.operationId);
    const [detached, failed] = settled.events[0].effects;
    assert.equal(detached.status, 'detached');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.id, 'save');
    assert.equal(failed.index, 0);
    assert.equal(failed.error.message, 'detached effect failed');
    assert.equal(settled.errors.length, 1);
    assert.equal(settled.summary.effects.detached, 1);
    assert.equal(settled.summary.effects.failed, 1);
    assert.equal(settled.hasDetachedEffects, true);
    // The recorded error must move the settled operation off `completed`.
    assert.equal(settled.status, 'completed-with-errors');
  } finally {
    runtime.dispose();
  }
});

test('returns a retained failed operation when the runtime is disposed with queued work', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-disposal',
    initialState: { count: 0 },
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('later', ({ draftState }) => {
      draftState.count += 1;
    });
  });

  try {
    const operations = operationsFor(runtime);
    const event = ['later'];
    event.meta = { flush: true };
    const handle = operations.start(event);
    runtime.dispose();

    const { operation } = await handle.result;
    assert.equal(operation.status, 'failed');
    assert.equal(operation.events[0].status, 'dropped');
  } finally {
    runtime.dispose();
  }
});

test('decorates an inspector without creating a second operation ledger', async () => {
  const runtime = createUkladRuntime({
    runtimeId: 'operations-inspector',
    initialState: { count: 0 },
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('increment', ({ draftState }) => {
      draftState.count += 1;
    });
  });

  try {
    const inspector = createOperationInspector(createUkladInspector(runtime));
    const { operation } = await inspector.executeEvent(['increment']);

    assert.equal(operation.status, 'completed');
    assert.deepEqual(inspector.getOperation(operation.operationId), operation);
  } finally {
    runtime.dispose();
  }
});
