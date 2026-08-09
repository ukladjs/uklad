# Uklad invariant enforcement matrix

- **Status:** Working canonical policy
- **Last updated:** 2026-08-02
- **Scope:** Uklad application authoring, runtime composition, production event
  execution, subscription publication, external ingress, and agent guidance

## Purpose

This document assigns every important Uklad invariant to an enforcement layer.
It is the normative companion to the
[Foundation ADR](foundation-adr.md), the
[canonical application structure](canonical-app-structure.md), and the
[application authoring rules](application-authoring-rules.md).

The matrix prevents two opposite mistakes:

- relying on agent instructions for an invariant whose violation can corrupt
  executor state, cache identity, ordering, authority, or external effects; and
- adding defensive production work for an application-authoring mistake that
  types, construction-time checks, linting, templates, skills, or focused tests
  can expose without taxing every event or subscription recomputation.

The target production path is trusted, but not unchecked. A production check
is justified when it protects executor or trust-boundary integrity, has bounded
cost, and has benchmark evidence. Skills guide judgment and workflow; they are
never the sole safety boundary for runtime integrity or external authority.

The matrix assigns outcomes and enforcement ownership; it does not prescribe a
particular API for achieving them. For example, composition completeness may be
proved by a build validator, generated composition, or runtime finalization.
Manifest and operation rows apply when those optional surfaces are provided and
must not be read as claims that their target behavior is already implemented.

## Enforcement layers

The matrices use these layer codes. The first listed layer is the primary
owner; later layers provide supporting evidence or better diagnostics.

| Code | Layer                         | Responsibility                                                                                         |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `T`  | Types and build-time checks   | IDs, payloads, readonly ownership, fixed tuples, callback return types, linting, and static contracts. |
| `C`  | Composition and registration  | Duplicate detection, catalog completeness, platform coverage, policy selection, and finalization.      |
| `R`  | Always-on runtime core        | Serialization, isolation, reentrancy, cache integrity, commit ordering, and failure isolation.         |
| `B`  | External boundary adapter     | Schema validation, authorization, normalization, cloning/freezing when needed, and exposure policy.    |
| `D`  | Development diagnostics       | Actionable warnings and bounded probes for mistakes that do not threaten executor integrity.           |
| `S`  | Skills, templates, and review | Architecture choices, ownership discipline, dependency design, equality choice, and verification flow. |
| `O`  | Optional observability        | Tracing, DevTools, evidence collection, and inspection without execution authority.                    |

Tests and benchmarks are evidence, not an enforcement layer by themselves.
They prove that the selected layer works and that its cost remains acceptable.

## Failure classes

| Code | Failure class          | Meaning                                                                                       |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `I`  | Executor integrity     | Can corrupt state, ordering, runtime isolation, reactive graph identity, or causal execution. |
| `X`  | Trust-boundary safety  | Can authorize malformed or unintended external work, leak data, or create false success.      |
| `A`  | Authoring correctness  | Produces an application bug while the executor itself remains sound.                          |
| `P`  | Performance and design | Causes excessive invalidation, allocation, comparison, rendering, or retained memory.         |
| `E`  | Evidence and operation | Makes manifests, traces, completion, results, or revisions misleading.                        |

## Production-cost classes

Every always-on mechanism must fit one of these cost classes. Work outside the
trusted core, such as ingress validation, is marked `boundary` rather than
charged to event or subscription throughput.

| Cost         | Permitted production work                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `none`       | Compile time, lint time, templates, skills, tests, or review work.                                    |
| `cold`       | Runtime creation, module installation, sealing, registration, disposal, or cache construction.        |
| `O(1)`       | A small fixed branch, identity check, counter update, or registry lookup per relevant operation.      |
| `O(k)`       | Work over a deliberately bounded tuple or list, such as query parameters or emitted effects.          |
| `work-bound` | Work proportional to the graph nodes, dependencies, listeners, or effects that must actually execute. |
| `optional`   | Work performed only while an explicit probe or diagnostic capability is attached.                     |
| `boundary`   | Potentially deep validation or copying before data enters the trusted runtime core.                   |
| `forbidden`  | Unbounded defensive copying, freezing, validation, or instrumentation on every trusted hot-path call. |

`O(1)` does not mean automatically acceptable. A proposed check still needs an
integrity rationale and a benchmark demonstrating no material regression.

