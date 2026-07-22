# Agent-first priorities

> **Purpose:** Re-rank Reflex work when AI agents are the primary users, while
> retaining the human-facing improvements that make agent-written applications
> easier to generate, review, operate, and maintain.

This document is a prioritization companion to the main [roadmap](../ROADMAP.md).
The roadmap remains the implementation status tracker. This document defines
the product order and the decision lens: when an agent requirement and a human
ergonomics requirement compete, which one should happen first and why?

The target position is:

> **Reflex is a deterministic, policy-enforced command runtime whose state can
> drive React.** Humans can use it directly, but its contracts, execution model,
> and evidence are designed so an AI agent does not have to guess what is legal,
> what happened, or whether retrying is safe.

---

## 1. Audiences

Reflex has three related audiences. They share the same core, but they do not
need the same product surface.

### Coding and verification agents

Agents that inspect a repository, write handlers/selectors/components, launch a
headless application, reproduce a bug, and prove that a change works. Their
canonical loop is documented in [agent-workflow.md](agent-workflow.md).

They need:

- a small, trustworthy static index;
- compile-time and runtime contracts;
- exact source locations and dependency graphs;
- safe headless adapters and reproducible fixtures;
- bounded observe -> act -> verify tools;
- diagnostics that identify the next repair action.

### Runtime agents

Agents that invoke application behavior in a running system. They may share the
runtime with users or other agents and may trigger external effects.

They need:

- least-privilege commands rather than raw event dispatch;
- runtime input/output validation;
- idempotency and optimistic concurrency;
- supervised asynchronous tasks;
- deadlines, cancellation, budgets, and backpressure;
- approvals for risky operations;
- durable, causal receipts and audit evidence.

### Human developers and operators

Humans still design domains, review generated changes, approve sensitive work,
debug failures, and maintain applications over time. Human-facing improvements
remain important when they also reduce ambiguity for coding agents or make the
resulting codebase easier to verify.

The DevTools MCP should remain a **development control plane**. A production
runtime agent should use a separate, policy-enforced **command plane**, even if
both are backed by the same Reflex runtime and contract registry.

---

## 2. Priority scale


| Priority | Meaning                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | Required before Reflex can make strong agent-safety, determinism, or verification claims.                                     |
| **P1**   | High-leverage agent capability or coding-agent productivity work. Expected before 1.0 unless evidence clearly demotes it.     |
| **P2**   | Human/API/productization improvement that materially helps agent-generated applications but does not define execution safety. |
| **P3**   | Ecosystem parity, convenience, or polish. Build only when evaluations or adoption demonstrate demand.                         |


Within one priority, dependency order wins. A small agent evaluation baseline
should start immediately, but it must not delay obvious P0 correctness fixes.

### Complexity scale

Priority describes **when** an item should happen. The two complexity ratings
describe different implementation risks and must not be used as substitutes
for priority.

#### Implementation complexity


| Rating | Meaning                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- |
| **S**  | Localized implementation with a known design and narrow test surface.                       |
| **M**  | Several modules or one package, with meaningful contract and regression testing.            |
| **L**  | Cross-package work spanning runtime, tooling, protocol, or application integration.         |
| **XL** | Architectural program requiring multiple milestones, new semantics, and broad verification. |


#### Change complexity


| Rating        | Meaning                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| **Low**       | Additive or internal change with little migration risk.                                                      |
| **Medium**    | Public behavior or API addition that can be introduced through adapters, aliases, or staged migration.       |
| **High**      | Breaking or widely observable semantic change affecting existing applications or integrations.               |
| **Very high** | Changes authority, execution, persistence, replay, or completion guarantees across the runtime and protocol. |


These are relative estimates, not calendar commitments. Ratings assume good
test coverage and staged compatibility where practical. Removing compatibility
aliases immediately would raise the change complexity of several API items.

#### Breaking-change marker


