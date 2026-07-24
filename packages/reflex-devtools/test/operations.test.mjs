import assert from 'node:assert/strict';
import test from 'node:test';

import { createReflexRuntime } from '@flexsurfer/reflex';
import { createOperationClient } from '../dist/client/operations/client.js';
import { createOperationInspector } from '../dist/client/operations/inspector.js';

function operationsFor(runtime) {
  return createOperationClient(runtime.createInspector().getOperationRuntime());
}

test('reads the canonical coordinator snapshot after dispatch', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-test',
    initialState: { count: 0 },
  });
  runtime.regEvent('increment', ({ draftState }, amount) => {
    draftState.count += amount;
  });

  try {
    const operations = operationsFor(runtime);
    const { operation } = await operations.dispatchAndWait(['increment', 2]);

    assert.equal(runtime.getState().count, 2);
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
  runtime.regEvent('root', () => [['dispatch', ['child', 3]]]);
  runtime.regEvent('child', ({ draftState }, amount) => {
    draftState.count += amount;
  });

  try {
    const { operation } = await operationsFor(runtime).dispatchAndWait(['root']);
    const [root, child] = operation.events;

    assert.equal(operation.status, 'completed');
    assert.equal(runtime.getState().count, 3);
    assert.equal(root.status, 'completed');
    assert.equal(child.status, 'completed');
    assert.equal(child.parentEventInstanceId, root.eventInstanceId);
    assert.equal(child.sourceEffectId, 'dispatch');
    assert.equal(child.sourceEffectIndex, 0);
  } finally {
    runtime.dispose();
  }
});

test('records effect evidence through the lifecycle attachment', async () => {
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
    const { operation } = await operationsFor(runtime).dispatchAndWait(['save']);
    const [event] = operation.events;

    assert.equal(operation.status, 'completed');
    assert.equal(event.effects.length, 1);
    assert.deepEqual(event.effects[0].id, 'save');
    assert.deepEqual(event.effects[0].value, { source: 'operation-test' });
    assert.equal(event.effects[0].index, 0);
    assert.equal(event.effects[0].status, 'returned');
    assert.equal(event.effects[0].durationMs >= 0, true);
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
    const inspector = createOperationInspector(runtime.createInspector());
    const { operation } = await inspector.executeEvent(['increment']);

    assert.equal(operation.status, 'completed');
    assert.deepEqual(inspector.getOperation(operation.operationId), operation);
  } finally {
    runtime.dispose();
  }
});