## Runtime and executor invariants

| ID      | Invariant                                                                                                             | Failure       | Primary enforcement | Production cost | Required evidence                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `EX-01` | One runtime owns one state head, registry set, queue, subscription graph, and lifecycle.                              | `I`           | `R`, `C`, `T`       | `O(1)`          | Parallel-runtime, SSR-request-isolation, fixture-isolation, and disposal tests.                   |
| `EX-02` | A runtime-owned handle or subscription node cannot be used by another runtime.                                        | `I`           | `R`, `T`            | `O(1)`          | Cross-runtime subscription, registration, and adapter misuse tests.                               |
| `EX-03` | Accepted state transitions execute serially and preserve accepted-event ordering.                                     | `I`           | `R`                 | `O(1)`          | Batch ordering, cascade ordering, failure-continuation, and queue throughput tests.               |
| `EX-04` | Coeffects, interceptors, event handlers, dependency functions, and computations finish synchronously.                 | `A`           | `T`, `S`, `D`       | `none`          | Type and focused tests cover thenable returns without generalized production callback monitoring. |
| `EX-05` | Candidate state commits before any external effect for that transition executes.                                      | `I`           | `R`                 | `work-bound`    | An effect observes committed state; a throwing effect cannot roll back state.                     |
| `EX-06` | Synchronous dispatch cannot reenter a transition or overtake previously accepted async work.                          | `I`           | `R`                 | `O(1)`          | Reentrancy, queued-work, flush-failure, and revision-order tests.                                 |
| `EX-07` | Failures in independent transitions, effects, subscription computations, and listeners are isolated.                  | `I`           | `R`                 | `work-bound`    | One failing unit does not suppress unrelated queued work, effects, graph branches, or listeners.  |
| `EX-08` | Committed and published revisions are monotonic and remain explicitly distinguishable.                                | `I`, `E`      | `R`                 | `O(1)`          | Batched-publication, no-op transition, restore, failure, and exact-revision tests.                |
| `EX-09` | Headless core execution does not require React, the DOM, animation frames, or browser globals.                        | `I`           | `T`, `C`            | `none`          | Node import test, headless integration test, SSR test, and package-consumption test.              |
| `EX-10` | Application modules do not depend on queue states, interceptor bookkeeping, trace storage, or render timing.          | `A`, `E`      | `T`, `S`            | `none`          | Public-type closure tests, API review, and executor-conformance fixtures.                         |
| `EX-11` | Transition serialization, timers, retries, task concurrency, and render publication remain separate responsibilities. | `I`, `A`, `P` | `T`, `R`, `S`       | `none`          | API-boundary tests, delayed-work fixtures, headless tests, and scheduler-specific benchmarks.     |
| `EX-12` | Ordered global interceptors run before event-specific interceptors and unwind afterward in reverse order.             | `I`, `A`      | `C`, `R`            | `work-bound`    | Zero/one/many interceptor ordering, error, and throughput tests.                                  |

## Application contract and composition invariants

