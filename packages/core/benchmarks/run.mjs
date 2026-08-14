import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import { createUkladRuntime, shallowEqual } from '../dist/vanilla.mjs';
import { createUkladTestHarness } from '../dist/testing.mjs';

const scope = process.argv[2] ?? 'all';
const sampleCount = numberFromEnv('UKLAD_BENCH_SAMPLES', 5);
const globalIterations = process.env.UKLAD_BENCH_ITERATIONS;
const jsonOutput = process.env.UKLAD_BENCH_JSON === '1';
const draftLeakScanEnabled = process.env.NODE_ENV === 'development';

const BENCH_HARNESSES = new WeakMap();

function getBenchHarness(runtime) {
  let harness = BENCH_HARNESSES.get(runtime);
  if (!harness) {
    harness = createUkladTestHarness(runtime);
    BENCH_HARNESSES.set(runtime, harness);
  }
  return harness;
}

await main();

async function main() {
  if (
    !['all', 'state', 'equality', 'subscriptions', 'events', 'effects', 'memory'].includes(scope)
  ) {
    console.error(
      'Usage: node benchmarks/run.mjs [all|state|equality|subscriptions|events|effects|memory]',
    );
    process.exitCode = 1;
    return;
  }

  const results = [];
  if (scope === 'all' || scope === 'state') results.push(...runStateBenchmarks());
  if (scope === 'all' || scope === 'equality') results.push(...runEqualityBenchmarks());
  if (scope === 'all' || scope === 'subscriptions') {
    results.push(...runSubscriptionBenchmarks());
  }
  if (scope === 'all' || scope === 'events') {
    results.push(...(await runEventBenchmarks()));
  }
  if (scope === 'all' || scope === 'effects') {
    results.push(...runEffectBenchmarks());
  }
  if (scope === 'all' || scope === 'memory') {
    results.push(...runMemoryBenchmarks());
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ node: process.version, results }, null, 2));
  } else {
    printTable(results);
  }
}

function runStateBenchmarks() {
  return [
    measure({
      name: 'state/no-op',
      iterations: iterationsFor('state', 20_000),
      setup: () => {
        const runtime = createUkladRuntime({
          initialState: { counter: 0 },
          runtimeId: 'bench-state-no-op',
        });
        runtime.registerModule((registrar) => {
          registrar.regEvent('bench/no-op', () => {});
        });
        return { runtime };
      },
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/no-op']),
    }),
    measure({
      name: 'state/small-update',
      iterations: iterationsFor('state', 20_000),
      setup: () => {
        const runtime = createUkladRuntime({
          initialState: { counter: 0 },
          runtimeId: 'bench-state-small-update',
        });
        runtime.registerModule((registrar) => {
          registrar.regEvent('bench/increment', ({ draftState }) => {
            draftState.counter += 1;
          });
        });
        return { runtime };
      },
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/increment']),
    }),
    measure({
      name: 'state/deep-update',
      iterations: iterationsFor('state', 10_000),
      setup: () => {
        const runtime = createUkladRuntime({
          initialState: createDeepState(),
          runtimeId: 'bench-state-deep-update',
        });
        runtime.registerModule((registrar) => {
          registrar.regEvent('bench/update-deep', ({ draftState }) => {
            draftState.profile.preferences.notifications.email.enabled =
              !draftState.profile.preferences.notifications.email.enabled;
          });
        });
        return { runtime };
      },
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/update-deep']),
    }),
    measure({
      name: 'state/large-no-op',
      iterations: iterationsFor('state', 2_000),
      setup: () => {
        const runtime = createUkladRuntime({
          initialState: { rows: createRows(10_000) },
          runtimeId: 'bench-state-large-no-op',
        });
        runtime.registerModule((registrar) => {
          registrar.regEvent('bench/no-op', () => {});
        });
        return { runtime };
      },
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/no-op']),
    }),
  ];
}

