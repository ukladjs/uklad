import assert from 'node:assert/strict';
import test from 'node:test';

import { createReflexRuntime } from '@flexsurfer/reflex';
import { createOperationClient, createOperationInspector } from '../dist/index.mjs';

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

test('returns the fully settled subscription wave, including equal-value recomputations', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-subscriptions',
    initialDb: { count: 0, label: 'initial' },
  });
  runtime.regEvent('increment', ({ draftDb }) => {
    draftDb.count += 1;
  });
  runtime.regSub('count');
  runtime.regSub(
    'count-label',
    (count) => `count:${count}`,
    () => [['count']],
  );
  const unwatch = runtime.watchSubscription(['count-label'], () => {});

  const { operation } = await createOperationClient(runtime).dispatchAndWait(['increment']);

  assert.equal(operation.subscriptions.status, 'settled');
  assert.equal(operation.subscriptions.publishedRevision, 1);
  assert.deepEqual(
    operation.subscriptions.recalculated.map(({ version: _version, ...subscription }) => subscription),
    [
      {
        key: '["count"]',
        query: ['count'],
        kind: 'root',
        active: true,
        status: 'value',
        value: 1,
      },
      {
        key: '["count-label"]',
        query: ['count-label'],
        kind: 'computed',
        active: true,
        status: 'value',
        value: 'count:1',
      },
    ],
  );
  assert.ok(operation.subscriptions.recalculated.every(({ version }) => version > 0));

  unwatch();
  runtime.dispose();
});

test('does not attribute another operation’s publication wave to an unchanged operation', async () => {
  const runtime = createReflexRuntime({
    runtimeId: 'operations-unrelated-publication',
    initialDb: { count: 0 },
  });
  runtime.regEvent('noop', () => {});
  runtime.regEvent('increment', ({ draftDb }) => {
    draftDb.count += 1;
  });
  runtime.regSub('count');
  const unwatch = runtime.watchSubscription(['count'], () => {});
  const operations = createOperationClient(runtime);

  const unchanged = operations.dispatchAndWait(['noop']);
  runtime.dispatch(['increment']);

  const { operation } = await unchanged;
  assert.equal(operation.state.status, 'unchanged');
  assert.deepEqual(operation.subscriptions.recalculated, []);

  unwatch();
  runtime.dispose();
});

test('captures a dispatch-effect cascade, effects, and committed patches', async () => {
  const runtime = createReflexRuntime({ runtimeId: 'operations-cascade', initialDb: { count: 0 } });
  runtime.regEvent('root', () => [['dispatch', ['child', 3]]]);
  runtime.regEvent('child', ({ draftDb }, amount) => {
    draftDb.count += amount;
  });

  const { operation } = await createOperationClient(runtime).dispatchAndWait(['root']);

  assert.deepEqual(operation.events.map(({ event }) => event), [['root'], ['child', 3]]);
  assert.deepEqual(operation.effects, {
    status: 'succeeded',
    truncated: false,
    items: [
      {
        effectId: operation.effects.items[0].effectId,
        eventInstanceId: operation.events[0].eventInstanceId,
        type: 'dispatch',
        value: ['child', 3],
        mode: 'runtime-defined',
        status: 'succeeded',
        startedAt: operation.effects.items[0].startedAt,
        completedAt: operation.effects.items[0].completedAt,
        durationMs: operation.effects.items[0].durationMs,
      },
    ],
  });
  assert.deepEqual(operation.state.patches, [{ op: 'replace', path: ['count'], value: 3 }]);
  runtime.dispose();
});

test('keeps synchronous cascades causally separate while queue work interleaves', async () => {
  const runtime = createReflexRuntime({ runtimeId: 'operations-interleaving', initialDb: { count: 0, nested: 0 } });
  runtime.regEvent('a/root', () => [['dispatch', ['a/child']], ['dispatch', ['a/branch']]]);
  runtime.regEvent('a/child', ({ draftDb }) => {
    draftDb.count += 1;
    return [['dispatch', ['a/grandchild']]];
  });
  runtime.regEvent('a/branch', ({ draftDb }) => {
    draftDb.nested += 1;
  });
  runtime.regEvent('a/grandchild', ({ draftDb }) => {
    draftDb.count += 1;
  });
  runtime.regEvent('b/root', ({ draftDb }) => {
    draftDb.count += 10;
    return [['dispatch', ['b/child']]];
  });
  runtime.regEvent('b/child', ({ draftDb }) => {
    draftDb.count += 10;
  });

  const operations = createOperationClient(runtime);
  const [a, b] = await Promise.all([
    operations.dispatchAndWait(['a/root']),
    operations.dispatchAndWait(['b/root']),
  ]);
  assert.deepEqual(a.operation.events.map((event) => event.event[0]), [
    'a/root',
    'a/child',
    'a/branch',
    'a/grandchild',
  ]);
  assert.deepEqual(b.operation.events.map((event) => event.event[0]), ['b/root', 'b/child']);
  assert.equal(a.operation.events[1].parentEventInstanceId, a.operation.events[0].eventInstanceId);
  assert.equal(a.operation.events[3].parentEventInstanceId, a.operation.events[1].eventInstanceId);
  assert.equal(a.operation.revisions.concurrentChangesObserved, true);
  assert.equal(b.operation.revisions.concurrentChangesObserved, true);
  assert.deepEqual(runtime.getAppDb(), { count: 22, nested: 1 });
  runtime.dispose();
});

