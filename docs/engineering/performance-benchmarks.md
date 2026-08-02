# Performance benchmarks

The Reflex package includes a small Node benchmark harness for core runtime hot
paths: immutable state transitions, subscription graph work, event dispatch,
and retained heap. It runs against the built package entrypoint, so benchmark
results include bundler output rather than the test-only TypeScript loader.

## Run

From the repository root:

```sh
pnpm --filter @flexsurfer/reflex benchmark
pnpm --filter @flexsurfer/reflex benchmark:state
pnpm --filter @flexsurfer/reflex benchmark:subscriptions
pnpm --filter @flexsurfer/reflex benchmark:events
pnpm --filter @flexsurfer/reflex benchmark:memory
```

Each command rebuilds `packages/reflex/dist` first. The timing harness performs
a short warmup, then reports the median of five samples as operations/second.
The package scripts pass `--expose-gc` so memory measurements can force a
collection between snapshots.

Useful controls:

```sh
REFLEX_BENCH_SAMPLES=9 pnpm --filter @flexsurfer/reflex benchmark
REFLEX_BENCH_ITERATIONS=1000 pnpm --filter @flexsurfer/reflex benchmark:subscriptions
```

Use the same Node version, machine power mode, and benchmark parameters when
comparing commits. These are runtime microbenchmarks, not React render or
end-to-end application benchmarks.

For machine-readable output, build first and then invoke the harness directly
so build logs do not get mixed into the JSON file:

```sh
pnpm --filter @flexsurfer/reflex build
REFLEX_BENCH_JSON=1 node --expose-gc packages/reflex/benchmarks/run.mjs > benchmark.json
```

## Workloads

| Scope         | Workload                       | What it isolates                                                                    |
| ------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| State         | `no-op`                        | Immer recipe/finalization overhead when state identity is unchanged.                |
| State         | `small-update`                 | A single primitive update through `dispatchSync`.                                   |
| State         | `deep-update`                  | Copy-on-write through a nested object path.                                         |
| State         | `large-no-op`                  | Cost of opening a recipe over a 10,000-row state without mutation.                  |
| Subscriptions | `fan-out-100`, `fan-out-1000`  | One changed root propagating to many active computed leaves.                        |
| Subscriptions | `deep-chain-100`               | Topological propagation through a deep dependency chain.                            |
| Subscriptions | `equality-cutoff-10k`          | A new root array whose mapped output is deep-equal, so downstream work should stop. |
| Subscriptions | `mount-churn`                  | Repeated activation, initial evaluation, and release of one computed query.         |
| Events        | `dispatch-small`               | `runtime.dispatch()` ownership cost for a small payload.                            |
| Events        | `dispatch-10k-rows`            | Event ownership cost for a 10,000-row payload; queue draining is untimed.           |
| Memory        | `state-10k-rows`               | Heap retained by a runtime holding a 10,000-row state.                              |
| Memory        | `subscriptions-fan-out-1000`   | Heap retained by 1,000 active computed subscriptions.                               |
| Memory        | `subscriptions-deep-chain-100` | Heap retained by a 100-node active dependency chain.                                |

The equality-cutoff workload includes a
`downstreamRunsDuringMeasurement` field in JSON output. It should be zero
after warmup; a non-zero value means the default equality cutoff is no longer
preventing downstream recomputation.

Reflex uses a runtime-local Immer instance with `autoFreeze: false`. State
workloads therefore measure the copy-on-write transition and subscription work,
not a recursive freeze of the finalized state graph. This is intentional in
both development and production: ownership mistakes are caught through types,
agent instructions, boundary tests, and ingress validation rather than a
per-commit graph walk.

## Interpreting changes

- State regressions usually point to Immer recipe size, structural sharing, or
  accidental allocation in event handlers.
- Fan-out and deep-chain regressions point to subscription scheduling, duplicate
  traversal, or listener activation costs.
- Equality-cutoff regressions are correctness/performance regressions together:
  they increase work and can produce unnecessary React notifications.
- Mount-churn results describe lifecycle cost, not steady-state publication
  cost; compare them separately.
- Event dispatch results measure ownership and enqueueing. They do not include
  event handler execution because queue draining happens after timing. The
  runtime borrows event payloads without copying or deep-freezing them in both
  development and production, so dispatch cost should remain close to flat as
  payload size grows.
- Memory results are retained heap deltas after an explicit GC. Run with
  `--expose-gc`; without it, GC availability is reported as false and values
  are much noisier.

The benchmark suite is intentionally small and deterministic enough for local
comparisons. Before making CI gates, collect machine-specific baselines for V8,
Hermes, and the supported React Native targets, then set budgets per workload
rather than one package-wide threshold.
