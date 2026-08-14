# Performance benchmarks

The Uklad package includes a small Node benchmark harness for core runtime hot
paths: immutable state transitions, equality policies, subscription graph
work, event dispatch, and retained heap. It runs against the built package
entrypoint, so benchmark results include bundler output rather than the
test-only TypeScript loader.

## Run

From the repository root:

```sh
pnpm benchmark
pnpm benchmark:equality
pnpm benchmark:effects
pnpm benchmark:effects:dev
pnpm benchmark:effects:compare
pnpm --filter @ukladjs/core benchmark
pnpm --filter @ukladjs/core benchmark:state
pnpm --filter @ukladjs/core benchmark:equality
pnpm --filter @ukladjs/core benchmark:subscriptions
pnpm --filter @ukladjs/core benchmark:events
pnpm --filter @ukladjs/core benchmark:effects
pnpm --filter @ukladjs/core benchmark:memory
```

Each command rebuilds `packages/core/dist` first. The timing harness performs
a short warmup, then reports the median of five samples as operations/second.
The package scripts pass `--expose-gc` so memory measurements can force a
collection between snapshots.

Useful controls:

```sh
UKLAD_BENCH_SAMPLES=9 pnpm --filter @ukladjs/core benchmark
UKLAD_BENCH_ITERATIONS=1000 pnpm --filter @ukladjs/core benchmark:equality
UKLAD_BENCH_ITERATIONS=1000 pnpm --filter @ukladjs/core benchmark:subscriptions
UKLAD_BENCH_ITERATIONS=1000 pnpm benchmark:effects:compare
```

Use the same Node version, machine power mode, and benchmark parameters when
comparing commits. These are runtime microbenchmarks, not React render or
end-to-end application benchmarks.

For machine-readable output, build first and then invoke the harness directly
so build logs do not get mixed into the JSON file:

```sh
pnpm --filter @ukladjs/core build
UKLAD_BENCH_JSON=1 node --expose-gc packages/core/benchmarks/run.mjs > benchmark.json
```

## Workloads

| Scope         | Workload                                          | What it isolates                                                                                 |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| State         | `no-op`                                           | Immer recipe/finalization overhead when state identity is unchanged.                             |
| State         | `small-update`                                    | A single primitive update through `dispatchSync`.                                                |
| State         | `deep-update`                                     | Copy-on-write through a nested object path.                                                      |
| State         | `large-no-op`                                     | Cost of opening a recipe over a 10,000-row state without mutation.                               |
| Equality      | `*-array-shared-items-10k`                        | `Object.is`, `shallowEqual`, and Node recursive equality over equivalent allocated outer arrays. |
| Equality      | `shallow-array-different-{first,last}-10k`        | Best- and worst-position early exits for a wide array change.                                    |
| Equality      | `*-array-recreated-items-1k`                      | Shallow propagation versus recursive equality when every nested row is recreated.                |
| Equality      | `shallow-record-{primitives,shared,recreated}-1k` | Plain-record key enumeration plus primitive, shared-object, and recreated-object values.         |
| Equality      | `shallow-map-{primitives,shared,recreated}-1k`    | Native key lookup plus primitive, shared-object, and recreated-object value behavior.            |
| Equality      | `shallow-set-{primitives,shared,recreated}-1k`    | Native membership checks for primitive, shared-object, and recreated-object values.              |
| Equality      | `shallow-typed-array-{equal,different-last}-10k`  | Full-scan typed-array equality and a last-element change.                                        |
| Subscriptions | `fan-out-100`, `fan-out-1000`                     | One changed root propagating to many active computed leaves.                                     |
| Subscriptions | `deep-chain-100`                                  | Topological propagation through a deep dependency chain.                                         |
| Subscriptions | `equality-cutoff-10k`                             | A tick forces a new mapped array with shared items; shallow equality must stop downstream work.  |
| Subscriptions | `identity-propagation-10k`                        | The same tick and selector under `Object.is`; downstream work must run on every update.          |
| Subscriptions | `equality-nested-propagation-1k`                  | A tick recreates nested rows; shallow equality must propagate every measured update.             |
| Subscriptions | `mount-churn`                                     | Repeated activation, initial evaluation, and release of one computed query.                      |
| Events        | `dispatch-small`                                  | `runtime.dispatch()` ownership cost for a small payload.                                         |
| Events        | `dispatch-10k-rows`                               | Event ownership cost for a 10,000-row payload; queue draining is untimed.                        |
| Effects       | `no-effects`, `plain-primitive`                   | Synchronous event/effect baseline and the smallest ordinary effect payload.                      |
| Effects       | `plain-small-object`                              | Always-on draft snapshot inspection for a representative wrapper object.                         |
| Effects       | `plain-array-10k`                                 | Collection fast path plus the bounded development draft-leak scan.                               |
| Effects       | `plain-record-10k`                                | Worst-case width of the plain-object snapshot inspection path.                                   |
| Effects       | `direct-draft-array-repair-10k`                   | Snapshotting a live draft payload before Immer revokes it.                                       |
| Memory        | `state-10k-rows`                                  | Heap retained by a runtime holding a 10,000-row state.                                           |
| Memory        | `subscriptions-fan-out-1000`                      | Heap retained by 1,000 active computed subscriptions.                                            |
| Memory        | `subscriptions-deep-chain-100`                    | Heap retained by a 100-node active dependency chain.                                             |