test('records failure, detached, returned, malformed, and unhandled effect outcomes', async () => {
  const runtime = createReflexRuntime({ runtimeId: 'operations-effects', initialDb: { count: 0 } });
  runtime.regEffect('explode', () => {
    throw new Error('external write failed');
  });
  runtime.regEffect('void-effect', () => {});
  runtime.regEffect('promise-effect', () => Promise.resolve());
  runtime.regEvent('explode', ({ draftDb }) => {
    draftDb.count += 1;
    return [['explode']];
  });
  runtime.regEvent('returned', () => [['void-effect']]);
  runtime.regEvent('detached', () => [['promise-effect']]);
  runtime.regEvent('bad', () => ({ no: 'effects vector' }));
  runtime.regEvent('unhandled', () => [['not-registered']]);
  const operations = createOperationClient(runtime);

  const failed = await operations.dispatchAndWait(['explode']);
  assert.equal(failed.operation.outcome, 'effects-failed');
  assert.equal(failed.operation.state.status, 'committed');
  assert.equal(failed.operation.effects.items[0].status, 'failed');
  assert.equal(failed.operation.effects.items[0].error.kind, 'effect');
  const returned = await operations.dispatchAndWait(['returned']);
  assert.equal(returned.operation.outcome, 'incomplete');
  assert.equal(returned.operation.effects.items[0].status, 'returned');
  const detached = await operations.dispatchAndWait(['detached']);
  assert.equal(detached.operation.outcome, 'incomplete');
  assert.equal(detached.operation.effects.items[0].status, 'detached');
  const malformed = await operations.dispatchAndWait(['bad']);
  assert.equal(malformed.operation.outcome, 'effects-failed');
  assert.equal(malformed.operation.effects.items[0].status, 'invalid');
  const unhandled = await operations.dispatchAndWait(['unhandled']);
  assert.equal(unhandled.operation.outcome, 'effects-failed');
  assert.equal(unhandled.operation.effects.items[0].status, 'unhandled');
  runtime.dispose();
});

test('records missing coeffects before a state commit and rejects stale revisions', async () => {
  const runtime = createReflexRuntime({ runtimeId: 'operations-preconditions', initialDb: { count: 0 } });
  runtime.regEvent('needs-coeffect', ({ draftDb }) => {
    draftDb.count = 10;
  }, { coeffects: [['missing-coeffect']] });
  runtime.regEvent('increment', ({ draftDb }, amount) => {
    draftDb.count += amount;
  });
  const operations = createOperationClient(runtime);

  const coeffect = await operations.dispatchAndWait(['needs-coeffect']);
  assert.equal(coeffect.operation.status, 'failed');
  assert.equal(coeffect.operation.state.status, 'failed');
  assert.equal(coeffect.operation.events[0].state.status, 'not-attempted');
  assert.ok(coeffect.operation.errors.some((error) => error.kind === 'missing-coeffect'));
  assert.equal(runtime.getAppDb().count, 0);

  const [first, stale] = await Promise.all([
    operations.dispatchAndWait(['increment', 1]),
    operations.dispatchAndWait(['increment', 10], { expectedRevision: 0 }),
  ]);
  assert.equal(first.operation.outcome, 'succeeded');
  assert.equal(stale.operation.status, 'rejected');
  assert.equal(stale.operation.errors[0].kind, 'revision-conflict');
  assert.equal(stale.operation.revisions.rootStart, 1);
  assert.equal(runtime.getAppDb().count, 1);
  runtime.dispose();
});

test('times out only delivery, supports idempotent lookup, and returns isolated snapshots', async () => {
  const runtime = createReflexRuntime({ runtimeId: 'operations-ledger', initialDb: { count: 0 } });
  runtime.regEvent('blocker', () => {});
  runtime.regEvent('increment', ({ draftDb }, amount) => {
    draftDb.count += amount;
  });
  const operations = createOperationClient(runtime);
  const blocker = ['blocker'];
  blocker.meta = { flush: true };
  runtime.dispatch(blocker);

  const timedOut = await operations.dispatchAndWait(['increment', 1], {
    timeoutMs: 1,
    idempotencyKey: 'one-increment',
  });
  assert.equal(timedOut.delivery.status, 'timed-out');
  await runtime.flush().catch(() => {});
  const settled = operations.get({ idempotencyKey: 'one-increment' });
  assert.equal(settled.status, 'completed');
  assert.equal(settled.outcome, 'succeeded');
  const replay = await operations.dispatchAndWait(['increment', 1], { idempotencyKey: 'one-increment' });
  assert.equal(replay.replayed, true);
  const conflict = await operations.dispatchAndWait(['increment', 2], { idempotencyKey: 'one-increment' });
  assert.equal(conflict.operation.status, 'rejected');
  assert.equal(conflict.operation.errors[0].kind, 'idempotency-conflict');
  settled.events[0].event[1] = 999;
  assert.equal(operations.get(settled.operationId).events[0].event[1], 1);
  runtime.dispose();
});

