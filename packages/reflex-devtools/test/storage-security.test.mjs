import assert from 'node:assert/strict';
import test from 'node:test';

import { TraceStorage } from '../dist/server/storage.js';

test('trace retention never spreads attacker-controlled batches', () => {
  const storage = new TraceStorage(10);
  storage.addTraces(
    Array.from({ length: 20_000 }, (_, id) => ({
      id,
      start: id,
      operation: 'bounded',
      opType: 'event',
    })),
  );

  assert.equal(storage.getStats().totalTraces, 10);
  assert.equal(storage.getTrace(19_999)?.id, 19_999);
});

test('active subscription count and byte limits reject updates atomically', () => {
  const storage = new TraceStorage(10, 2, 128);
  storage.updateActiveSubs({ first: 'one', second: 'two' });

  assert.throws(
    () => storage.updateActiveSubs({ third: 'three' }),
    /Active subscription retention limit exceeded/,
  );
  assert.deepEqual(
    Object.keys(storage.getActiveSubs()).sort(),
    ['first', 'second'],
  );

  assert.throws(
    () => storage.updateActiveSubs({ first: 'x'.repeat(256) }),
    /Active subscription retention limit exceeded/,
  );
  assert.equal(storage.getActiveSubs().first, 'one');
});

test('app state growth is bounded without corrupting the retained snapshot', () => {
  const storage = new TraceStorage(10, 10, 1024, 128);
  storage.updateAppState({ message: 'safe' });

  assert.throws(
    () => storage.updateAppState({ message: 'x'.repeat(256) }),
    /App state retention limit exceeded/,
  );
  assert.deepEqual(storage.getAppState(), { message: 'safe' });

  const stateRetentionRejected = storage.addTraces([
    {
      id: 1,
      start: 1,
      operation: 'grow',
      opType: 'event',
      tags: {
        patches: [
          {
            op: 'replace',
            path: ['message'],
            value: 'y'.repeat(256),
          },
        ],
      },
    },
  ]);
  assert.equal(stateRetentionRejected, true);
  assert.deepEqual(storage.getAppState(), { message: 'safe' });
});