function runEqualityBenchmarks() {
  const wideCount = 10_000;
  const collectionCount = 1_000;

  return [
    measureEqualityCase({
      name: 'equality/object-is-array-shared-items-10k',
      comparator: 'Object.is',
      shape: 'array/shared-items/10k',
      compare: Object.is,
      expectedEqual: false,
      iterations: iterationsFor('equality', 100_000),
      setup: () => createSharedRowArrayPair(wideCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-array-shared-items-10k',
      comparator: 'shallowEqual',
      shape: 'array/shared-items/10k',
      compare: shallowEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 500),
      setup: () => createSharedRowArrayPair(wideCount),
    }),
    measureEqualityCase({
      name: 'equality/node-deep-array-shared-items-10k',
      comparator: 'node:isDeepStrictEqual',
      shape: 'array/shared-items/10k',
      compare: isDeepStrictEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 500),
      setup: () => createSharedRowArrayPair(wideCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-array-different-first-10k',
      comparator: 'shallowEqual',
      shape: 'array/different-first/10k',
      compare: shallowEqual,
      expectedEqual: false,
      iterations: iterationsFor('equality', 100_000),
      setup: () => createChangedNumberArrayPair(wideCount, 0),
    }),
    measureEqualityCase({
      name: 'equality/shallow-array-different-last-10k',
      comparator: 'shallowEqual',
      shape: 'array/different-last/10k',
      compare: shallowEqual,
      expectedEqual: false,
      iterations: iterationsFor('equality', 500),
      setup: () => createChangedNumberArrayPair(wideCount, wideCount - 1),
    }),
    measureEqualityCase({
      name: 'equality/shallow-array-recreated-items-1k',
      comparator: 'shallowEqual',
      shape: 'array/recreated-items/1k',
      compare: shallowEqual,
      expectedEqual: false,
      iterations: iterationsFor('equality', 100_000),
      setup: () => createRecreatedRowArrayPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/node-deep-array-recreated-items-1k',
      comparator: 'node:isDeepStrictEqual',
      shape: 'array/recreated-items/1k',
      compare: isDeepStrictEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 200),
      setup: () => createRecreatedRowArrayPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-record-primitives-1k',
      comparator: 'shallowEqual',
      shape: 'record/primitives/1k',
      compare: shallowEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createPrimitiveRecordPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-record-shared-values-1k',
      comparator: 'shallowEqual',
      shape: 'record/shared-object-values/1k',
      compare: shallowEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createSharedValueRecordPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-record-recreated-values-1k',
      comparator: 'shallowEqual',
      shape: 'record/recreated-object-values/1k',
      compare: shallowEqual,
      expectedEqual: false,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createRecreatedValueRecordPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-map-primitives-1k',
      comparator: 'shallowEqual',
      shape: 'map/primitives/1k',
      compare: shallowEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createPrimitiveMapPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-map-shared-values-1k',
      comparator: 'shallowEqual',
      shape: 'map/shared-object-values/1k',
      compare: shallowEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createSharedValueMapPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-map-recreated-values-1k',
      comparator: 'shallowEqual',
      shape: 'map/recreated-object-values/1k',
      compare: shallowEqual,
      expectedEqual: false,
      iterations: iterationsFor('equality', 100_000),
      setup: () => createRecreatedValueMapPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-set-primitives-1k',
      comparator: 'shallowEqual',
      shape: 'set/primitives/1k',
      compare: shallowEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createPrimitiveSetPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-set-shared-values-1k',
      comparator: 'shallowEqual',
      shape: 'set/shared-object-values/1k',
      compare: shallowEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createSharedValueSetPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-set-recreated-values-1k',
      comparator: 'shallowEqual',
      shape: 'set/recreated-object-values/1k',
      compare: shallowEqual,
      expectedEqual: false,
      iterations: iterationsFor('equality', 100_000),
      setup: () => createRecreatedValueSetPair(collectionCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-typed-array-equal-10k',
      comparator: 'shallowEqual',
      shape: 'uint32-array/equal/10k',
      compare: shallowEqual,
      expectedEqual: true,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createTypedArrayPair(wideCount),
    }),
    measureEqualityCase({
      name: 'equality/shallow-typed-array-different-last-10k',
      comparator: 'shallowEqual',
      shape: 'uint32-array/different-last/10k',
      compare: shallowEqual,
      expectedEqual: false,
      iterations: iterationsFor('equality', 1_000),
      setup: () => createTypedArrayPair(wideCount, wideCount - 1),
    }),
  ];
}

