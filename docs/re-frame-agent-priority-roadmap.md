# Re-frame Feature Priorities for Reflex

> **Status:** Historical planning notes. The active roadmap is [`ROADMAP.md`](../ROADMAP.md); operation design is superseded by [`agent-operation-rfc.md`](agent-operation-rfc.md).

Initial priority list for bringing the most valuable recent re-frame capabilities to Reflex, evaluated from an AI-agent development perspective.

The priority is not to reproduce every re-frame API. Reflex already has its own strengths—explicit runtime instances, TypeScript contracts, Immer patches, React integration, persistence, and DevTools/MCP integration. The goal is to add the capabilities that make agent-driven development observable, deterministic, safe, and easy to verify.

## Priority summary

| Priority | Capability                                    | Main outcome                                                     |
| -------- | --------------------------------------------- | ---------------------------------------------------------------- |
| P0       | `dispatchAndSettle()` and structured receipts | One authoritative result for an event and its cascade            |
| P0       | Operation protocol and completion semantics   | Make headless dispatch awaitable, attributable, and retry-safe   |
| P0       | Dispatch-scoped effect overrides/stubs        | Safe dry-runs and deterministic tests                            |
| P0       | Source provenance metadata                    | Explain where events, subscriptions, and handlers came from      |
| P0       | Causal event epochs                           | Reconstruct exact parent/child event causality                   |
| P0       | Stable trace schema and validation            | Make tooling depend on an explicit runtime contract              |
| P1       | Agent-oriented tooling API                    | Discover capabilities and diagnostics through one stable surface |
| P1       | Replayable fixtures and scenarios             | Reproduce bugs quickly after reloads and edits                   |
| P1       | Scoped agent authorization                    | Limit which events and effects an agent may use                  |
| P1       | Structured, machine-readable errors           | Let agents select corrective actions reliably                    |
| P2       | Subscription lifecycle controls               | Control cache lifetime and memory behavior explicitly            |
| P2       | Public live-subscription accessors            | Diagnose cache growth and invalidation                           |
| P2       | Runtime capability/version discovery          | Let agents adapt to the connected runtime                        |
| P2       | Duplicate-registration diagnostics            | Identify accidental overwrites with source context               |
| P3       | Flows / `regFlow()`                           | Support persistent derived state and dataflow invariants         |
| P3       | Flow lifecycle and cleanup                    | Support live/dead derived state with explicit cleanup            |
| P3       | Generic time travel / undo-redo               | Add only after replay and effect control are mature              |

## P0 — foundational agent capabilities

### 1. `dispatchAndSettle()` with structured receipts

Add a runtime API that dispatches one root event, waits for the event and its synchronous dispatch cascade to settle, and returns a structured receipt.

```ts
const result = await runtime.dispatchAndSettle(['cart/checkout']);
```

Suggested result shape:

```ts
{
  ok: true,
  operationId: 'operation-42',
  rootEvent: ['cart/checkout'],
  cascadedEvents: [
    ['checkout/success', { orderId: 'order-7' }]
  ],
  patches: [],
  effects: [],
  errors: []
}
```

The receipt should distinguish at least:

- state transition failure;
- handler failure;
- effect failure;
- timeout;
- unknown or interrupted session.

Reflex currently has `flush()`, which waits for runtime idleness, and DevTools can infer outcomes from traces. A first-class receipt should become the authoritative result instead of requiring downstream tools to reconstruct causality from trace timing.

### 2. Operation protocol and completion semantics

Headless dispatch needs a protocol-level operation identity that is independent of event IDs and trace IDs. Event IDs are not unique: the same event may be dispatched concurrently, repeatedly, or by unrelated parts of the application.

The runtime should distinguish these identities:

```text
requestId    — transport or MCP request
operationId  — one agent operation and its related cascade
dispatchId   — one concrete event dispatch
traceId      — one instrumentation record
```

The operation identity must be generated before the event is enqueued and propagated through the runtime:

