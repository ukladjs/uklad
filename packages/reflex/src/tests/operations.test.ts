import type { ReflexContracts } from '../contracts';
import { createReflexRuntime, type ReflexRuntime } from '../runtime/runtime';
import type { EventVector } from '../types';

interface OperationContracts extends ReflexContracts {
  db: { count: number; nested: { value: number } };
  events: {
    increment: [amount: number];
    'increment-from': [input: { amount: number }];
    root: [];
    child: [amount: number];
    grandchild: [amount: number];
    'commit-then-fail': [];
    'set-nested': [value: number];
    blocker: [];
    boom: [];
    'start-deferred': [];
    'needs-coeffect': [];
    'a-root': [];
    'a-child': [];
    'a-branch': [];
    'a-grandchild': [];
    'b-root': [];
    'b-child': [];
    'root-missing-child': [];
    'malformed-effects': [];
    'invalid-dispatch-effect': [];
    'replace-final-db': [];
    'custom-returned-effect': [];
    'dispose-from-effect': [];
  };
  effects: {
    explode: void;
    deferred: void;
    custom: void;
    'dispose-runtime': void;
  };
  subscriptions: {
    count: { params: []; result: number };
  };
}

type OperationRuntime = ReflexRuntime<OperationContracts>;

const ownedRuntimes: OperationRuntime[] = [];