| Marker          | Meaning                                                                                                                      | Planning rule                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Yes**         | The intended behavior or API invalidates an existing supported usage, even if the old usage was unsafe.                      | Decide and land before 1.0 where possible. After 1.0, require a major version or an explicitly documented corrective exception. |
| **Conditional** | The replacement can be added compatibly, but making it required, changing the default, or removing the old path is breaking. | Add the replacement early, migrate templates/docs/internal code, and schedule removal separately.                               |
| **No**          | The item is additive or internal when implemented as described.                                                              | Safe to postpone until evidence or dependencies justify it.                                                                     |
| **—**           | The item is a non-goal and has no planned migration.                                                                         | Do not schedule.                                                                                                                |


A breaking marker describes the final intended contract, not only the first
compatibility step. Security and correctness fixes are still marked breaking
when applications can observe different behavior; calling them fixes does not
remove the need for migration notes and tests.

### Decision rules

When two items compete, prefer:

1. preventing false success, duplicate effects, stale writes, or unauthorized
  actions over reducing API ceremony;
2. executable schemas over prose conventions;
3. one canonical API over multiple aliases;
4. semantic registered queries over raw state dumps;
5. exact causal identifiers over timestamp-based inference;
6. bounded structured responses over large diagnostic payloads;
7. evaluation evidence over speculative tool proliferation.

---

## 3. Unified execution priorities

This is the recommended cross-audience implementation order.

### P0.1 — Close deterministic-core integrity gaps

Before adding new agent tools, make the existing event/state evidence complete
and trustworthy.

- Take ownership of initial and restored state. Do not retain caller-owned
mutable references; expose read-only snapshots and deep-freeze owned state in
development.
- Copy or freeze accepted event inputs so callers cannot modify queued work.
- Replace collision-prone subscription query serialization with an enforced,
  canonical simple parameter contract: no parameters, or a small bounded tuple
  of `string`, finite `number`, `boolean`, and `null` values. Reject objects,
  arrays, `undefined`, `NaN`, `Infinity`, functions, symbols, `BigInt`, and
  class/collection values at the boundary.
- Return immutable handler/inspector descriptions rather than mutable runtime
registries or live state references.
- Treat missing required effects, coeffects, malformed values, and unknown IDs
as structured failures. Do not warn and then report apparent success.
- Preserve accepted-event ordering. A synchronous operation must not overtake
earlier queued work.
- Isolate failures by causal operation. One bad command must not silently purge
unrelated user or agent commands.
- Ensure a failed queue flush still publishes state successfully committed by
earlier work before returning the failure.

**Exit condition:** every state transition is attributable to a core operation,
and absence of a successful receipt is never confused with success.

### P0.2 — Introduce executable command, query, and effect contracts

Stable string IDs are an excellent agent index, but IDs alone do not tell an
agent how to call something safely.

Add descriptor APIs such as:

```ts
const addTodo = defineCommand({
  id: 'todos/add',
  version: 1,
  description: 'Add one todo',
  input: schema.object({
    title: schema.string({ minLength: 1 }),
  }),
  output: schema.object({
    todoId: schema.string(),
  }),
  agent: {
    exposed: true,
    capabilities: ['todos.write'],
    risk: 'state-write',
  },
  idempotency: 'required',
  writes: ['/todos/*'],
  emits: ['storage/write'],
  handle({ draft, input, coeffects, emit }) {
    // Pure state transition plus declarative effects.
  },
})
```

Required properties:

- one named object input at the external boundary, rather than positional
`any[]` parameters;
- declared output/result schemas;
- runtime validation in every build, not TypeScript-only contracts;
- command/query/effect versions and stable contract hashes;
- descriptions, examples, capabilities, risk, idempotency, and deprecation;
- required coeffects, possible emitted effects, and declared state paths;
- generated TypeScript types rather than separately maintained payload maps;
- build-generated source locations, call sites, and selector dependencies;
- an authoritative `.reflex/contract.json` plus a compact human fallback.

Static and runtime manifests should expose the same contract hash so an agent
can detect stale knowledge after a rebuild or reconnect.

#### Commands are not events

- A **command** is an externally invocable, authorized request with a finite
input, result, policy, and outcome.
- An **event** is an internal runtime message or fact.
- A command may compile to the existing event/interceptor/Immer/effect pipeline.
- Registered events are private by default. Only definitions explicitly marked
agent-callable belong in the command catalog.
- Raw tuple dispatch remains an internal, legacy, or test capability.