| ID      | Invariant                                                                                                                          | Failure  | Primary enforcement         | Production cost | Required evidence                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `AC-01` | One application has one authoritative catalog and one complete `AppContracts`.                                                     | `A`, `E` | `T`, `C`, `S`               | `cold`          | Static catalog/contract conformance test and generated-manifest snapshot.                                         |
| `AC-02` | State keys and handler IDs are direct literals, correctly namespaced, and not repeated as ad hoc strings.                          | `A`      | `T`, `S`                    | `none`          | Lint fixtures for valid literals, bad namespaces, computed strings, and raw repeats.                              |
| `AC-03` | Declared, installed, and externally exposed capabilities are distinct states.                                                      | `X`, `E` | `C`, `B`                    | `cold`          | Manifest tests showing declared-only, installed, missing, dynamic, and exposed entries.                           |
| `AC-04` | Before a production composition is accepted, every required catalog capability has one compatible registration.                    | `I`, `A` | `C`                         | `cold`          | Composition validation succeeds for every platform fixture and reports each missing or incompatible registration. |
| `AC-05` | Duplicate registrations fail atomically and cannot partially replace an installed definition.                                      | `I`, `A` | `C`, `R`                    | `cold`          | Duplicate event/effect/coeffect/subscription tests and failed-module rollback tests.                              |
| `AC-06` | Runtime-wide equality and interceptor policy is selected at composition and immutable for the application lifetime.                | `I`, `P` | `C`, `T`                    | `cold`          | Construction-policy tests, administrative exceptions, policy snapshots, and dispatch benchmark.                   |
| `AC-07` | Feature modules organize registrations but do not create feature runtimes or capability boundaries.                                | `A`, `P` | `S`, `T`                    | `none`          | Generated-app fixture and architecture lint fixtures.                                                             |
| `AC-08` | Every root subscription explicitly maps one declared subscription ID to one compatible state key.                                  | `I`, `A` | `T`, `C`                    | `cold`          | Type tests, duplicate-source tests, composition-validation tests, and root publication tests.                     |
| `AC-09` | Each execution target installs exactly one complete platform implementation set.                                                   | `I`, `X` | `C`, `B`                    | `cold`          | Web, native, headless, and test composition fixtures with missing/duplicate cases.                                |
| `AC-10` | A manifest revision or digest changes with the installed callable capability set.                                                  | `E`      | `C`                         | `cold`          | Deterministic digest snapshots across add, remove, HMR, and dynamic registration.                                 |
| `AC-11` | Dynamic or partially enforced registrations are reported honestly and never presented as verified catalog entries.                 | `X`, `E` | `C`, `O`                    | `cold`          | Inspector and manifest fixtures for catalog-backed, dynamic, and partial entries.                                 |
| `AC-12` | Module disposal cannot tear down definitions required by an active graph or running transition.                                    | `I`      | `R`, `C`                    | `cold`          | Active-subscription disposal, running-event disposal, rollback, and idempotency tests.                            |
| `AC-13` | Runtime-owned effect IDs and event-context keys are reserved and are not redeclared as application capabilities.                   | `I`, `A` | `T`, `C`, `R`               | `cold`          | Catalog type tests and registration cases for built-ins and reserved coeffect slots.                              |
| `AC-14` | Feature prefixes communicate ownership, not authority; declared cross-feature dispatch and subscription dependencies remain valid. | `A`, `X` | `T`, `S`; `B` for authority | `none`          | Cross-feature type/integration tests and external authorization tests that ignore naming as policy.               |

## State, ownership, and event invariants

| ID      | Invariant                                                                                                        | Failure       | Primary enforcement                    | Production cost | Required evidence                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `EV-01` | Application state changes only through an event handler's Immer `draftState`.                                    | `I`, `A`      | `T`, `S`, `R`                          | `work-bound`    | Readonly type tests, mutation lint fixtures, structural-sharing tests, and transitions.         |
| `EV-02` | Initial, restored, and hydrated state transfers ownership to the runtime and is not later mutated by the caller. | `I`, `A`      | `T`, `B`, `S`                          | `none`          | Readonly type tests and boundary mutation tests; no per-handoff recursive freeze.               |
| `EV-03` | State snapshots and subscription results are read-only.                                                            | `I`, `A`      | `T`, `S`                               | `none`          | Public type tests and focused mutation-contract tests.                                          |
| `EV-04` | Independently observed, independently changing high-fan-out values use appropriately granular reactive roots.    | `P`           | `S`                                    | `none`          | Broad-root versus split-root benchmarks using representative update and observation patterns.   |
| `EV-05` | After trusted `dispatch()`, the event vector, parameters, and reachable payload values are not mutated.          | `I`, `A`      | `T`, `S`                               | `none`          | Readonly vector/payload type tests and borrowed-reference ownership tests.                      |
| `EV-06` | Mutable or untrusted event data is validated and receives an explicit ownership boundary before dispatch.        | `X`, `I`      | `B`                                    | `boundary`      | Adapter tests for malformed data, mutation after ingress, clone/freeze policy, and size limits. |
| `EV-07` | A trusted event is a non-empty vector with a known handler in its owning runtime.                                | `I`, `A`      | `T`, `R`; `B` externally               | `O(1)`          | Unknown-ID, malformed-vector, disposed-runtime, built-in dispatch, and queue tests.             |
| `EV-08` | Application code does not dispatch, debounce, or throttle directly during a transition turn.                     | `A`           | `T`, `S`, `D`; `R` for sync reentrancy | `none`          | Lint fixtures, dev-warning tests, declarative-dispatch tests, and reentrancy tests.             |
| `EV-09` | Environmental reads and writes are modeled as coeffects and effects rather than hidden handler I/O.              | `A`, `E`      | `T`, `S`                               | `none`          | Architecture lint fixtures and deterministic handler/subscription unit tests.                   |
| `EV-10` | Every requested coeffect is present and receives a state-free view captured before the event handler runs.       | `I`, `A`      | `T`, `C`, `R`                          | `O(k)`          | Missing, throwing, ordered-binding, state-absence, and abort-before-commit tests.               |
| `EV-11` | Coeffect handlers return synchronously.                                                                          | `A`           | `T`, `S`, `D`                          | `none`          | Type tests and focused thenable-return diagnostics for permissive escape paths.                 |
| `EV-12` | Effect intents are structurally valid before a handler capable of external work is invoked.                      | `I`, `X`      | `R`, `T`                               | `O(k)`          | Malformed, missing-handler, built-in dispatch, throwing, and rejected-thenable tests.           |
| `EV-13` | A missing required effect or coeffect produces failure rather than apparent success.                             | `I`, `X`, `E` | `C`, `R`                               | `cold`, `O(1)`  | Composition coverage plus runtime structured-failure and operation-outcome tests.               |
| `EV-14` | Event handlers do not leak Immer drafts into effect payloads.                                                    | `A`, `P`      | `T`, `S`, `D`                          | `none`          | Direct and nested draft-leak fixtures; production benchmark proves no recursive repair walk.    |
| `EV-15` | Promise-returning effects are never reported as synchronously completed, and rejections are observed.            | `I`, `E`      | `R`                                    | `O(k)`          | Returned, detached, rejected, throwing, and future supervised-task outcome tests.               |