function createOperationRuntime(runtimeId: string): OperationRuntime {
  const runtime = createReflexRuntime<OperationContracts>({
    initialDb: { count: 0, nested: { value: 0 } },
    runtimeId,
  });
  runtime.regSub('count');
  ownedRuntimes.push(runtime);
  return runtime;
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Operation did not settle within ${timeoutMs} ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

afterEach(() => {
  for (const runtime of ownedRuntimes.splice(0)) runtime.dispose();
});

describe('authoritative runtime operations', () => {
  it('separates concurrent invocations with the same event id', async () => {
    const runtime = createOperationRuntime('operation-same-id');
    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });

    const firstWait = runtime.dispatchAndWait(['increment', 1]);
    const secondWait = runtime.dispatchAndWait(['increment', 1]);
    const [firstResult, secondResult] = await Promise.all([firstWait, secondWait]);
    const first = firstResult.operation;
    const second = secondResult.operation;

    expect(first).toMatchObject({ status: 'completed', outcome: 'succeeded' });
    expect(second).toMatchObject({ status: 'completed', outcome: 'succeeded' });
    expect(first.operationId).not.toBe(second.operationId);
    expect(first.rootEventInstanceId).not.toBe(second.rootEventInstanceId);
    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(first.events[0]!.event).toEqual(['increment', 1]);
    expect(second.events[0]!.event).toEqual(['increment', 1]);
    expect(first.runtimeInstanceId).toBe(runtime.runtimeInstanceId);
    expect(runtime.getAppDb().count).toBe(2);
  });

  it('owns accepted asynchronous event input before the caller can mutate it', async () => {
    const runtime = createOperationRuntime('operation-owned-input');
    runtime.regEvent('increment-from', ({ draftDb }, input) => {
      draftDb.count += input.amount;
    });
    const input = { amount: 2 };

    runtime.dispatch(['increment-from', input]);
    input.amount = 100;
    await runtime.flush();

    expect(runtime.getAppDb().count).toBe(2);
  });

  it('owns tracked input and exposes its operation id before completion', async () => {
    const runtime = createOperationRuntime('operation-owned-tracked-input');
    runtime.regEvent('increment-from', ({ draftDb }, input) => {
      draftDb.count += input.amount;
    });
    const input = { amount: 2 };

    const handle = runtime.startOperation(['increment-from', input]);
    input.amount = 100;
    const { operation: receipt } = await handle.result;

    expect(handle.operationId).toBe(receipt.operationId);
    expect(receipt.events[0]!.event).toEqual(['increment-from', { amount: 2 }]);
    expect(runtime.getAppDb().count).toBe(2);
  });

  it('rejects uncloneable tracked input and unknown operation options', () => {
    const runtime = createOperationRuntime('operation-input-validation');
    runtime.regEvent('increment-from', ({ draftDb }, input) => {
      draftDb.count += input.amount;
    });

    expect(() =>
      runtime.startOperation(['increment-from', { amount: 1, fn: () => {} } as never]),
    ).toThrow('structured-cloneable');
    expect(() =>
      (runtime.startOperation as (event: unknown, options: unknown) => unknown)(
        ['increment-from', { amount: 1 }],
        { operationId: 'caller-supplied-id' },
      ),
    ).toThrow("Unknown operation option 'operationId'");
    expect(() =>
      runtime.startOperation(['increment-from', new Map([['amount', 1]]) as never], {
        idempotencyKey: 'non-json-idempotency',
      }),
    ).toThrow('JSON arrays and plain objects');
  });

  it('records exact synchronous cascade parentage and publishes observations', async () => {
    const runtime = createOperationRuntime('operation-cascade');
    runtime.regEvent('root', () => [['dispatch', ['child', 2]]]);
    runtime.regEvent('child', ({ draftDb }, amount) => {
      draftDb.count += amount;
      return [['dispatch', ['grandchild', amount]]];
    });
    runtime.regEvent('grandchild', ({ draftDb }, amount) => {
      draftDb.nested.value += amount;
    });

    const { operation: receipt } = await runtime.dispatchAndWait(['root'], {
      observe: [['count']],
    });

    expect(receipt.events.map((event) => event.event[0])).toEqual(['root', 'child', 'grandchild']);
    const [root, child, grandchild] = receipt.events;
    expect(root!.eventInstanceId).toBe(receipt.rootEventInstanceId);
    expect(child!.parentEventInstanceId).toBe(root!.eventInstanceId);
    expect(grandchild!.parentEventInstanceId).toBe(child!.eventInstanceId);
    expect(new Set(receipt.events.map((event) => event.eventInstanceId)).size).toBe(3);
    expect(receipt.revisions.published).toBe(receipt.revisions.lastCommitted);
    expect(receipt.observations).toEqual([{ query: ['count'], status: 'succeeded', value: 2 }]);
    expect(receipt.completion).toEqual({
      boundary: 'cascade-published',
      satisfied: true,
      pendingEvents: 0,
    });
    expect(runtime.getAppDb()).toEqual({ count: 2, nested: { value: 2 } });
  });

  it('keeps interleaved operation cascades causally separate', async () => {
    const runtime = createOperationRuntime('operation-interleaving');
    runtime.regEvent('a-root', () => [
      ['dispatch', ['a-child']],
      ['dispatch', ['a-branch']],
    ]);
    runtime.regEvent('a-child', ({ draftDb }) => {
      draftDb.count += 1;
      return [['dispatch', ['a-grandchild']]];
    });
    runtime.regEvent('a-branch', ({ draftDb }) => {
      draftDb.nested.value += 1;
    });
    runtime.regEvent('a-grandchild', ({ draftDb }) => {
      draftDb.count += 1;
    });
    runtime.regEvent('b-root', ({ draftDb }) => {
      draftDb.count += 10;
      return [['dispatch', ['b-child']]];
    });
    runtime.regEvent('b-child', ({ draftDb }) => {
      draftDb.count += 10;
    });

    const a = runtime.startOperation(['a-root'], { observe: [['count']] });
    const b = runtime.startOperation(['b-root'], { observe: [['count']] });
    const [aResult, bResult] = await Promise.all([a.result, b.result]);
    const aReceipt = aResult.operation;
    const bReceipt = bResult.operation;

    expect(aReceipt.events.map((event) => event.event[0])).toEqual([
      'a-root',
      'a-child',
      'a-branch',
      'a-grandchild',
    ]);
    expect(bReceipt.events.map((event) => event.event[0])).toEqual(['b-root', 'b-child']);
    const [aRoot, aChild, aBranch, aGrandchild] = aReceipt.events;
    expect(aChild!.parentEventInstanceId).toBe(aRoot!.eventInstanceId);
    expect(aBranch!.parentEventInstanceId).toBe(aRoot!.eventInstanceId);
    expect(aGrandchild!.parentEventInstanceId).toBe(aChild!.eventInstanceId);
    expect(
      new Set([...aReceipt.events, ...bReceipt.events].map((event) => event.eventInstanceId)).size,
    ).toBe(6);
    expect(aReceipt.revisions.concurrentChangesObserved).toBe(true);
    expect(bReceipt.revisions.concurrentChangesObserved).toBe(true);
    expect(aReceipt.events.every((event) => event.event[0]!.startsWith('a-'))).toBe(true);
    expect(bReceipt.events.every((event) => event.event[0]!.startsWith('b-'))).toBe(true);
    expect(runtime.getAppDb()).toEqual({ count: 22, nested: { value: 1 } });
  });

  it('separates committed state from a failed synchronous effect', async () => {
    const runtime = createOperationRuntime('operation-effect-failure');
    const published: number[] = [];
    const unwatch = runtime.watchSubscription(['count'], (value) => published.push(value));
    runtime.regEffect('explode', () => {
      throw new Error('external write failed');
    });
    runtime.regEvent('commit-then-fail', ({ draftDb }) => {
      draftDb.count = 1;
      return [['explode']];
    });

    const { operation: receipt } = await runtime.dispatchAndWait(['commit-then-fail'], {
      observe: [['count']],
      executionContext: {
        profile: 'headless-fixtures',
        defaultEffectMode: 'stubbed',
        effectModes: { explode: 'fixture-backed' },
        fixtureSetId: 'failing-effects-v1',
      },
    });

    expect(receipt).toMatchObject({
      status: 'completed',
      outcome: 'effects-failed',
      state: { status: 'committed' },
      executionContext: {
        profile: 'headless-fixtures',
        fixtureSetId: 'failing-effects-v1',
        source: 'caller-declared',
        enforced: false,
      },
    });
    expect(receipt.events[0]!.status).toBe('completed');
    expect(receipt.events[0]!.state.status).toBe('committed');
    expect(receipt.effects.items).toEqual([
      expect.objectContaining({
        type: 'explode',
        mode: 'fixture-backed',
        status: 'failed',
        error: expect.objectContaining({
          kind: 'effect',
          message: 'external write failed',
        }),
      }),
    ]);
    expect(runtime.getAppDb().count).toBe(1);
    expect(published).toEqual([0, 1]);
    expect(receipt.observations[0]).toMatchObject({ value: 1 });
    unwatch();
  });

  it('captures committed patches while tracing is disabled', async () => {
    const runtime = createOperationRuntime('operation-no-tracing');
    runtime.disableTracing();
    runtime.regEvent('set-nested', ({ draftDb }, value) => {
      draftDb.nested.value = value;
    });

    const { operation: receipt } = await runtime.dispatchAndWait(['set-nested', 7]);

    expect(receipt.events[0]!.state).toMatchObject({
      status: 'committed',
      plannedPatches: [{ op: 'replace', path: ['nested', 'value'], value: 7 }],
      committedPatches: [{ op: 'replace', path: ['nested', 'value'], value: 7 }],
    });
    expect(receipt.state.patches).toEqual([{ op: 'replace', path: ['nested', 'value'], value: 7 }]);
  });

  it('records actual committed patches when an interceptor replaces the handler db', async () => {
    const runtime = createOperationRuntime('operation-final-db-patches');
    runtime.regEvent(
      'replace-final-db',
      ({ draftDb }) => {
        draftDb.count = 1;
      },
      [
        {
          id: 'replace-final-db-after',
          after(context) {
            return {
              ...context,
              newDb: { ...context.previousDb, count: 42 },
            };
          },
        },
      ],
    );

    const { operation: receipt } = await runtime.dispatchAndWait(['replace-final-db']);

    expect(runtime.getAppDb().count).toBe(42);
    expect(receipt.events[0]!.state.plannedPatches).toEqual([
      { op: 'replace', path: ['count'], value: 1 },
    ]);
    expect(receipt.events[0]!.state.committedPatches).toEqual([
      { op: 'replace', path: [], value: { count: 42, nested: { value: 0 } } },
    ]);
  });

  it('makes malformed effects and invalid built-in dispatch effects explicit failures', async () => {
    const runtime = createOperationRuntime('operation-invalid-effects');
    runtime.regEvent('malformed-effects', ({ draftDb }) => {
      draftDb.count += 1;
      return { invalid: true } as never;
    });
    runtime.regEvent('invalid-dispatch-effect', ({ draftDb }) => {
      draftDb.count += 1;
      return [['dispatch', 'not-an-event-vector']] as never;
    });

    const malformed = await runtime.dispatchAndWait(['malformed-effects']);
    const invalidDispatch = await runtime.dispatchAndWait(['invalid-dispatch-effect']);

    expect(malformed.operation).toMatchObject({
      status: 'completed',
      outcome: 'effects-failed',
      effects: { status: 'failed', items: [expect.objectContaining({ status: 'invalid' })] },
    });
    expect(invalidDispatch.operation).toMatchObject({
      status: 'completed',
      outcome: 'effects-failed',
      effects: {
        status: 'failed',
        items: [expect.objectContaining({ type: 'dispatch', status: 'failed' })],
      },
    });
    expect(runtime.getAppDb().count).toBe(2);
  });

  it('does not claim legacy void effects have externally succeeded', async () => {
    const runtime = createOperationRuntime('operation-returned-effect');
    runtime.regEffect('custom', () => {});
    runtime.regEvent('custom-returned-effect', ({ draftDb }) => {
      draftDb.count += 1;
      return [['custom']];
    });

    const { operation: receipt } = await runtime.dispatchAndWait(['custom-returned-effect']);

    expect(receipt).toMatchObject({
      status: 'completed',
      outcome: 'incomplete',
      effects: {
        status: 'incomplete',
        items: [expect.objectContaining({ type: 'custom', status: 'returned' })],
      },
    });
  });

  it('turns a missing required coeffect into a structured pre-commit failure', async () => {
    const runtime = createOperationRuntime('operation-missing-coeffect');
    runtime.regEvent(
      'needs-coeffect',
      ({ draftDb }) => {
        draftDb.count = 10;
      },
      { coeffects: [['missing-operation-coeffect']] },
    );

    const { operation: receipt } = await runtime.dispatchAndWait(['needs-coeffect']);

    expect(receipt).toMatchObject({
      status: 'failed',
      outcome: 'failed',
      state: { status: 'failed', patches: [] },
    });
    expect(receipt.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'missing-coeffect' })]),
    );
    expect(receipt.events[0]!.state.status).toBe('not-attempted');
    expect(runtime.getAppDb().count).toBe(0);
  });

  it('times out only the caller wait and allows later authoritative lookup', async () => {
    const runtime = createOperationRuntime('operation-timeout');
    runtime.regEvent('blocker', () => {});
    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });

    const blocker = ['blocker'] as EventVector & { meta?: { flush?: boolean } };
    blocker.meta = { flush: true };
    runtime.dispatch(blocker as never);

    const timedOut = await runtime.dispatchAndWait(['increment', 1], {
      timeoutMs: 1,
      idempotencyKey: 'timeout-and-recover',
    });

    expect(timedOut.delivery.status).toBe('timed-out');
    expect(['queued', 'running']).toContain(timedOut.operation.status);
    await runtime.flush();

    const byId = runtime.getOperation({ operationId: timedOut.operation.operationId });
    const byKey = runtime.getOperation({ idempotencyKey: 'timeout-and-recover' });
    expect(byId).toMatchObject({
      operationId: timedOut.operation.operationId,
      status: 'completed',
      outcome: 'succeeded',
    });
    expect(byKey?.operationId).toBe(timedOut.operation.operationId);
    expect(runtime.getAppDb().count).toBe(1);
  });

  it('reports failed observations without rewriting a committed state result', async () => {
    const runtime = createOperationRuntime('operation-observation-failure');
    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });

    const { operation: receipt } = await runtime.dispatchAndWait(['increment', 1], {
      observe: [['not-a-subscription'] as never],
    });

    expect(receipt).toMatchObject({
      status: 'failed',
      outcome: 'failed',
      state: { status: 'committed' },
      observations: [expect.objectContaining({ status: 'failed' })],
      errors: [expect.objectContaining({ kind: 'observation' })],
    });
    expect(runtime.getAppDb().count).toBe(1);
  });

  it('deduplicates matching retries and rejects conflicting idempotency reuse', async () => {
    const runtime = createOperationRuntime('operation-idempotency');
    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });

    const options = { idempotencyKey: 'increment-once' } as const;
    const firstWait = runtime.dispatchAndWait(['increment', 2], options);
    const retryWait = runtime.dispatchAndWait(['increment', 2], options);
    const [firstResult, retryResult] = await Promise.all([firstWait, retryWait]);
    const first = firstResult.operation;
    const retry = retryResult.operation;

    expect(retry.operationId).toBe(first.operationId);
    expect(retryResult.replayed).toBe(true);
    expect(runtime.getAppDb().count).toBe(2);

    const { operation: conflict } = await runtime.dispatchAndWait(['increment', 3], options);
    expect(conflict).toMatchObject({
      status: 'rejected',
      outcome: 'rejected',
      errors: [expect.objectContaining({ kind: 'idempotency-conflict' })],
    });
    expect(runtime.getOperation({ operationId: first.operationId })?.outcome).toBe('succeeded');
    const profileConflict = await runtime.dispatchAndWait(['increment', 2], {
      idempotencyKey: 'increment-once',
      executionContext: { profile: 'different-unverified-profile' },
    });
    expect(profileConflict.operation).toMatchObject({
      status: 'rejected',
      errors: [expect.objectContaining({ kind: 'idempotency-conflict' })],
    });
    expect(runtime.getAppDb().count).toBe(2);
  });

  it('returns copy-isolated snapshots from the retained ledger', async () => {
    const runtime = createOperationRuntime('operation-snapshot-isolation');
    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });

    const { operation } = await runtime.dispatchAndWait(['increment', 1]);
    (operation.events[0]!.event as unknown[])[1] = 999;

    expect(runtime.getOperation({ operationId: operation.operationId })?.events[0]!.event).toEqual([
      'increment',
      1,
    ]);
  });

  it('checks expected revisions when the queued root is ready to start', async () => {
    const runtime = createOperationRuntime('operation-revision-conflict');
    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });
    const earlierCommit = runtime.dispatchAndWait(['increment', 1]);
    const staleOperation = runtime.dispatchAndWait(['increment', 10], {
      expectedRevision: 0,
    });
    const [earlierResult, staleResult] = await Promise.all([earlierCommit, staleOperation]);
    const receipt = staleResult.operation;

    expect(earlierResult.operation.outcome).toBe('succeeded');
    expect(receipt).toMatchObject({
      status: 'rejected',
      outcome: 'rejected',
      errors: [expect.objectContaining({ kind: 'revision-conflict' })],
    });
    expect(receipt.revisions).toMatchObject({ accepted: 0, expected: 0, rootStart: 1 });
    expect(runtime.getAppDb().count).toBe(1);
  });

  it('isolates a failing operation from other accepted queue work', async () => {
    const runtime = createOperationRuntime('operation-failure-isolation');
    runtime.regEvent('boom', () => {
      throw new Error('queue failed');
    });
    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });

    const failedWait = runtime.dispatchAndWait(['boom']);
    const droppedWait = runtime.dispatchAndWait(['increment', 1]);
    const [failedResult, unaffectedResult] = await settleWithin(
      Promise.all([failedWait, droppedWait]),
    );
    const failed = failedResult.operation;
    const unaffected = unaffectedResult.operation;

    expect(failed).toMatchObject({
      status: 'failed',
      outcome: 'failed',
      errors: [expect.objectContaining({ message: 'queue failed' })],
    });
    expect(unaffected).toMatchObject({
      status: 'completed',
      outcome: 'succeeded',
      events: [expect.objectContaining({ status: 'completed' })],
    });
    expect(runtime.getAppDb().count).toBe(1);
  });

  it('settles accepted queued work when its runtime is disposed', async () => {
    const runtime = createOperationRuntime('operation-dispose');
    runtime.regEvent('increment', ({ draftDb }, amount) => {
      draftDb.count += amount;
    });

    const handle = runtime.startOperation(['increment', 1]);
    runtime.dispose();
    const { operation: receipt } = await settleWithin(handle.result);

    expect(receipt).toMatchObject({
      status: 'failed',
      outcome: 'failed',
      events: [expect.objectContaining({ status: 'dropped' })],
      errors: [expect.objectContaining({ kind: 'disposed' })],
    });
    expect(runtime.getOperation({ operationId: handle.operationId })?.status).toBe('failed');
  });

  it('forbids disposal from a running effect instead of corrupting its operation', async () => {
    const runtime = createOperationRuntime('operation-running-dispose');
    runtime.regEffect('dispose-runtime', () => runtime.dispose());
    runtime.regEvent('dispose-from-effect', ({ draftDb }) => {
      draftDb.count += 1;
      return [['dispose-runtime']];
    });

    const { operation: receipt } = await runtime.dispatchAndWait(['dispose-from-effect']);

    expect(receipt).toMatchObject({
      status: 'completed',
      outcome: 'effects-failed',
      state: { status: 'committed' },
      effects: {
        items: [expect.objectContaining({ type: 'dispose-runtime', status: 'failed' })],
      },
    });
    expect(runtime.getAppDb().count).toBe(1);
  });

  it('reports legacy promise effects as detached without waiting for them', async () => {
    const runtime = createOperationRuntime('operation-detached');
    let release: () => void = () => {};
    let externalFinished = false;
    runtime.regEffect('deferred', () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => {
        externalFinished = true;
      }),
    );
    runtime.regEvent('start-deferred', ({ draftDb }) => {
      draftDb.count += 1;
      return [['deferred']];
    });

    const { operation: receipt } = await settleWithin(runtime.dispatchAndWait(['start-deferred']));

    expect(externalFinished).toBe(false);
    expect(receipt).toMatchObject({
      status: 'completed',
      outcome: 'incomplete',
      state: { status: 'committed' },
      effects: {
        status: 'incomplete',
        items: [expect.objectContaining({ type: 'deferred', status: 'detached' })],
      },
    });

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(externalFinished).toBe(true);
  });
});