This prevents internal events such as `payment/succeeded` or
`session/token-restored` from becoming remotely callable merely because they
have registered handlers.

### P0.3 — Make operation identity and receipts core primitives

DevTools should not infer command completion by waiting for and correlating a
later trace. Operation identity must originate in the runtime and flow through
the whole causal tree.

An invocation should carry an envelope outside the agent-controlled payload:

```ts
executeCommand({
  command: 'todos/add@1',
  input: { title: 'Milk' },
  idempotencyKey: 'agent-task-284/step-3',
  expectedRevision: 41,
  expectedContractHash: 'sha256:...',
  deadline: '2026-07-19T12:00:00Z',
})
```

The trusted gateway injects principal identity, capabilities, approval grants,
runtime identity, and session identity as unforgeable context.

Every operation needs:

- `operationId` and optional parent/causation IDs;
- authenticated principal and policy decision;
- command/schema version and contract hash;
- committed and published state revisions;
- state patches and a typed command result;
- emitted effect and task statuses;
- publication completion;
- audit identity;
- stable error codes and a `retryable` field.

A receipt must distinguish:

- accepted versus rejected;
- handler execution versus state commit;
- committed versus published state;
- state success versus required-effect failure;
- pending task work versus causal settlement;
- duplicate invocation versus new execution.

Transport timeout should return a pending `operationId`, not an ambiguous
`unknown`. The caller can use `getOperation` to recover the final result.

### P0.4 — Add monotonic revisions, idempotency, and preconditions

Agents retry after timeouts and act on observations that can become stale.
Serialization through one queue is not sufficient protection.

- Increment an opaque or numeric committed revision for every state commit.
- Track the last published revision separately.
- Return revisions from every command, query, snapshot, and wait operation.
- Support `expectedRevision` and later semantic query preconditions.
- Require an idempotency key for externally mutating commands unless a command
explicitly declares that it cannot be safely retried.
- The same key plus the same command/input fingerprint returns the existing
operation; the same key with different input returns
`IDEMPOTENCY_CONFLICT`.
- Propagate deterministic keys to effect adapters, such as
`operationId/effectIndex`.
- Document the deduplication scope: runtime session, persisted application, or
downstream service.

Reflex must not promise exactly-once external I/O from an in-memory ledger.
Durable workflows require an inbox/outbox or downstream systems that honor the
propagated idempotency key.

### P0.5 — Move supervised asynchronous tasks ahead of agent claims

Effects stay declarative data, but promise-returning and long-running work needs
a runtime-owned supervisor.

Minimum task runtime:

- parent/child task and operation causality;
- `AbortSignal`, deadline, timeout, and cancellation;
- `started`, `succeeded`, `failed`, `cancelled`, and `expired` states;
- `latest`, `queue`, and bounded `parallel` policies;
- retry attempts with limits and idempotency propagation;
- progress/stream events with bounded buffers and backpressure;
- structured retryability/error classification;
- command-scoped settlement that waits only for causal descendants.

`flush()` remains an event-queue and publication boundary. It must not be
presented as completion of arbitrary asynchronous work.

### P0.6 — Enforce a semantic safety and resource policy

The existing read-only-by-default DevTools transport is a strong development
baseline. Runtime agents need narrower authority than a global dispatch grant.

- Separate DevTools inspection/fixture capabilities from production command
capabilities.
- Make commands and queries private unless explicitly exposed.
- Authorize by principal, command, tenant/resource, runtime, and effect domain.
- Let commands declare `read-only`, `state-write`, `external-write`, or
`irreversible` risk and an approval policy.
- Recheck authority in effect adapters before irreversible I/O.
- Enforce safe/no-op/in-memory adapter policies in headless agent runtimes.
- Scope state reads and classify schema fields for secret, PII, or business
sensitivity.
- Enforce per-principal and per-command budgets for queue depth, causal event
count, tasks, concurrency, retries, time, effects, payload/result bytes,
stream buffers, and optionally token/cost units.
- Budget exhaustion cancels descendants and returns `BUDGET_EXCEEDED`; it must
not silently drop or continue work.