## Subscription invariants

| ID       | Invariant                                                                                                                               | Failure  | Primary enforcement      | Production cost      | Required evidence                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `SUB-01` | A root subscription exposes exactly one declared state root and does not accept parameters.                                             | `I`, `A` | `T`, `C`, `R`            | `cold`, `O(1)`       | Type tests, parameter rejection, source collision, and identity-publication tests.                     |
| `SUB-02` | A computed subscription declares every dependency it reads, and graph shape is static per serialized query.                             | `I`, `A` | `T`, `S`, `R`            | `cold`               | Dependency-order type tests, missing dependency, dynamic-read lint, and graph fixtures.                |
| `SUB-03` | Dependency functions and computations return synchronously; a thenable never becomes a cached value.                                    | `A`      | `T`, `S`, `D`            | `none`               | Async/thenable type tests and focused diagnostics for permissive escape paths.                         |
| `SUB-04` | Query parameters are a fixed tuple of `string`, finite `number`, `boolean`, or `null`.                                                  | `I`, `P` | `T`, `R`; `B` externally | `O(k)`               | Type and runtime cases for objects, arrays, undefined, non-finite numbers, and unbounded declarations. |
| `SUB-05` | Cache-key encoding is deterministic, collision-free for the parameter domain, and independent of object identity.                       | `I`      | `R`                      | `O(k)`               | Exhaustive scalar cases, ambiguous-string cases, cache-hit tests, and key-generation benchmark.        |
| `SUB-06` | Every computed subscription resolves to one construction-time equality policy, inherited or overridden, and that choice is inspectable. | `I`, `P` | `C`, `T`, `S`            | `cold`               | Framework fallback, application override, per-subscription override, capture, and manifest tests.      |
| `SUB-07` | Equality functions are pure, deterministic, and appropriate for output size, frequency, sharing, and fan-out.                           | `A`, `P` | `S`                      | `work-bound`         | Domain comparator laws plus identity/shallow/deep crossover and fan-out benchmarks.                    |
| `SUB-08` | Equality cutoffs stop downstream recomputation and notification without hiding a real result change.                                    | `I`, `P` | `R`                      | `work-bound`         | Equality-cutoff correctness, downstream-run count, listener count, and render-count tests.             |
| `SUB-09` | Active graphs settle dependency-first against one published state generation before listeners run.                                      | `I`      | `R`                      | `work-bound`         | Diamond DAG, multi-root, deep-chain, listener snapshot, reentrancy, and error-propagation tests.       |
| `SUB-10` | Dormant graph reads validate dependencies without recursion overflow or cross-runtime reuse.                                            | `I`, `P` | `R`                      | `work-bound`         | Deep dormant-chain, cached-error retry, cross-runtime, and pull-allocation tests.                      |
| `SUB-11` | Publication work scales with affected roots and active graph work, not the size of unrelated state or dormant graphs.                   | `P`      | `R`                      | `work-bound`         | Root-count, unrelated-state-size, dormant-graph, fan-out, mixed-DAG, and allocation benchmarks.        |
| `SUB-12` | Subscription creation, activation, release, and provisional eviction preserve cache and graph integrity.                                | `I`, `P` | `R`, `C`                 | `cold`, `work-bound` | Mount churn, shared dependency, release during notification, HMR, eviction, and retained-memory tests. |
| `SUB-13` | An extension lifecycle starts only for a live target, passively samples signals without retaining them, and routes writes through a registered root. | `I`, `A`, `X` | `R`, `T`, `C` | `cold`, `O(active extensions)` | Activation/disposal, signal switch, dormant-signal, protected-update, and parameterized shared-root tests. |