function runSubscriptionBenchmarks() {
  const equalityComparisonIterations = iterationsFor('subscriptions', 2_000);
  const nestedPropagationIterations = iterationsFor('subscriptions', 1_000);

  return [
    measure({
      name: 'subscriptions/fan-out-100',
      iterations: iterationsFor('subscriptions', 5_000),
      setup: () => setupFanOut(100, 'bench-sub-fanout-100'),
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/tick']),
      teardown: disposeSubscriptions,
    }),
    measure({
      name: 'subscriptions/fan-out-1000',
      iterations: iterationsFor('subscriptions', 1_000),
      setup: () => setupFanOut(1_000, 'bench-sub-fanout-1000'),
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/tick']),
      teardown: disposeSubscriptions,
    }),
    measure({
      name: 'subscriptions/deep-chain-100',
      iterations: iterationsFor('subscriptions', 5_000),
      setup: () => setupDeepChain(100, 'bench-sub-deep-chain'),
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/tick']),
      teardown: disposeSubscriptions,
    }),
    measure({
      name: 'subscriptions/equality-cutoff-10k',
      iterations: equalityComparisonIterations,
      setup: () => setupEqualityComparison(10_000, 'bench-sub-equality-cutoff'),
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/tick']),
      teardown: disposeSubscriptions,
      validate: ({ downstreamRuns }) => ({
        equalityPolicy: 'shallowEqual',
        ...validateDownstreamRuns('subscriptions/equality-cutoff-10k', downstreamRuns, 0),
      }),
    }),
    measure({
      name: 'subscriptions/identity-propagation-10k',
      iterations: equalityComparisonIterations,
      setup: () => setupEqualityComparison(10_000, 'bench-sub-identity-propagation', Object.is),
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/tick']),
      teardown: disposeSubscriptions,
      validate: ({ downstreamRuns }) => ({
        equalityPolicy: 'Object.is',
        ...validateDownstreamRuns(
          'subscriptions/identity-propagation-10k',
          downstreamRuns,
          equalityComparisonIterations * sampleCount,
        ),
      }),
    }),
    measure({
      name: 'subscriptions/equality-nested-propagation-1k',
      iterations: nestedPropagationIterations,
      setup: () => setupNestedEqualityPropagation(1_000, 'bench-sub-equality-nested-propagation'),
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/tick']),
      teardown: disposeSubscriptions,
      validate: ({ downstreamRuns }) => ({
        equalityPolicy: 'shallowEqual',
        ...validateDownstreamRuns(
          'subscriptions/equality-nested-propagation-1k',
          downstreamRuns,
          nestedPropagationIterations * sampleCount,
        ),
      }),
    }),
    measure({
      name: 'subscriptions/mount-churn',
      iterations: iterationsFor('subscriptions', 5_000),
      setup: () => setupMountChurn('bench-sub-mount-churn'),
      operation: ({ runtime }) => {
        const dispose = getBenchHarness(runtime).watchSubscription(['bench/double'], () => {}, {
          emitInitial: false,
        });
        dispose();
      },
      teardown: disposeSubscriptions,
    }),
  ];
}

async function runEventBenchmarks() {
  return [
    await measureAsync({
      name: 'events/dispatch-small',
      iterations: iterationsFor('events', 20_000),
      setup: () =>
        setupEventDispatch(
          { id: 42, title: 'benchmark', flags: [true, false] },
          'bench-event-small',
        ),
      operation: ({ runtime, event }) => runtime.dispatch(event),
      settle: settleRuntime,
    }),
    await measureAsync({
      name: 'events/dispatch-10k-rows',
      iterations: iterationsFor('events', 1_000),
      setup: () => setupEventDispatch({ rows: createRows(10_000) }, 'bench-event-10k'),
      operation: ({ runtime, event }) => runtime.dispatch(event),
      settle: settleRuntime,
    }),
  ];
}