```ts
{
  operationId: 'operation-42',
  dispatchId: 'dispatch-101',
  parentDispatchId: undefined,
  event: ['user/load']
}
```

Trace data may reference this identity, but trace observation must not be the completion mechanism. The runtime should emit an explicit operation result even when tracing is disabled.

The protocol should expose distinct lifecycle states:

```text
accepted
started
committed
effects-running
settled
failed
timed-out
disconnected
unknown
```

`settled` must have an explicit completion boundary. The initial boundary should mean:

```text
event handler completed
+ state commit completed
+ synchronous child-event cascade completed
+ subscriptions flushed
```

It should not implicitly mean that arbitrary HTTP requests, timers, WebSocket messages, or other external asynchronous work has completed. The protocol may later support explicit modes such as:

```ts
completion: 'event-cascade' | 'required-effects' | 'full-operation';
```

### 3. Full causal cascade receipt

The operation result should include the root dispatch and all synchronous child dispatches, rather than only the root event trace.

```json
{
  "operationId": "operation-42",
  "root": {
    "dispatchId": "dispatch-101",
    "event": ["user/load"],
    "status": "committed",
    "patches": []
  },
  "children": [
    {
      "dispatchId": "dispatch-102",
      "parentDispatchId": "dispatch-101",
      "event": ["user/loaded"],
      "status": "committed",
      "patches": []
    }
  ],
  "allPatches": [],
  "allEffects": [],
  "errors": []
}
```

This lets an agent identify which child event failed and whether the root state commit succeeded before the failure.

### 4. Operation status lookup and retry safety

An `unknown` result must not be treated as a failed operation. It may mean that the event executed successfully but the connection was lost before the receipt arrived.

Provide a status lookup:

```ts
runtime.getOperationStatus(operationId);
```

The response should include whether retrying is safe:

```json
{
  "operationId": "operation-42",
  "status": "committed",
  "outcome": "succeeded",
  "retrySafe": false
}
```

Agent-facing dispatch should support an optional idempotency key for operations that may be retried safely:

```ts
runtime.dispatchAndSettle(['payment/confirm'], {
  idempotencyKey: 'payment-confirm-order-7',
});
```

The agent must check the previous operation status before retrying after a timeout or session disconnect.

### 5. Separate state and effect outcomes

The operation receipt must distinguish a successful state commit from effect execution failure:

```json
{
  "outcome": "effects-failed",
  "state": {
    "status": "committed",
    "patches": []
  },
  "effects": {
    "status": "partially-failed",
    "emitted": [],
    "completed": [],
    "failed": []
  }
}
```

This prevents an agent from incorrectly rewriting a pure event handler when the actual failure is in an effect adapter.

### 6. Headless effect execution status

Every emitted effect should report how it was handled in the headless runtime:

```text
executed
stubbed
fixture-backed
observed-only
suppressed
failed
not-reached
```

The result should identify the effect mode as well as the effect ID:

```json
{
  "effectId": "http-request",
  "mode": "fixture-backed",
  "status": "completed"
}
```

This tells the agent whether it verified a real side effect, a safe fixture, or only the fact that an effect was emitted.

### 7. Optional semantic observations

Patches describe the technical state diff, but agents often need to know what the application now observes. Dispatch should optionally accept bounded observations:

```ts
await runtime.dispatchAndSettle(['expense/add', expense], {
  observe: [['expenses/count'], ['expenses/total']],
});
```

The receipt should return the selected subscription values without requiring a second uncorrelated request:

```json
{
  "observations": [
    { "query": ["expenses/count"], "value": 4 },
    { "query": ["expenses/total"], "value": 125.5 }
  ]
}
```

Observation size and value redaction must be bounded by policy.

### 8. Dispatch-scoped effect overrides and stubs

Allow selected effect handlers to be temporarily replaced for one dispatch and its synchronous cascade.

```ts
await runtime.dispatchAndSettle(['user/load'], {
  overrides: {
    'http-request': (request) => {
      runtime.dispatch(['user/loaded', { id: 1, name: 'Test' }]);
    },
  },
});
```