### Reading equality results

Each direct equality case reports `comparator`, `shape`, `expectedEqual`, and
`resultEqual`. A semantic mismatch throws and fails the benchmark instead of
publishing a misleading fast result. Compare throughput only after checking
the expected result: `Object.is` is intentionally false for two allocated
outer arrays, while shallow and recursive policies can both be true for
different reasons.

The `node:isDeepStrictEqual` rows are a no-dependency recursive reference for
the Node harness. They are not Uklad's default, a browser or Hermes
recommendation, or a performance proxy for every deep-equality library. The
recreated-items pair intentionally demonstrates the semantic tradeoff:
`shallowEqual` exits at the first new row identity and propagates the result;
recursive equality traverses the rows and suppresses it.

Subscription equality workloads report `expectedDownstreamRuns` and
`downstreamRunsDuringMeasurement`. The flat 10k shallow cutoff must remain
zero. Its `Object.is` counterpart and the nested-recreation workload must equal
measured iterations multiplied by the sample count. Warmup runs are reset
before all three checks. These workloads mutate only a scalar tick; their
timings include subscription scheduling, selector allocation, equality, and
result propagation without an unrelated large Immer draft copy.

The `Object.is` row may have higher raw throughput in this harness because its
single downstream selector only reads `items.length`, while `shallowEqual`
scans all 10,000 item identities. Read throughput together with downstream run
counts: the cutoff pays for itself only when the avoided graph, listener, or UI
work costs more than that scan. React rendering is intentionally outside this
runtime-only benchmark.

### Reading effect draft-guard results

`snapshotDrafts` runs inside every event recipe in all environments. It leaves
ordinary payload references untouched and repairs a directly returned live
draft before Immer revokes it. The additional bounded `containsDraft` scan runs
only when Uklad loads with `NODE_ENV=development`.

Run `pnpm benchmark:effects:compare` to print the same workloads first with the
development scan disabled and then enabled. Each row reports `draftLeakScan`,
`payloadShape`, and validated effect execution counts. The delta between modes
isolates the development diagnostic cost; the direct-draft row instead measures
the always-on repair path. A nested leaked draft that reaches the warning path
is covered by correctness tests rather than timed here because console logging
would dominate that authoring-error scenario.

Uklad uses a runtime-local Immer instance with `autoFreeze: false`. State
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
- Direct equality results are shape-specific. Plain records enumerate both key
  lists before comparing values, while arrays, Maps, and Sets can reject an
  early mismatch without scanning their remaining contents.
- Compare `equality-cutoff-10k` with `identity-propagation-10k`: both allocate
  the same selector result, while their equality policies determine whether
  downstream work runs. A cutoff regression can produce unnecessary React
  notifications.
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
