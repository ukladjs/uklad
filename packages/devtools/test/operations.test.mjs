import assert from 'node:assert/strict';
import test from 'node:test';

import { createUkladRuntime } from '@ukladjs/core';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import { createUkladInspector } from '@ukladjs/core/devtools';
import { createOperationClient } from '../dist/client/operations/client.js';
import { OperationCoordinator } from '../dist/client/operations/coordinator.js';
import { createOperationInspector } from '../dist/client/operations/inspector.js';

function operationsFor(runtime) {
  return createOperationClient(createUkladInspector(runtime).getOperationRuntime());
}

test('reads the canonical coordinator snapshot after dispatch', async () => {
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
    assert.equal(child.parentEventInstanceId, root.eventInstanceId);
    assert.equal(child.sourceEffectId, 'dispatch');
    assert.equal(child.sourceEffectIndex, 0);
  } finally {
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

    assert.equal(failed.operation.status, 'failed');
    assert.equal(failed.operation.events[0].status, 'failed');
    assert.equal(effectFailure.operation.status, 'completed-with-errors');
    assert.equal(effectFailure.operation.events[0].effects[0].status, 'unhandled');
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