Requirements:

- overrides must not mutate global handler registration;
- nested and concurrent dispatches must not interfere;
- overrides should propagate to synchronous child dispatches;
- real I/O should remain disabled when a stub is installed;
- the receipt should record both the declared effect and its execution outcome.

This enables deterministic tests, safe agent dry-runs, and previews of state changes without sending requests, making payments, navigating, or writing to external systems.

### 9. Source provenance metadata

Capture optional source information for:

- event registration;
- subscription registration;
- effect and coeffect registration;
- event dispatch;
- subscription requests.

Example:

```ts
{
  source: {
    file: 'src/user/events.ts',
    line: 42,
    column: 3
  }
}
```

This should answer:

- Why did this event fire?
- Where was this handler registered?
- Which component requested this subscription?
- Which registration replaced the previous one?

The metadata should be development-only or removable by the bundler in production. It should not require stack-trace parsing.

### 10. Causal event epochs

Every event operation should have explicit causal identity:

```ts
{
  dispatchId: 'dispatch-42',
  parentDispatchId: 'dispatch-41',
  operationId: 'operation-7'
}
```

The runtime should expose an assembled event record containing the dispatch, handler execution, effects, subscription work, and child dispatches. Parent-child relationships must be explicit rather than inferred from matching event names or timestamps.

This is required for reliable answers to questions such as:

- Which event caused this state patch?
- Did this effect come from the user action or from a child event?
- Which branch of the cascade failed?

### 11. Stable trace schema and validation

Define a versioned trace contract with documented required and optional fields for each operation type.

Suggested API:

```ts
runtime.getTraceSchema();
runtime.setTraceValidation(true);
```

Validation should run in development and CI, warning about missing required tags, unknown tags, and incompatible schema changes. Trace consumers should not need to inspect private runtime structures.

The schema should cover at least:

- event dispatch;
- event handler execution;
- state commit;
- effect execution;
- subscription creation, computation, and disposal;
- render notifications;
- errors;
- dispatch and operation correlation.

## P1 — high-value agent workflows

### 6. Agent-oriented tooling API

Expose a single stable tooling surface for runtime discovery and diagnostics:

```ts
runtime.tooling.listHandlers();
runtime.tooling.listSubscriptions();
runtime.tooling.getTraceSchema();
runtime.tooling.getLiveSubscriptions();
runtime.tooling.getRegistrationSource('user/load');
runtime.tooling.getCapabilities();
```

The current inspector and DevTools already provide much of this functionality. The priority is to formalize the contract and make it stable for MCP clients and other tooling consumers.

### 7. Replayable fixtures and scenarios

Provide a way to restore a known state and replay a sequence of events:

```ts
await runtime.replay({
  initialState,
  events: [['user/load'], ['user/loaded', user]],
  suppressEffects: true,
});
```

Useful capabilities:

- named fixtures;
- state snapshots;
- state-version metadata;
- replay with captured coeffects;
- effect suppression or replacement;
- assertions over patches, effects, subscriptions, and traces.

This removes the setup tax after every agent edit or headless runtime restart.

### 8. Scoped authorization for agent dispatch

Replace a single broad dispatch grant with narrower capability policies.

Possible policy dimensions:

- allowed runtime;
- allowed event IDs or patterns;
- allowed effect domains;
- maximum event count;
- maximum payload and result size;
- approval requirement for irreversible effects;
- per-session or per-principal quotas.

Example:

```ts
{
  events: ['todos/*'],
  effects: ['storage/*'],
  deniedEffects: ['http/*', 'payments/*'],
  maxEvents: 20
}
```

### 9. Structured machine-readable errors

Errors should include stable codes and execution context instead of relying only on formatted messages.

```ts
{
  code: 'MISSING_EFFECT',
  phase: 'effect',
  event: ['cart/checkout'],
  effectId: 'http-request',
  required: true,
  recoverable: false
}
```