MCP annotations are useful risk hints, but enforcement remains a deterministic
runtime responsibility. See the official
[MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

### P0.7 — Establish the agent evaluation fitness function

Start a small baseline immediately and run it continuously as the earlier P0
work lands. Do not delay obvious safety fixes while waiting for measurements.

Measure coding agents on:

- task success and acceptance-test pass rate;
- invalid tool calls and compile-repair iterations;
- files and source lines read;
- turns, tokens, tool calls, and wall time;
- recovery after edit/reload;
- ability to locate the exact handler or graph edge.

Measure runtime agents on:

- false-success rate;
- duplicate mutation after timeout/retry;
- unauthorized-action rate;
- stale-write conflict detection;
- recovery after disconnect or runtime restart;
- budget and cancellation enforcement;
- replay divergence and audit completeness;
- prompt-injection resistance under constrained capabilities.

Use these results to order P1 tools. Do not optimize only for fewer tokens if
correctness or safety regresses.

### P1.1 — Provide structured, bounded machine interfaces

MCP responses should use `outputSchema` and `structuredContent`, with the JSON
text copy retained only for compatibility. Every result and error should be a
stable discriminated shape.

Enforce agent-context budgets independently of transport limits:

- shape/key/type/count summaries by default;
- semantic registered queries as the normal read interface;
- raw state reads as a separately permissioned diagnostic escape hatch;
- path, projection, depth, `maxBytes`, and `maxItems` controls;
- explicit `{ truncated, digest, continuation }` metadata;
- cursors with epoch-reset responses;
- redacted-path and freshness metadata;
- runtime, workspace, session, contract, state, and publication revisions in
successful responses.

### P1.2 — Add a compact discovery and execution protocol

Prefer a small stable tool surface over one MCP tool per application event or a
large collection of overlapping diagnostic tools.

Recommended semantic operations:

- `searchContracts` — compact discovery by text, kind, capability, written
state path, or emitted effect;
- `getContract` — full schema and metadata for one selected definition;
- `executeCommand` — validated, authorized mutation;
- `getOperation` — recover or inspect a pending/completed operation;
- `query` — evaluate a registered query at a stated consistency/revision;
- `waitFor` — wait on the subscription DAG using a safe declarative condition;
- `explainOperation` — return one bounded causal chain;
- `findStateChanges` — answer which operations changed a path.

The static manifest can also be exposed as an MCP resource. Search responses
should remain compact; agents should fetch a full schema only for the selected
command or query.

### P1.3 — Capture exact causality and complete diagnostics

Carry operation/causation IDs through:

```text
command -> event -> state commit -> effects/tasks -> child events
        -> publication -> selectors -> render
```

Then add:

- exact `explainOperation`, rather than timestamp-window reconstruction;
- `findStateChanges(path)` indexed from patches;
- `get_client_logs(cursor)` for render crashes, warnings, uncaught exceptions,
and unhandled rejections outside the event pipeline;
- contract/handler revision change notifications for HMR and lazy modules;
- workspace/project identity so two repositories or worktrees cannot collide
merely because they chose the same runtime ID and port.

### P1.4 — Add safe preview, approvals, fixtures, and replay

Pure handlers plus effects-as-data make command preview a distinct Reflex
advantage:

```ts
const preview = await previewCommand({
  command: 'billing/refund',
  input: { paymentId: 'p7', amount: 100 },
  expectedRevision: 41,
})

await commitPreview({ planToken: preview.planToken })
```

Preview returns proposed patches, effects, affected resources, risk, captured
coeffects, and required approval. Its plan token is bound to the command,
contract hash, state revision, inputs, and policy decision. A state or contract
change invalidates the plan.

For coding-agent iteration, add named scenarios based on the design in
[headless-state-fixtures.md](headless-state-fixtures.md):

```text
restore or replay setup
execute command
settle causal work and publication
evaluate queries
assert patches, effects, results, logs, and values
```

Replay modes must be explicit:

- **pure replay:** rerun handlers with recorded coeffects, suppress I/O, and
compare patch/effect hashes;
- **state replay:** apply patches for debugging;
- **live retry:** execute effects only with fresh authorization and idempotency.

A generic replay operation must never resend email, payments, notifications, or
network writes by default.

### P1.5 — Provide durable causal audit where runtime agents require it

Development ring buffers are useful but insufficient for production agents.
Allow an append-only external audit sink with:

- principal, command, input fingerprint, policy decision, and approval;
- contract/handler hashes and state revisions;
- coeffects, patches, results, effects, tasks, and final status;
- explicit retention gaps and cursor semantics;
- configurable redaction before persistence;
- optional tamper-evident chaining when the deployment requires it.

---

## 4. AI-native priority list

This list contains requirements that are specifically elevated because agents
are primary actors.


| AI-native requirement                                | Priority                                                 | Implementation complexity | Change complexity | Breaking?       | Why it is elevated                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------- | ------------------------- | ----------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Owned immutable state and diagnostic boundaries`    | **P0**                                                   | **M**                     | **High**          | **Yes**         | External mutation and live registry access invalidate automated evidence; callers relying on those references must migrate. |
| Canonical simple subscription parameter contract     | **P0**                                                   | **M**                     | **Medium**        | **Conditional** | Make the common case explicit: no parameters or a small bounded tuple of scalar values. Unsupported complex values can be rejected with a staged migration. |
| Strict effect/coeffect failure semantics             | **P0**                                                   | **M**                     | **High**          | **Yes**         | Work that previously warned and continued will fail explicitly.                                                             |
| FIFO ordering and operation-scoped failure isolation | **P0**                                                   | **L**                     | **High**          | **Yes**         | Accepted event order and queue-purge behavior are observable runtime contracts.                                             |
| Executable command/query schemas                     | **P0**                                                   | **XL**                    | **High**          | **Conditional** | Descriptors are additive; requiring them and replacing positional public payloads is breaking.                              |
| Core operation IDs and structured receipts           | **P0**                                                   | **XL**                    | **Very high**     | **Conditional** | A new operation API is additive; replacing trace-derived dispatch outcomes changes the protocol.                            |
| Idempotency keys and operation lookup                | **P0**                                                   | **L**                     | **High**          | **Conditional** | Optional keys are additive; requiring them for mutation rejects previously valid calls.                                     |
| Committed/published revisions and preconditions      | **P0**                                                   | **L**                     | **High**          | **Conditional** | Returning revisions is additive; making revision preconditions mandatory is breaking.                                       |
| Supervised causal tasks                              | **P0**                                                   | **XL**                    | **Very high**     | **Conditional** | A task layer is additive; redefining effect completion and settlement changes existing semantics.                           |
| Per-command capabilities and approvals               | **P0**                                                   | **XL**                    | **Very high**     | **Yes**         | Private-by-default commands and narrower grants intentionally reject calls allowed by blanket dispatch.                     |
| Resource budgets and backpressure                    | **P0**                                                   | **L**                     | **High**          | **Conditional** | Opt-in budgets are additive; enforced defaults can reject or cancel previously unbounded work.                              |
| Continuous agent evaluation                          | **P0**                                                   | **L**                     | **Low**           | **No**          | It is the fitness function for choosing later tools and APIs.                                                               |
| Structured, schema-declared MCP results              | **P1**                                                   | **M**                     | **Medium**        | **No**          | `structuredContent` and output schemas can ship while retaining text compatibility.                                         |
| Bounded semantic reads and `waitFor`                 | **P1**                                                   | **L**                     | **Medium**        | **Conditional** | New semantic reads are additive; imposing smaller limits on existing broad reads changes behavior.                          |
| Exact causal explanation                             | **P1**                                                   | **L**                     | **High**          | **No**          | New causal metadata and explanation tools can be additive.                                                                  |
| Safe preview and approval tokens                     | **P1**                                                   | **XL**                    | **High**          | **No**          | Preview is a new execution mode unless later made mandatory for selected risks.                                             |
| Deterministic replay with captured coeffects         | **P1**                                                   | **XL**                    | **Very high**     | **No**          | Explicit replay modes add capability without changing ordinary execution.                                                   |
| Durable audit export                                 | **P1** for runtime agents, **P2** for coding-only agents | **L**                     | **Medium**        | **No**          | An external audit sink can be added behind configuration.                                                                   |
| Generic multi-command transactions                   | **P3**                                                   | **XL**                    | **Very high**     | **No**          | A separate transaction API is additive, though its semantics are difficult.                                                 |


---

## 5. Human-facing list, re-prioritized for agents

These items originated as human developer, React ecosystem, or API ergonomics
concerns. They remain in scope, but their priority is determined by how much
they improve agent-generated and agent-maintained applications.


| Human-facing improvement                                   | Agent-first priority                                   | Implementation complexity  | Change complexity                          | Breaking?                       | Decision and agent value                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------ | -------------------------- | ------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed event/selector creators                              | **P0**, absorbed into executable descriptors           | **XL**                     | **High**                                   | **Conditional**                 | Creators are additive; requiring them or removing contract maps/raw vectors is breaking.                                                                |
| Runtime development invariants                             | **P0**                                                 | **M**                      | **Medium**                                 | **Yes**                         | Mutation, malformed payload, missing registration, and invalid effect checks turn agent mistakes into immediate failures instead of tolerated behavior. |
| One canonical explicit-runtime API                         | **P1**                                                 | **L**                      | **High**                                   | **Conditional**                 | The modern API is additive; moving the default facade to `/legacy` or removing it is breaking.                                                          |
| `state` -> `state` at public boundaries                    | **P1**                                                 | **M**                      | **High**                                   | **Conditional**                 | Common model vocabulary reduces token/context friction; aliases allow a staged migration.                                                               |
| `draftState` -> `draft`                                       | **P1**                                                 | **M**                      | **High**                                   | **Conditional**                 | Both properties can coexist temporarily, but removing `draftState` breaks handlers.                                                                        |
| Full names such as `registerEvent`                         | **P2**                                                 | **S**                      | **Low**                                    | **No**                          | Additive aliases are easy; agent docs should still present only one canonical style.                                                                    |
| Split overloaded `regSub` into source/selector definitions | **P1**                                                 | **L**                      | **High**                                   | **Conditional**                 | New definitions are additive; removing overloaded forms is breaking.                                                                                    |
| `useSubscription` -> `useSelector`                         | **P2**                                                 | **M**                      | **Medium**                                 | **Conditional**                 | Add the new hook first; removing the old hook requires migration.                                                                                       |
| Current async `dispatch` -> explicit `enqueue`             | **P1**                                                 | **M**                      | **High**                                   | **Conditional**                 | Adding `enqueue` is safe; renaming/removing `dispatch` or changing its timing is breaking.                                                              |
| `dispatchSync` -> `dispatchNow`                            | **P2**                                                 | **S**                      | **Medium**                                 | **Conditional**                 | The alias is additive; removing the old name is breaking.                                                                                               |
| Required Provider in the modern React entrypoint           | **P1**                                                 | **S**                      | **High**                                   | **Yes**                         | Applications that currently rely on silent default-runtime fallback will throw.                                                                         |
| Typed context/hook factory                                 | **P2**                                                 | **M**                      | **Low**                                    | **No**                          | Improves generated React code through an additive API.                                                                                                  |
| Stable hydration/server snapshot                           | **P1**                                                 | **L**                      | **Medium**                                 | **No**                          | A new snapshot contract and Provider option can be additive.                                                                                            |
| Equality-policy cleanup and benchmarks                     | **P1** benchmark, **P2** API change                    | **M** benchmark, **L** API | **Low** benchmark, **High** default change | **Benchmark: No; default: Yes** | Measurement is safe; changing the equality default alters observable recomputation and identity behavior.                                               |
| Static manifest and source locations                       | **P0** contract manifest, **P1** enriched source index | **L**                      | **Medium**                                 | **No**                          | Generated metadata is additive and much more valuable to coding agents than ordinary API prose.                                                         |
| Concise `llms.txt`, templates, and scaffolder              | **P1**                                                 | **L**                      | **Low**                                    | **No**                          | New-project defaults and documentation can change without breaking existing runtime code.                                                               |
| Redux/Zustand migration documentation                      | **P3**                                                 | **M**                      | **Low**                                    | **No**                          | Valuable for human adoption, but it does not improve execution correctness.                                                                             |
| Redux DevTools bridge                                      | **P3**                                                 | **L**                      | **Low**                                    | **No**                          | Familiar human tooling; Reflex's structured receipts and causal agent tools come first.                                                                 |
| Entity/normalization helpers                               | **P3**                                                 | **M**                      | **Low**                                    | **No**                          | Add only when applications or benchmarks demonstrate recurring agent difficulty.                                                                        |
| RTK Query equivalent                                       | **Non-goal**                                           | **—**                      | **—**                                      | **—**                           | Keep the TanStack Query integration boundary and focus on deterministic workflows.                                                                      |
| Zustand-level bundle minimization                          | **Non-goal**                                           | **—**                      | **—**                                      | **—**                           | Agent correctness, observability, and verifiability are the product differentiation.                                                                    |
| Generic time travel/undo-redo                              | **P3**                                                 | **XL**                     | **Very high**                              | **No**                          | A separate history API is additive, but its semantics are difficult and should follow safe replay.                                                      |


### Canonical public vocabulary

Use common terms at machine and modern application boundaries:


| Legacy/current          | Canonical modern or agent-facing term                 | Implementation complexity | Change complexity | Breaking?       |
| ----------------------- | ----------------------------------------------------- | ------------------------- | ----------------- | --------------- |
| `AppState`, `state`        | `AppState`, `state`                                   | **M**                     | **High**          | **Conditional** |
| `initialState`             | `initialState`                                        | **S**                     | **Medium**        | **Conditional** |
| `getState()`            | `getState()`                                          | **S**                     | **Medium**        | **Conditional** |
| `restoreState()`        | `replaceState()` or fixture-specific `restoreState()` | **M**                     | **High**          | **Conditional** |
| `draftState`               | `draft`                                               | **M**                     | **High**          | **Conditional** |
| `regEvent`              | `registerEvent` or descriptor-level `defineEvent`     | **S**                     | **Low**           | **Conditional** |
| `regEffect`             | `registerEffect` or `defineEffect`                    | **S**                     | **Low**           | **Conditional** |
| `regSub`                | `defineSource` / `defineSelector`                     | **L**                     | **High**          | **Conditional** |
| `useSubscription`       | `useSelector`                                         | **M**                     | **Medium**        | **Conditional** |
| queued `dispatch`       | `enqueue`                                             | **M**                     | **High**          | **Conditional** |
| `dispatchSync`          | `dispatchNow`                                         | **S**                     | **Medium**        | **Conditional** |
| external mutation       | `executeCommand`                                      | **XL**                    | **Very high**     | **No**          |
| subscription evaluation | `query`                                               | **M**                     | **Medium**        | **No**          |


Do not publish all of these as simultaneous aliases in the primary agent
context. Pick one canonical modern form; preserve old names only in a clearly
separated compatibility entrypoint and migration guide.

### Breakage-aware sequencing

#### Decide and land before 1.0

These changes intentionally alter existing behavior and become much more
painful after the stability boundary:

- owned/immutable state and diagnostic boundaries;
- canonical subscription parameter validation and identity;
- strict effect/coeffect and development-invariant failures;
- FIFO ordering and operation-scoped failure isolation;
- private-by-default externally callable commands and semantic authorization;
- a required Provider in the modern React entrypoint;
- any equality-default change, if benchmarks justify one.

#### Introduce now, remove only in a later major version

These can start as additive replacements. Templates, examples, generated
contracts, and `llms.txt` should move immediately so new agent-written code does
not accumulate on the legacy surface:

- command/query/effect descriptors and object payloads;
- operation receipts, revisions, idempotency keys, and supervised tasks;
- `state` / `draft` vocabulary;
- explicit-runtime-only modern entrypoint;
- source/selector definitions replacing overloaded `regSub`;
- `useSelector`, `enqueue`, and `dispatchNow` names;
- enforced budgets after an opt-in measurement period.

The compatibility surface can remain in `/legacy` through 1.x. Removing it,
making descriptors mandatory, or requiring new command envelope fields should
be planned as a separate major-version decision.

#### Safe to postpone without creating migration debt

These are additive when built as described and can follow evidence or
dependencies:

- agent evaluation infrastructure;
- MCP `structuredContent`, output schemas, and compact search;
- operation lookup, semantic query, and `waitFor`;
- exact causal explanation, path history, and client logs;
- command preview, fixtures, explicit replay modes, and audit export;
- typed React context factories and hydration snapshot support;
- static manifest enrichment, migration documentation, DevTools bridges, and
entity helpers.

---

## 6. Recommended milestones

### Milestone A — Trust baseline

- Add regression tests for mutable state ingress, query-key collisions, mutable
queued events, sync-over-queued ordering, required coeffect/effect failures,
async rejections, failed-batch publication, and unrelated command purging.
- Fix those core mechanics and expose immutable diagnostics.
- Establish the first coding-agent and runtime-agent evaluation scenarios.

### Milestone B — Executable contracts

- Ship `defineCommand`, `defineQuery`, and `defineEffect` descriptors.
- Use named object inputs and declared results.
- Add runtime validation, versions, hashes, source metadata, and the generated
contract manifest.
- Make agent exposure private by default.
- Land any breaking `state` vocabulary changes during this milestone, before
contracts and generated templates stabilize.

### Milestone C — Operation protocol

- Add operation envelopes, committed/published revisions, structured receipts,
stable error codes, and exact causal IDs.
- Add idempotency, optimistic preconditions, operation lookup, and isolated
queue failure handling.
- Move DevTools dispatch outcome production onto the core receipt rather than
later trace inference.

### Milestone D — Tasks and policy

- Add supervised causal tasks and command-scoped settlement.
- Add per-principal/per-command authorization, effect enforcement, resource
budgets, and approval policy.
- Make safe headless effect modes enforceable rather than informational.

### Milestone E — Agent loop acceleration

- Return structured and bounded MCP responses.
- Expose contract search/describe, semantic query, operation status, `waitFor`,
exact explanation, path history, and client logs.
- Add schema-versioned fixtures, safe preview, and replay modes.
- Add workspace/build identity and registry-change notifications for parallel
worktrees and HMR.

### Milestone F — Human and React productization

- Finalize the canonical React vocabulary and typed hook/context factory.
- Require the modern Provider and provide a stable hydration snapshot.
- Complete templates, `llms.txt`, compatibility migration, release integrity,
performance budgets, and ecosystem documentation.
- Add P3 parity items only when evaluations or real adoption justify them.

---

## 7. Release gates for an agent-first claim

Reflex should not claim production-grade agent execution until all of these are
true:

- invalid external inputs cannot reach a handler;
- internal events cannot be invoked through the command plane;
- every accepted command has a stable operation ID;
- retrying the same idempotent command cannot duplicate state or supported
external effects;
- stale commands fail with a structured conflict;
- async child work is supervised, cancellable, bounded, and causally linked;
- a successful result cannot hide missing or failed required effects;
- authorization is enforced per principal and semantic command;
- every successful read identifies its runtime, contract, state, and
publication revision;
- tool results are bounded and explicitly report truncation or redaction;
- replay never performs external I/O without a separately authorized live mode;
- automated evaluations cover disconnects, reloads, concurrent actors,
dangerous effects, large state, and adversarial inputs.

---

## 8. Explicit deprioritization

For an agent-first product, do not spend the next major cycle on:

- matching Redux or Zustand feature-for-feature;
- adding many API aliases for human taste;
- creating more MCP tools without evaluation evidence;
- generic state mutation as a production agent API;
- broad remote dispatch authority;
- an RTK Query clone;
- tiny-bundle competition;
- generic multi-command transactions before one-command semantics are sound;
- time travel or replay that can accidentally repeat real effects.

The durable differentiation is not that an agent can write Reflex syntax more
quickly. It is that Reflex can eliminate the ambiguity that makes autonomous
agents unsafe and difficult to verify.