test('owns caller input, settles disposal, and exposes the optional inspector adapter', async () => {
  const runtime = createReflexRuntime({ runtimeId: 'operations-ownership', initialDb: { count: 0 } });
  runtime.regEvent('from-input', ({ draftDb }, input) => {
    draftDb.count += input.amount;
  });
  const operations = createOperationClient(runtime);
  const input = { amount: 2 };
  const handle = operations.start(['from-input', input]);
  input.amount = 100;
  const result = await handle.result;
  assert.equal(result.operation.events[0].event[1].amount, 2);
  assert.equal(runtime.getAppDb().count, 2);

  const inspector = createOperationInspector(runtime);
  assert.equal(inspector.operationApiVersion, 1);
  assert.equal(inspector.runtimeInstanceId, runtime.runtimeInstanceId);
  const fromInspector = await inspector.executeEvent(['from-input', { amount: 3 }]);
  assert.equal(fromInspector.operation.outcome, 'succeeded');

  const pending = operations.start(['from-input', { amount: 1 }]);
  runtime.dispose();
  const disposed = await pending.result;
  assert.equal(disposed.operation.status, 'failed');
  assert.ok(disposed.operation.errors.some((error) => error.kind === 'disposed'));
});

test('captures final interceptor commits and keeps a failed operation from contaminating later queue work', async () => {
  const runtime = createReflexRuntime({ runtimeId: 'operations-final-db', initialDb: { count: 0 } });
  runtime.regEvent('replace-final-db', ({ draftDb }) => {
    draftDb.count = 1;
  }, [{
    id: 'replace-final-db',
    after(context) {
      return { ...context, newDb: { count: 42 } };
    },
  }]);
  runtime.regEvent('boom', () => {
    throw new Error('queue failed');
  });
  runtime.regEvent('increment', ({ draftDb }) => {
    draftDb.count += 1;
  });
  const operations = createOperationClient(runtime);

  const replaced = await operations.dispatchAndWait(['replace-final-db']);
  assert.deepEqual(replaced.operation.events[0].state.plannedPatches, [
    { op: 'replace', path: ['count'], value: 1 },
  ]);
  assert.deepEqual(replaced.operation.events[0].state.committedPatches, [
    { op: 'replace', path: [], value: { count: 42 } },
  ]);

  const [failed, unaffected] = await Promise.all([
    operations.dispatchAndWait(['boom']),
    operations.dispatchAndWait(['increment']),
  ]);
  assert.equal(failed.operation.status, 'failed');
  assert.equal(failed.operation.outcome, 'failed');
  assert.equal(unaffected.operation.outcome, 'succeeded');
  assert.equal(runtime.getAppDb().count, 43);
  runtime.dispose();
});

test('validates operation input, records invalid dispatch effects, and rejects disposal from an effect', async () => {
  const runtime = createReflexRuntime({ runtimeId: 'operations-guards', initialDb: { count: 0 } });
  runtime.regEvent('from-input', ({ draftDb }, input) => {
    draftDb.count += input.amount;
  });
  runtime.regEvent('bad-dispatch', () => [['dispatch', 'not-an-event-vector']]);
  runtime.regEffect('dispose-runtime', () => runtime.dispose());
  runtime.regEvent('dispose-from-effect', ({ draftDb }) => {
    draftDb.count += 1;
    return [['dispose-runtime']];
  });
  const operations = createOperationClient(runtime);

  assert.throws(
    () => operations.start(['from-input', { amount: 1, fn: () => {} }]),
    /structured-cloneable/,
  );
  assert.throws(
    () => operations.start(['from-input', { amount: 1 }], { unexpected: true }),
    /Unknown operation option/,
  );
  const invalid = await operations.dispatchAndWait(['bad-dispatch']);
  assert.equal(invalid.operation.outcome, 'effects-failed');
  assert.equal(invalid.operation.effects.items[0].status, 'failed');
  assert.equal(invalid.operation.effects.items[0].type, 'dispatch');
  const disposeAttempt = await operations.dispatchAndWait(['dispose-from-effect']);
  assert.equal(disposeAttempt.operation.outcome, 'effects-failed');
  assert.equal(disposeAttempt.operation.effects.items[0].status, 'failed');
  assert.equal(runtime.getAppDb().count, 1);
  runtime.dispose();
});