The same error contract should be used by the runtime, DevTools, MCP, tests, and replay tools.

## P2 — runtime and subscription diagnostics

### 10. Explicit subscription lifecycles

Add opt-in lifecycle controls inspired by re-frame's `:forever` and `:no-cache` modes:

```ts
runtime.regSub('expensive-report', compute, dependencies, {
  lifecycle: 'forever',
});

runtime.regSub('temporary-query', compute, dependencies, {
  lifecycle: 'no-cache',
});
```

The semantics must be explicit:

- whether the subscription remains active without consumers;
- whether the computed value is retained after disposal;
- whether dependencies remain live;
- whether cleanup is available.

### 11. Public live-subscription accessors

Expose stable tooling accessors:

```ts
runtime.listLiveSubscriptions();
runtime.getSubscriptionDiagnostics();
runtime.getSubscriptionQuery(subscriptionHandle);
```

These should support diagnosing stale values, cache growth, unexpected recomputation, and subscriptions that remain live after a component unmounts.

### 12. Runtime capability and version discovery

Expose runtime and protocol capabilities without requiring package inspection:

```ts
runtime.getCapabilities();
```

Example:

```ts
{
  reflexVersion: '0.1.27',
  traceSchemaVersion: 2,
  supportsSettle: true,
  supportsEffectOverrides: false,
  supportsReplay: true
}
```

Agents should discover the connected runtime's capabilities before choosing a workflow.

### 13. Duplicate-registration diagnostics

Duplicate event, subscription, effect, and coeffect registrations should report structured warnings with both the previous and replacement source locations.

```ts
{
  code: 'DUPLICATE_HANDLER',
  kind: 'event',
  id: 'user/load',
  previousSource: {...},
  replacementSource: {...}
}
```

Hot reload may need a separate, explicitly identified policy so legitimate reloads do not hide production mistakes.

## P3 — experimental dataflow features

### 14. Flows / `regFlow()`

Flows maintain derived values inside `state`, unlike subscriptions whose values remain in the subscription graph.

```ts
runtime.regFlow({
  id: 'cart/total',
  inputs: {
    subtotal: ['cart/subtotal'],
    tax: ['cart/tax'],
  },
  compute: ({ subtotal, tax }) => subtotal + tax,
  path: ['cart', 'total'],
});
```

Potential uses:

- cascading validation;
- persistent derived state;
- cross-feature invariants;
- multi-stage dataflow;
- derived values shared by events, persistence, DevTools, and subscriptions.

This should remain below the observability and replay work because Flows introduce implicit state writes and can make causality harder to understand.

### 15. Flow lifecycle and cleanup

If Flows are implemented, support:

- live/dead transitions;
- `cleanup` behavior;
- flow registration and deregistration;
- flow-to-flow dependencies;
- cycle detection;
- trace records for each flow computation and cleanup.

The trace must make Flow-induced state patches distinguishable from patches produced directly by an event handler.

### 16. Generic time travel and undo/redo

Do not prioritize generic undo/redo before replay, coeffect capture, and effect suppression are available. Replaying a state transition is more useful to agents than blindly reversing patches, especially when external effects are involved.

## Recommended implementation sequence

```text
1. operation identity and completion protocol
2. structured receipts and dispatch-and-settle
3. full causal cascade results
4. operation status lookup and retry safety
5. state/effect outcome separation
6. headless effect modes and scoped overrides
7. source provenance
8. causal epochs and trace schema
9. tooling API stabilization
10. replay fixtures and scenarios
11. scoped authorization and structured errors
12. subscription lifecycle/accessor APIs
13. Flows
```

## Success criteria

An agent should be able to perform this loop without reading the entire application or guessing from timing:

```text
discover runtime
  → inspect handlers and subscriptions
  → dispatch one operation
  → wait for the operation to settle
  → inspect receipt, patches, effects, and causal children
  → replay the same scenario after an edit
  → verify the changed behavior
```

The central design principle is: make every important state transition observable, attributable, reproducible, and safe to execute.