function runEffectBenchmarks() {
  const smallIterations = iterationsFor('effects', 20_000);
  const objectIterations = iterationsFor('effects', 10_000);
  const collectionIterations = iterationsFor('effects', 2_000);
  const wideRecordIterations = iterationsFor('effects', 200);
  const draftRepairIterations = iterationsFor('effects', 500);
  const smallPayload = { id: 42, title: 'benchmark', flags: [true, false] };
  const rows = createRows(10_000);
  const wideRecord = createPrimitiveRecord(10_000);

  return [
    measureEffectCase({
      name: 'effects/no-effects',
      iterations: smallIterations,
      payloadShape: 'none',
      expectedEffectsPerDispatch: 0,
      setup: () =>
        setupEffectDispatch({
          runtimeId: 'bench-effects-none',
          handler: () => [],
        }),
    }),
    measureEffectCase({
      name: 'effects/plain-primitive',
      iterations: smallIterations,
      payloadShape: 'primitive',
      setup: () =>
        setupEffectDispatch({
          runtimeId: 'bench-effects-primitive',
          handler: () => [['bench/capture', 42]],
        }),
    }),
    measureEffectCase({
      name: 'effects/plain-small-object',
      iterations: objectIterations,
      payloadShape: 'plain-object/small',
      setup: () =>
        setupEffectDispatch({
          runtimeId: 'bench-effects-small-object',
          handler: () => [['bench/capture', smallPayload]],
        }),
    }),
    measureEffectCase({
      name: 'effects/plain-array-10k',
      iterations: collectionIterations,
      payloadShape: 'array/rows/10k',
      setup: () =>
        setupEffectDispatch({
          runtimeId: 'bench-effects-array-10k',
          handler: () => [['bench/capture', rows]],
        }),
      validatePayload: (payload) => Array.isArray(payload) && payload.length === rows.length,
    }),
    measureEffectCase({
      name: 'effects/plain-record-10k',
      iterations: wideRecordIterations,
      payloadShape: 'plain-record/primitives/10k',
      setup: () =>
        setupEffectDispatch({
          runtimeId: 'bench-effects-record-10k',
          handler: () => [['bench/capture', wideRecord]],
        }),
      validatePayload: (payload) => payload === wideRecord,
    }),
    measureEffectCase({
      name: 'effects/direct-draft-array-repair-10k',
      iterations: draftRepairIterations,
      payloadShape: 'immer-draft/array/10k',
      setup: () =>
        setupEffectDispatch({
          runtimeId: 'bench-effects-draft-array-10k',
          initialState: { tick: 0, rows },
          handler: ({ draftState }) => {
            draftState.tick += 1;
            return [['bench/capture', draftState.rows]];
          },
        }),
      validatePayload: (payload) => Array.isArray(payload) && payload.length === rows.length,
    }),
  ];
}

function runMemoryBenchmarks() {
  return [
    measureMemory({
      name: 'memory/state-10k-rows',
      setup: () => ({
        runtime: createUkladRuntime({
          initialState: { rows: createRows(10_000) },
          runtimeId: 'bench-memory-state-10k',
        }),
      }),
    }),
    measureMemory({
      name: 'memory/subscriptions-fan-out-1000',
      setup: () => setupFanOut(1_000, 'bench-memory-fanout-1000'),
      teardown: disposeSubscriptions,
    }),
    measureMemory({
      name: 'memory/subscriptions-deep-chain-100',
      setup: () => setupDeepChain(100, 'bench-memory-deep-chain'),
      teardown: disposeSubscriptions,
    }),
  ];
}

function measureEqualityCase({
  name,
  comparator,
  shape,
  compare,
  expectedEqual,
  iterations,
  setup,
}) {
  return measure({
    name,
    iterations,
    setup: () => ({ ...setup(), result: undefined }),
    operation: (context) => {
      context.result = compare(context.left, context.right);
    },
    teardown: () => undefined,
    validate: ({ result }) => {
      if (result !== expectedEqual) {
        throw new Error(
          `${name} returned ${String(result)}; expected equality result ${String(expectedEqual)}`,
        );
      }
      return {
        comparator,
        shape,
        expectedEqual,
        resultEqual: result,
      };
    },
  });
}

function measureEffectCase({
  name,
  iterations,
  payloadShape,
  setup,
  expectedEffectsPerDispatch = 1,
  validatePayload,
}) {
  return measure({
    name,
    iterations,
    setup,
    operation: ({ runtime, event }) => getBenchHarness(runtime).dispatchSync(event),
    validate: (context) => {
      const expectedEffectRuns = iterations * sampleCount * expectedEffectsPerDispatch;
      if (context.effectRuns !== expectedEffectRuns) {
        throw new Error(
          `${name} ran its effect ${context.effectRuns} times; expected ${expectedEffectRuns}`,
        );
      }
      if (validatePayload !== undefined && !validatePayload(context.lastPayload)) {
        throw new Error(`${name} produced an invalid effect payload`);
      }
      return {
        draftLeakScan: draftLeakScanEnabled ? 'enabled' : 'disabled',
        payloadShape,
        expectedEffectRuns,
        effectRunsDuringMeasurement: context.effectRuns,
      };
    },
  });
}