## External boundaries, manifests, and observability

| ID      | Invariant                                                                                                                        | Failure  | Primary enforcement | Production cost      | Required evidence                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `BO-01` | Registration makes a capability available to its runtime; it does not expose it to remote or untrusted callers.                  | `X`      | `B`, `C`            | `boundary`           | Exposure-default, authorization, unexposed-ID, and least-privilege tests.              |
| `BO-02` | External commands, queries, and effects use runtime schemas and policy in every build.                                           | `X`, `I` | `B`                 | `boundary`           | Schema version, malformed input, authorization, size limit, and compatibility tests.   |
| `BO-03` | Operation identity, causality, revisions, results, completion, and structured errors are core execution facts.                   | `I`, `E` | `R`                 | `O(1)`, `work-bound` | Parent/child, retry, partial failure, commit/publication, and exact-result tests.      |
| `BO-04` | Tracing, logging, DevTools, and telemetry are passive projections and cannot decide execution truth.                             | `I`, `E` | `O`, `R`            | `optional`           | Probe-failure isolation, tracing-disabled behavior, dropped-trace, and replay tests.   |
| `BO-05` | A manifest reports only enforced truth and carries a deterministic revision or digest.                                           | `X`, `E` | `C`, `O`            | `cold`               | Catalog-backed, dynamic, partial, missing, add/remove, and deterministic digest tests. |
| `BO-06` | Operation or manifest output never equates committed state with query-visible state before publication.                          | `I`, `E` | `R`, `O`            | `O(1)`               | Delayed publication, batched commits, exact revision, and operation receipt tests.     |
| `BO-07` | Headless and test platforms install safe, deliberate environment handlers rather than silently succeeding with missing work.     | `X`, `E` | `C`, `B`, `S`       | `cold`               | Safe-adapter, explicit no-op, missing-handler, and recorded-effect integration tests.  |
| `BO-08` | Queue `flush()` is a testing or administrative publication boundary, not proof that one operation's asynchronous work completed. | `I`, `E` | `T`, `R`, `S`       | `none`               | Detached-effect, delayed-dispatch, causal-operation, and publication-settlement tests. |

## Hot-path and diagnostic policy

| ID      | Invariant                                                                                                                     | Failure  | Primary enforcement | Production cost          | Required evidence                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `HP-01` | Trusted dispatch does not copy or recursively freeze an event or its reachable payload graph.                                 | `P`      | `R`, `T`, `S`       | `O(1)`                   | Small versus 10k-row dispatch benchmark and borrowed-reference tests in dev and production. |
| `HP-02` | State commit does not recursively freeze or validate the complete state graph.                                                | `P`      | `R`, `T`, `S`       | `work-bound`             | Large no-op, deep update, retained-memory, and ownership tests.                             |
| `HP-03` | Subscription recomputation performs only declared compute, equality, propagation, and requested evidence work.                | `P`      | `R`, `O`            | `work-bound`             | Fan-out, deep-chain, mixed-DAG, equality, listener, allocation, and probe benchmarks.       |
| `HP-04` | An always-on event or subscription check has a documented integrity reason and bounded cost.                                  | `P`, `I` | `R`, `S`            | `O(1)` or bounded `O(k)` | Pull-request rationale plus before/after benchmark on the affected workload.                |
| `HP-05` | Authoring diagnostics do not perform unbounded walks or generalized callback monitoring in ordinary production execution.     | `P`      | `D`, `S`, `O`       | `none` or `optional`     | Production-bundle inspection and diagnostic-enabled/disabled benchmarks.                    |
| `HP-06` | With no probe attached, instrumentation adds no evidence construction and only negligible dispatch or recomputation overhead. | `P`      | `R`, `O`            | `O(1)`                   | Probe-off versus uninstrumented baseline, lightweight probe, and full-evidence benchmarks.  |
| `HP-07` | Performance gates use workload-specific budgets for throughput, allocation, retained memory, and notification/render counts.  | `P`      | `T`                 | `none`                   | Stable V8 baseline, Hermes baseline, noise analysis, and regression-gate fixture.           |

