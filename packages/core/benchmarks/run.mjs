import { performance } from 'node:perf_hooks';

import { createUkladRuntime } from '../dist/vanilla.mjs';
import { createUkladTestHarness } from '../dist/testing.mjs';

const scope = process.argv[2] ?? 'all';
const sampleCount = numberFromEnv('UKLAD_BENCH_SAMPLES', 5);
const globalIterations = process.env.UKLAD_BENCH_ITERATIONS;
const jsonOutput = process.env.UKLAD_BENCH_JSON === '1';

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
  if (!['all', 'state', 'subscriptions', 'events', 'memory'].includes(scope)) {
    console.error('Usage: node benchmarks/run.mjs [all|state|subscriptions|events|memory]');
    process.exitCode = 1;
    return;
  }

  const results = [];
  if (scope === 'all' || scope === 'state') results.push(...runStateBenchmarks());
  if (scope === 'all' || scope === 'subscriptions') {
    results.push(...runSubscriptionBenchmarks());
  }
  if (scope === 'all' || scope === 'events') {
    results.push(...(await runEventBenchmarks()));
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

function runSubscriptionBenchmarks() {
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
      iterations: iterationsFor('subscriptions', 2_000),
      setup: () => setupEqualityCutoff(10_000, 'bench-sub-equality-cutoff'),
      operation: ({ runtime }) => getBenchHarness(runtime).dispatchSync(['bench/replace-items']),
      teardown: disposeSubscriptions,
      validate: ({ downstreamRuns }) => ({
        downstreamRunsDuringMeasurement: downstreamRuns,
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
  let context = setup();
  collectGarbage();
  const afterSetup = memorySnapshot();
  teardown(context);
  context = undefined;
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

function setupEqualityCutoff(itemCount, runtimeId) {
  const runtime = createBenchRuntime(runtimeId, { items: createRows(itemCount) });
  let downstreamRuns = 0;
  runtime.registerModule((registrar) => {
    registrar.regRootSub('bench/items-root', 'items');
  });
  runtime.registerModule((registrar) => {
    registrar.regSub(
      'bench/mapped-items',
      () => [['bench/items-root']],
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

function createBenchRuntime(runtimeId, initialState = { tick: 0 }) {
  const runtime = createUkladRuntime({ initialState, runtimeId });
  runtime.registerModule((registrar) => {
    registrar.regEvent('bench/tick', ({ draftState }) => {
      draftState.tick += 1;
    });
  });
  runtime.registerModule((registrar) => {
    registrar.regEvent('bench/replace-items', ({ draftState }) => {
      draftState.items = [...draftState.items];
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
