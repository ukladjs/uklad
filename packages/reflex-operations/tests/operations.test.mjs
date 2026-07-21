import assert from 'node:assert/strict';
import test from 'node:test';

import { createReflexRuntime } from '@flexsurfer/reflex';
import { createOperationClient } from '../dist/index.mjs';

test('records a runtime-local receipt after the queue publishes', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-test',
    initialDb: { count: 0 },
  });
  runtime.regEvent('increment', ({ draftDb }, amount) => {
    draftDb.count += amount;
  });
  runtime.regSub('count');

  const operations = createOperationClient(runtime);
  const result = await operations.dispatchAndWait(['increment', 2], {
    idempotencyKey: 'increment-2',
    observe: [['count']],
  });

  assert.equal(result.operation.status, 'completed');
  assert.deepEqual(result.operation.observations, [
    { query: ['count'], status: 'succeeded', value: 2 },
  ]);
  assert.equal(operations.get(result.operation.operationId)?.status, 'completed');

  const replay = await operations.dispatchAndWait(['increment', 2], {
    idempotencyKey: 'increment-2',
    observe: [['count']],
  });
  assert.equal(replay.replayed, true);
  assert.equal(runtime.getAppDb().count, 2);
  runtime.dispose();
});