function measure({ name, iterations, setup, operation, teardown = disposeRuntime, validate }) {
  const context = setup();
  const warmupIterations = Math.min(200, Math.max(20, Math.floor(iterations / 10)));

  for (let index = 0; index < warmupIterations; index += 1) operation(context, index);
  context.reset?.();

  const samples = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) operation(context, index);
    samples.push(performance.now() - startedAt);
  }

  const medianMs = median(samples);
  const result = {
    name,
    iterations,
    medianMs: round(medianMs),
    opsPerSecond: Math.round(iterations / (medianMs / 1_000)),
    ...validate?.(context),
  };

  teardown(context);
  return result;
}

async function measureAsync({
  name,
  iterations,
  setup,
  operation,
  settle,
  teardown = disposeRuntime,
}) {
  const context = setup();
  const warmupIterations = Math.min(200, Math.max(20, Math.floor(iterations / 10)));

  for (let index = 0; index < warmupIterations; index += 1) operation(context, index);
  await settle(context);

  const samples = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) operation(context, index);
    samples.push(performance.now() - startedAt);
    await settle(context);
  }

  const medianMs = median(samples);
  const result = {
    name,
    iterations,
    medianMs: round(medianMs),
    opsPerSecond: Math.round(iterations / (medianMs / 1_000)),
  };

  teardown(context);
  return result;
}

function measureMemory({ name, setup, teardown = disposeRuntime }) {
  collectGarbage();
  const before = memorySnapshot();
  const afterSetup = setupAndDisposeMemoryCase(setup, teardown);
  collectGarbage();
  const afterDispose = memorySnapshot();

  return {
    name,
    kind: 'memory',
    gcAvailable: typeof globalThis.gc === 'function',
    heapUsedBeforeMb: roundMb(before.heapUsed),
    heapUsedAfterSetupMb: roundMb(afterSetup.heapUsed),
    retainedHeapMb: roundMb(afterSetup.heapUsed - before.heapUsed),
    heapUsedAfterDisposeMb: roundMb(afterDispose.heapUsed),
    releasedHeapMb: roundMb(afterSetup.heapUsed - afterDispose.heapUsed),
  };
}

function setupAndDisposeMemoryCase(setup, teardown) {
  const context = setup();
  collectGarbage();
  const afterSetup = memorySnapshot();
  teardown(context);
  return afterSetup;
}

function setupFanOut(width, runtimeId) {
  const runtime = createBenchRuntime(runtimeId);
  runtime.registerModule((registrar) => {
    registrar.regRootSub('bench/tick-root', 'tick');
  });
  const disposers = [];

  for (let index = 0; index < width; index += 1) {
    const id = `bench/fanout/${index}`;
    runtime.registerModule((registrar) => {
      registrar.regSub(
        id,
        () => [['bench/tick-root']],
        ([tick]) => tick + index,
      );
    });
    disposers.push(
      getBenchHarness(runtime).watchSubscription([id], () => {}, { emitInitial: false }),
    );
  }

  return { runtime, disposers };
}

function setupDeepChain(depth, runtimeId) {
  const runtime = createBenchRuntime(runtimeId);
  runtime.registerModule((registrar) => {
    registrar.regRootSub('bench/tick-root', 'tick');
  });
  let previous = 'bench/tick-root';

  for (let index = 0; index < depth; index += 1) {
    const id = `bench/deep/${index}`;
    const dependency = previous;
    runtime.registerModule((registrar) => {
      registrar.regSub(
        id,
        () => [[dependency]],
        ([value]) => value + 1,
      );
    });
    previous = id;
  }

  const disposer = getBenchHarness(runtime).watchSubscription([previous], () => {}, {
    emitInitial: false,
  });
  return { runtime, disposers: [disposer] };
}

