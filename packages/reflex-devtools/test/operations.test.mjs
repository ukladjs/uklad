import assert from 'node:assert/strict';
import test from 'node:test';

import { createReflexRuntimeForTests as createReflexRuntime } from '@flexsurfer/reflex/internal';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import { createReflexInspector } from '@flexsurfer/reflex/devtools';
import { createOperationClient } from '../dist/client/operations/client.js';
import { OperationCoordinator } from '../dist/client/operations/coordinator.js';
import { createOperationInspector } from '../dist/client/operations/inspector.js';

function operationsFor(runtime) {
  return createOperationClient(createReflexInspector(runtime).getOperationRuntime());
}

test('reads the canonical coordinator snapshot after dispatch', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-test',
    initialState: { count: 0 },
  });
  const testHarness = createReflexTestHarness(runtime);
  runtime.regEvent('increment', ({ draftState }, amount) => {
    draftState.count += amount;
  });

  try {
    const operations = operationsFor(runtime);
    const { operation } = await operations.dispatchAndWait(['increment', 2]);

    assert.equal(testHarness.getState().count, 2);
    assert.equal(operation.status, 'completed');
    assert.equal(operation.eventInstanceIds.length, 1);
    assert.deepEqual(operation.committedRevisions, [1]);
    assert.deepEqual(operation.errors, []);
    assert.deepEqual(operations.get(operation.operationId), operation);
  } finally {
    runtime.dispose();
  }
});

test('retains parent and effect lineage for a dispatch cascade', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-cascade',
    initialState: { count: 0 },
  });
  const testHarness = createReflexTestHarness(runtime);
  runtime.regEvent('root', () => [['dispatch', ['child', 3]]]);
  runtime.regEvent('child', ({ draftState }, amount) => {
    draftState.count += amount;
  });

  try {
    const { operation } = await operationsFor(runtime).dispatchAndWait(['root']);
    const [root, child] = operation.events;

    assert.equal(operation.status, 'completed');
    assert.equal(testHarness.getState().count, 3);
    assert.equal(root.status, 'completed');
    assert.equal(child.status, 'completed');
    assert.equal(child.parentEventInstanceId, root.eventInstanceId);
    assert.equal(child.sourceEffectId, 'dispatch');
    assert.equal(child.sourceEffectIndex, 0);
  } finally {
    runtime.dispose();
  }
});

test('keeps concurrently accepted root operations separate', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-concurrent',
    initialState: { count: 0 },
  });
  const testHarness = createReflexTestHarness(runtime);
  runtime.regEvent('increment', ({ draftState }, amount) => {
    draftState.count += amount;
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
  const runtime = createReflexRuntime({
    runtimeId: 'operations-effects',
    initialState: { saved: false },
  });
  runtime.regEffect('save', () => {});
  runtime.regEvent('save', ({ draftState }) => {
    draftState.saved = true;
    return [['save', { source: 'operation-test' }]];
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

test('retains terminal failure and effect-error states', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-failures',
    initialState: { count: 0 },
  });
  runtime.regEvent('explode', () => {
    throw new Error('expected failure');
  });
  runtime.regEvent('unhandled-effect', () => [['not-registered', { retry: false }]]);

  try {
    const operations = operationsFor(runtime);
    const failed = await operations.dispatchAndWait(['explode']);
    const effectFailure = await operations.dispatchAndWait(['unhandled-effect']);

    assert.equal(failed.operation.status, 'failed');
    assert.equal(failed.operation.events[0].status, 'failed');
    assert.equal(effectFailure.operation.status, 'completed-with-errors');
    assert.equal(effectFailure.operation.events[0].effects[0].status, 'unhandled');
  } finally {
    runtime.dispose();
  }
});

test('returns a retained failed operation when the runtime is disposed with queued work', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-disposal',
    initialState: { count: 0 },
  });
  runtime.regEvent('later', ({ draftState }) => {
    draftState.count += 1;
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
  const runtime = createReflexRuntime({
    runtimeId: 'operations-inspector',
    initialState: { count: 0 },
  });
  runtime.regEvent('increment', ({ draftState }) => {
    draftState.count += 1;
  });

  try {
    const inspector = createOperationInspector(createReflexInspector(runtime));
    const { operation } = await inspector.executeEvent(['increment']);

    assert.equal(operation.status, 'completed');
    assert.deepEqual(inspector.getOperation(operation.operationId), operation);
  } finally {
    runtime.dispose();
  }
});