## Enforcement decision rule

When adding or changing an invariant, apply these questions in order:

1. **Can violation corrupt executor state, ordering, cache identity, runtime
   isolation, authority, or externally visible success?** If yes, use `T`, `C`,
   `R`, or `B` as appropriate; a skill or warning is insufficient.
2. **Can the invariant be proven before execution?** Prefer `T` or `C` over a
   per-event or per-recomputation check.
3. **Is the input crossing a trust boundary?** Validate and establish ownership
   in `B` before entering the trusted core.
4. **Is the rule an architectural or performance judgment rather than a binary
   safety fact?** Use `S`, templates, focused tests, and representative
   benchmarks.
5. **Does an always-on check touch every event, dependency, result, listener, or
   payload node?** Document why the work is intrinsic, bound it to actual work,
   and provide benchmark evidence. Otherwise move it off the hot path.
6. **Does the diagnostic affect execution truth?** If yes, it is not a
   diagnostic and belongs in the core outcome model. If no, keep it optional
   and failure-isolated.

## Required change record for hot-path work

A change touching dispatch, transition execution, state commit/publication,
subscription recomputation/notification, cache-key generation, or probe calls
must record:

1. the matrix invariant IDs it implements or changes;
2. the failure prevented and why the selected enforcement layer is necessary;
3. work added or removed per event, root, dependency, result, effect, or
   listener;
4. allocations added or removed on the uninstrumented path;
5. before/after results for the directly affected benchmark workloads; and
6. focused correctness tests proving the invariant and its failure behavior.

A new production guard is rejected when the only rationale is improved error
messaging for controlled application authoring and the same mistake can be made
visible through `T`, `C`, `D`, or `S`.

## Known enforcement gaps at adoption

This matrix states the target policy. As of 2026-08-02, the following gaps must
remain visible until implementation and evidence satisfy the corresponding
rows:

- `AC-01` through `AC-04`, `AC-09`, and `BO-05`: the TypeScript contract and
  application catalog are not yet connected to a sealed runtime composition or
  authoritative generated manifest.
- `EV-02`, `EV-03`, and `EV-05`: public vector and snapshot/result types do not
  yet express the complete readonly ownership contract.
- `EX-04`, `EV-11`, and `SUB-03`: synchronous callback type and diagnostic
  coverage is not yet uniform across typed and permissive escape paths.
- `SUB-04` and `SUB-05`: subscription cache keys still use generic JSON
  serialization and development inspection rather than a bounded scalar
  encoder.
- `EV-13`: required coeffect failures abort transitions, but missing effects
  are not yet covered by composition validation and can still be logged and
  ignored at execution.
- `EV-14` and `HP-05`: production event execution still performs authoring
  repair for leaked drafts and needs an integrity/cost review.
- `HP-06`: disabled instrumentation avoids evidence construction but some call
  sites still create wrapper closures on the uninstrumented path.
- `HP-07`: existing benchmarks have no accepted CI budgets, and event dispatch
  workloads measure enqueueing rather than complete event-turn execution.
- `BO-03` and `BO-06`: exact operation identity, causal completion, results,
  and revision-aware receipts remain an incremental target rather than a
  complete core contract.
- `EX-11`: the current executor still combines event queue scheduling with
  delayed and rate-limited work; the pre-1.0 execution review must decide what
  remains in the core and what moves to task, timer, or adapter ownership.

Implementation status belongs in the roadmap and tests. This gap list exists
only to prevent the normative matrix from being mistaken for already-enforced
behavior.