function setupEqualityComparison(itemCount, runtimeId, equalityCheck) {
  const runtime = createBenchRuntime(
    runtimeId,
    { tick: 0, items: createRows(itemCount) },
    equalityCheck,
  );
  let downstreamRuns = 0;
  runtime.registerModule((registrar) => {
    registrar.regRootSub('bench/items-root', 'items');
    registrar.regRootSub('bench/equality-tick-root', 'tick');
  });
  runtime.registerModule((registrar) => {
    registrar.regSub(
      'bench/mapped-items',
      () => [['bench/items-root'], ['bench/equality-tick-root']],
      ([items]) => items.map((item) => item),
    );
  });
  runtime.registerModule((registrar) => {
    registrar.regSub(
      'bench/item-count',
      () => [['bench/mapped-items']],
      ([items]) => {
        downstreamRuns += 1;
        return items.length;
      },
    );
  });
  const disposer = getBenchHarness(runtime).watchSubscription(['bench/item-count'], () => {}, {
    emitInitial: false,
  });

  return {
    runtime,
    disposers: [disposer],
    reset: () => {
      downstreamRuns = 0;
    },
    get downstreamRuns() {
      return downstreamRuns;
    },
  };
}

function setupNestedEqualityPropagation(itemCount, runtimeId) {
  const runtime = createBenchRuntime(runtimeId, { tick: 0, items: createRows(itemCount) });
  let downstreamRuns = 0;
  runtime.registerModule((registrar) => {
    registrar.regRootSub('bench/nested-items-root', 'items');
    registrar.regRootSub('bench/nested-tick-root', 'tick');
  });
  runtime.registerModule((registrar) => {
    registrar.regSub(
      'bench/recreated-items',
      () => [['bench/nested-items-root'], ['bench/nested-tick-root']],
      ([items]) => items.map((item) => ({ ...item })),
    );
  });
  runtime.registerModule((registrar) => {
    registrar.regSub(
      'bench/recreated-item-count',
      () => [['bench/recreated-items']],
      ([items]) => {
        downstreamRuns += 1;
        return items.length;
      },
    );
  });
  const disposer = getBenchHarness(runtime).watchSubscription(
    ['bench/recreated-item-count'],
    () => {},
    { emitInitial: false },
  );

  return {
    runtime,
    disposers: [disposer],
    reset: () => {
      downstreamRuns = 0;
    },
    get downstreamRuns() {
      return downstreamRuns;
    },
  };
}

function validateDownstreamRuns(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(
      `${name} ran its downstream subscription ${actual} times; expected ${expected}`,
    );
  }
  return {
    expectedDownstreamRuns: expected,
    downstreamRunsDuringMeasurement: actual,
  };
}

function setupMountChurn(runtimeId) {
  const runtime = createBenchRuntime(runtimeId, { tick: 1 });
  runtime.registerModule((registrar) => {
    registrar.regRootSub('bench/tick-root', 'tick');
  });
  runtime.registerModule((registrar) => {
    registrar.regSub(
      'bench/double',
      () => [['bench/tick-root']],
      ([tick]) => tick * 2,
    );
  });
  return { runtime, disposers: [] };
}

function setupEventDispatch(payload, runtimeId) {
  const runtime = createUkladRuntime({
    initialState: { accepted: 0 },
    runtimeId,
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('bench/accept-event', ({ draftState }) => {
      draftState.accepted += 1;
    });
  });
  return {
    runtime,
    event: ['bench/accept-event', payload],
  };
}

function setupEffectDispatch({ runtimeId, initialState = { tick: 0 }, handler }) {
  const runtime = createUkladRuntime({ initialState, runtimeId });
  let effectRuns = 0;
  let lastPayload;
  runtime.registerModule((registrar) => {
    registrar.regEffect('bench/capture', (payload) => {
      effectRuns += 1;
      lastPayload = payload;
    });
    registrar.regEvent('bench/run-effect', handler);
  });
  return {
    runtime,
    event: ['bench/run-effect'],
    reset: () => {
      effectRuns = 0;
      lastPayload = undefined;
    },
    get effectRuns() {
      return effectRuns;
    },
    get lastPayload() {
      return lastPayload;
    },
  };
}

function createBenchRuntime(runtimeId, initialState = { tick: 0 }, equalityCheck) {
  const runtime = createUkladRuntime({ initialState, runtimeId, equalityCheck });
  runtime.registerModule((registrar) => {
    registrar.regEvent('bench/tick', ({ draftState }) => {
      draftState.tick += 1;
    });
  });
  return runtime;
}

function disposeSubscriptions({ runtime, disposers }) {
  for (const dispose of disposers) dispose();
  runtime.dispose();
}

function disposeRuntime({ runtime }) {
  runtime.dispose();
}

async function settleRuntime({ runtime }) {
  await getBenchHarness(runtime).flush();
}

function collectGarbage() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
}

function memorySnapshot() {
  return process.memoryUsage();
}

function roundMb(bytes) {
  return round(bytes / (1024 * 1024));
}

function createDeepState() {
  return {
    profile: {
      preferences: {
        notifications: {
          email: { enabled: true },
          push: { enabled: false },
        },
      },
    },
    rows: createRows(100),
  };
}

function createRows(count) {
  return Array.from({ length: count }, (_, id) => ({ id, value: id % 17, active: id % 2 === 0 }));
}

function createSharedRowArrayPair(count) {
  const rows = createRows(count);
  return { left: [...rows], right: [...rows] };
}

function createChangedNumberArrayPair(count, changedIndex) {
  const left = Array.from({ length: count }, (_, index) => index);
  const right = [...left];
  right[changedIndex] = -1;
  return { left, right };
}

function createRecreatedRowArrayPair(count) {
  return { left: createRows(count), right: createRows(count) };
}

function createPrimitiveRecordPair(count) {
  return { left: createPrimitiveRecord(count), right: createPrimitiveRecord(count) };
}

function createPrimitiveRecord(count) {
  const record = {};
  for (let index = 0; index < count; index += 1) {
    const key = `field-${index}`;
    record[key] = index % 17;
  }
  return record;
}

function createSharedValueRecordPair(count) {
  const rows = createRows(count);
  const left = {};
  const right = {};
  for (const row of rows) {
    const key = `field-${row.id}`;
    left[key] = row;
    right[key] = row;
  }
  return { left, right };
}

function createRecreatedValueRecordPair(count) {
  const leftRows = createRows(count);
  const rightRows = createRows(count);
  const left = {};
  const right = {};
  for (let index = 0; index < count; index += 1) {
    const key = `field-${index}`;
    left[key] = leftRows[index];
    right[key] = rightRows[index];
  }
  return { left, right };
}

function createPrimitiveMapPair(count) {
  const left = new Map();
  const right = new Map();
  for (let index = 0; index < count; index += 1) {
    const value = index % 17;
    left.set(index, value);
    right.set(index, value);
  }
  return { left, right };
}

function createSharedValueMapPair(count) {
  const rows = createRows(count);
  return {
    left: new Map(rows.map((row) => [row.id, row])),
    right: new Map(rows.map((row) => [row.id, row])),
  };
}

function createRecreatedValueMapPair(count) {
  const leftRows = createRows(count);
  const rightRows = createRows(count);
  return {
    left: new Map(leftRows.map((row) => [row.id, row])),
    right: new Map(rightRows.map((row) => [row.id, row])),
  };
}

function createPrimitiveSetPair(count) {
  const values = Array.from({ length: count }, (_, index) => index);
  return { left: new Set(values), right: new Set(values) };
}

function createSharedValueSetPair(count) {
  const rows = createRows(count);
  return { left: new Set(rows), right: new Set(rows) };
}

function createRecreatedValueSetPair(count) {
  return { left: new Set(createRows(count)), right: new Set(createRows(count)) };
}

function createTypedArrayPair(count, changedIndex) {
  const left = Uint32Array.from({ length: count }, (_, index) => index % 17);
  const right = left.slice();
  if (changedIndex !== undefined) right[changedIndex] += 1;
  return { left, right };
}

function iterationsFor(_kind, fallback) {
  if (globalIterations !== undefined) return numberFromString(globalIterations, fallback);
  return fallback;
}

function numberFromEnv(name, fallback) {
  return numberFromString(process.env[name], fallback);
}

function numberFromString(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function printTable(results) {
  console.log(`Node ${process.version}; ${sampleCount} samples; median shown`);
  const timingResults = results.filter((result) => result.kind !== 'memory');
  const memoryResults = results.filter((result) => result.kind === 'memory');

  if (timingResults.length > 0) {
    console.log('\nTiming benchmarks');
    console.table(timingResults);
  }
  if (memoryResults.length > 0) {
    console.log('\nMemory benchmarks');
    console.table(
      memoryResults.map(({ name, gcAvailable, retainedHeapMb, releasedHeapMb }) => ({
        name,
        gc: gcAvailable,
        retainedMb: retainedHeapMb,
        releasedMb: releasedHeapMb,
      })),
    );
  }
}
