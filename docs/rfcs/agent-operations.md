# RFC: Authoritative operations for agent-driven Uklad runtimes

- **Status:** Proposed design; the current implementation is the smaller
  coordinator snapshot described below
- **Last updated:** 2026-07-23
- **Scope:** Uklad core, Inspector, DevTools server/SDK, MCP, headless adapters,
  and the future production command plane
- **Decision owner:** Uklad maintainers
- **Compatibility:** additive API first; intentional queue-correctness changes must
  land before 1.0 with migration notes

> **Implementation note (2026-07-23):** The implemented operation surface is
> a DevTools-owned snapshot populated through a narrow optional runtime
> execution observer: identity, status, event lineage, committed/published
> revisions, pending work, and errors. Core has no operation retention when
> DevTools operations are disabled. Rich
> receipt features discussed in this RFC—patches, effect return detail,
> observations, idempotency, command policy, and delivery semantics—remain
> proposals to design into a future canonical model, not current API claims.

## Summary

Uklad should treat an agent invocation as a first-class **operation**, not as
an event name followed by a search through traces.

An operation is created before its root event is enqueued. It has a stable
`operationId`, a bounded queryable ledger record, and one unique
`eventInstanceId` for every root or child event occurrence. The runtime—not
DevTools, MCP, or tracing—owns the operation lifecycle and its result.

The first completion target is **`cascade-published`**:

1. the root event and every joined synchronous child event have finished;
2. each reached event has either committed its state or recorded why it did
   not;
3. synchronous effect handlers have reached a known local disposition;
4. the latest committed state has been published to subscriptions; and
5. requested bounded subscription observations have been evaluated.

This boundary deliberately excludes timers, `dispatch-later`, network
callbacks, promise-returning legacy effect handlers, and other detached work.
Those are reported as detached or incomplete rather than being silently
treated as successful. A later supervised-task layer will support a stronger
`required-work` completion target.

Tracing remains valuable diagnostic evidence. It references operation and
event-instance IDs, but it is optional, sampled/buffered, and never controls
completion. A timeout or disconnect describes what the caller knows; it does
not mutate the operation into a failure. The caller receives or reuses an
operation/idempotency handle and recovers the authoritative record with
`getOperation`.

The development control plane may continue to invoke raw event vectors. The
future production agent plane must expose validated, versioned, authorized
**commands** that compile to the same operation machinery. Merely registering
an internal event must never make it remotely callable in production.

## Why this RFC exists

The current `dispatch_event` path is a useful prototype:

- the DevTools server creates a request correlation ID;
- the SDK dispatches an event vector;
- the SDK waits for a matching root event trace;
- the server derives `succeeded`, `failed`, or `effects-failed` from trace
  tags; and
- MCP returns patches and declared effects.

It cannot be the durable contract:

- event IDs are handler names, not invocation identities;
- completion depends on tracing being enabled and delivered;
- only the root trace is returned, not its causal cascade;
- trace patches describe a candidate handler transition and are not themselves
  proof that the commit interceptor ran;
- state commit, subscription publication, and external effect completion are
  different boundaries;
- effect handlers return `void`, so promises, callbacks, and timers are not
  supervised;
- timeout/disconnect deletes transport correlation state and leaves no status
  lookup;
- retrying with a new request can duplicate non-idempotent work; and
- headless effect labels are informational rather than enforced execution
  evidence.

The platform needs an operation protocol that remains correct when tracing is
off, the same event ID is invoked many times, multiple agents share a runtime,
effects fail after state commits, or the result connection disappears.

## Goals

1. Give every accepted invocation and concrete event occurrence an exact,
   stable identity.
2. Return an authoritative, versioned, structured result without depending on
   traces or time-window inference.
3. Account for the complete joined event cascade with explicit parent and
   causation links.
4. Separate handler, state commit, publication, effect, observation, and
   delivery outcomes.
5. Make an unknown caller outcome recoverable without unsafe blind retry.
6. Expose the headless execution profile and the actual disposition of every
   effect.
7. Support semantic post-operation observations in addition to technical
   patches.
8. Remain bounded, redacted, inspectable, and useful under concurrent
   operations.
9. Provide a substrate for validated commands, supervised tasks, fixtures,
   replay, approvals, and durable audit.
10. Preserve ordinary `dispatch`, `dispatchSync`, and `flush` while the new API
    is adopted.

## Non-goals

- Exactly-once external I/O from an in-memory JavaScript runtime.
- Treating global queue idleness as completion of all asynchronous work.
- Turning every registered event into a production agent command.
- Sending function-valued effect overrides across MCP or another trust
  boundary.
- Generic distributed transactions, automatic rollback, or undo/redo.
- Replaying real payments, email, analytics, network writes, or notifications
  by default.
- Replacing browser automation for genuinely visual and DOM-wiring checks.
- Making traces, logs, or patches durable audit records by themselves.

## Current repository baseline and implementation status

The following is the status as of 2026-07-20.

| Area              | Exists now                                                                                                                                                                                               | Missing or misleading                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime ownership | Explicit isolated runtimes own state heads, queues, handlers, subscriptions, tracing, timers, modules, inspectors, and a process-local `runtimeInstanceId`.                                              | The operation registry is in-memory only; restart and eviction recovery are not durable.                                                                                |
| Event API         | `dispatch`, `dispatchSync`, `startOperation`, `dispatchAndWait`, `getOperation`, and runtime-global `flush`. Instance APIs validate event IDs.                                                           | Raw event vectors remain a development/test API, not the future command plane.                                                                                          |
| State             | Separate committed/write and published/render heads, monotonic committed/published revisions, tracked-operation patches even with tracing disabled, and owned/frozen state ingress.                      | Bytes and result artifacts are not yet bounded/redacted at the core-to-wire boundary.                                                                                   |
| Queue             | Per-runtime serial FIFO queue, exact synchronous child parentage for tracked operations, failure isolation, and `dispatchSync` ordering protection.                                                      | General event envelopes and explicit causal links from a child to its emitting effect remain future work.                                                               |
| Effects           | State commits before effects; malformed/missing tracked effects are structured; promise/delayed effects are detached; uncontracted legacy `void` effects are only `returned`, not externally successful. | No effect catalog, adapter attempt IDs, enforced headless profile, cancellation, or supervised async completion.                                                        |
| Tracing           | Event, subscription, render, patches, effects, and normalized error tags; bounded DevTools storage.                                                                                                      | Optional 50 ms batches; queued child events lack event parentage; no completion guarantee.                                                                              |
| Inspector         | Runtime-bound snapshot, trace subscription, raw dispatch/evaluation, and an additive optional operation capability on Inspector v2.                                                                      | DevTools and MCP have not negotiated or used the capability yet.                                                                                                        |
| DevTools/MCP      | Authenticated, read-only by default, bounded, redacted, multi-runtime, session-epoch aware. Same-name root dispatches are correlated by event-array identity.                                            | Root-trace inference is an undocumented identity coupling. Timeout/disconnect is unrecoverable. Results omit cascade, publication, observations, and async disposition. |
| Headless          | Separate adapters are demonstrated; status reports runtime kind, overall effect mode, and per-ID labels.                                                                                                 | Labels are arbitrary and informational. The receipt cannot prove which adapter or fixture handled an effect.                                                            |
| Persistence       | Instance-aware sync persistence has explicit lifecycle barriers and useful generation/ordering patterns.                                                                                                 | It is not an operation ledger; async storage completion is outside `runtime.flush()`.                                                                                   |

| Slice                            | Current status                                                                                                            | Explicitly not claimed yet                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Experimental core receipt        | Implemented as `schemaVersion: 0`; an immutable operation snapshot is separate from caller-relative delivery/replay data. | Stable RFC v1 wire schema or semantic command result.                                        |
| Identity, revisions, idempotency | Implemented in one runtime instance with a 256-entry terminal-evicting ledger and root-start `expectedRevision`.          | Durable reservation, TTL/tombstone policy, cross-process recovery, or exactly-once behavior. |
| Headless context                 | A caller declaration is recorded as `enforced: false`.                                                                    | Trusted profile selection, adapter provenance, fixtures, or policy enforcement.              |
| Safety limits                    | Count limits, cloneability checks for tracked input/state, and an incomplete outcome when evidence is truncated.          | Byte limits, redaction, authorization, principal quotas, and continuations.                  |

### Document disposition

This RFC is the sole authority for operation identity, completion, receipts,
lookup, retry, and the migration away from trace-derived completion.

- [`historical-re-frame-priorities.md`](../agent-development/historical-re-frame-priorities.md) is superseded for operation design.
- [`priorities.md`](../agent-development/priorities.md) remains broad product guidance; its operation sections are superseded here.
- [`workflow.md`](../agent-development/workflow.md) documents the legacy trace-derived prototype until its examples are migrated.
- [`devtools.md`](../roadmaps/devtools.md) remains authoritative for non-operation backlog; its trace-derived dispatch/server-mirror proposals are superseded here.
- Instance ownership, persistence, and fixture documents remain complementary.

## Research and prior art

This design was checked against primary sources current to 2026-07-20.

### Recent re-frame work

[re-frame 1.4.6 and 1.4.7](https://day8.github.io/re-frame/releases/2026/)
explicitly focused on AI-pairing support and completed/renamed the current
instrumented surface. Their additions are important prior art:

- `dispatch-and-settle` waits for a root event and its synchronous dispatch
  cascade;
- unique dispatch IDs and parent dispatch IDs support assembled event epochs;
- `dispatch-with` carries invocation-scoped effect substitutions in event
  metadata, so concurrent probes do not mutate global registrations;
- a documented trace tag schema and validation make tooling contracts
  explicit; and
- instrumented macros capture source provenance.

Uklad should adopt the intent, not mechanically copy the boundary. re-frame's
documented fallback without tracing uses post-event callbacks and a quiet
window, cannot await asynchronous effects, and returns epoch bookkeeping rather
than a full state/effect/result record. Uklad can make causal envelopes and
pending-work accounting native from the start. Its result must also distinguish
handler output from state actually committed after the interceptor pipeline.

### Agent and tool runtimes

The [MCP 2025-11-25 task
model](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
uses stable task handles, queryable status, deferred result retrieval,
cancellation, TTL, and optional notifications. Notifications are not the
source of truth. MCP also supports
[`outputSchema` and
`structuredContent`](https://modelcontextprotocol.io/specification/2025-11-25/schema),
which should carry the machine receipt while text remains a compatibility
summary.

The [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/guides/running-agents/)
separates a bounded run/result from its tracing system, gives individual tool
calls their own IDs, exposes cancellation and concurrency bounds, and can run
with tracing disabled. [A2A tasks](https://a2a-protocol.org/latest/specification/)
similarly separate task identity, status, history, artifacts, retrieval, and
conversation context.

The lesson is not to adopt one external task state machine as Uklad's domain
model. Uklad should own a richer operation record and adapt it to MCP Tasks,
A2A, HTTP long-running operations, or a direct in-process API.

### Reliability and distributed operations

[Google's long-running operation
pattern](https://google.aip.dev/151) returns a stable operation resource that
can be retrieved after the initiating connection ends. [Stripe idempotent
requests](https://docs.stripe.com/api/idempotent_requests) retain the first
result and reject reuse of a key with different parameters. The expired
[IETF Idempotency-Key draft
07](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header)
is useful prior art, not a standard: it distinguishes a completed duplicate,
an in-progress duplicate, and conflicting key reuse.

Messaging systems state the core ambiguity directly: a timed-out send may
have succeeded. Current [Azure Service Bus reliability
guidance](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-message-loss-and-duplicates)
therefore combines duplicate detection with idempotent consumers. The
operation protocol must never translate “the acknowledgement was lost” into
“the application failed.”

[Temporal's architecture](https://github.com/temporalio/temporal/blob/main/docs/architecture/README.md)
and the [transactional outbox
pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
also reinforce that deterministic state progression and external activity
acknowledgement are separate. External I/O may happen before its completion is
durably known. Uklad therefore needs effect intent and attempt identities and
must not promise exactly-once delivery without a durable inbox/outbox or a
downstream idempotency contract.

### Observability and headless testing

[W3C Trace Context](https://www.w3.org/TR/trace-context/) and
[OpenTelemetry messaging semantic
conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
provide good correlation vocabulary and distinguish create, send, process, and
settle. They also allow sampling and dropped/buffered telemetry. Operation IDs
are business/runtime truth; trace and span IDs are optional links.

[Playwright](https://playwright.dev/docs/actionability) demonstrates the value
of condition-based waiting, isolated concurrent contexts, fixture-backed
network behavior, compact semantic observations, and rich traces around an
authoritative action result. Uklad should similarly prefer exact pending-work
accounting over sleeps, expose named subscriptions rather than dump state, and
state whether headless effects were real, stubbed, fixture-backed, or
suppressed.

## Terminology and identity

These names are normative.

| Term                    | Meaning                                                                                          | Owner and scope                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `commandId`             | Versioned externally callable semantic contract. Commands are private unless explicitly exposed. | Application contract registry.                                             |
| `eventId`               | Handler/type name at index `0` of an event vector. Repeats are normal.                           | Application registration.                                                  |
| `requestId`             | One MCP/HTTP/WebSocket request and audit interaction.                                            | Transport/gateway; never execution identity.                               |
| `idempotencyKey`        | Caller-provided retry identity for one semantic input.                                           | Scoped to principal, runtime/command, and documented retention window.     |
| `operationId`           | Unique handle for one logical root invocation and its joined descendants.                        | Core runtime operation ledger; created before enqueue.                     |
| `eventInstanceId`       | Unique identity for one concrete root or child event occurrence.                                 | Core runtime. Replaces ambiguous uses of `dispatchId` in the new protocol. |
| `parentEventInstanceId` | Structural parent for an event synchronously dispatched during another event's handling/effects. | Core runtime.                                                              |
| `causedByEffectId`      | Effect intent that caused an event, when known.                                                  | Core runtime/effect adapter.                                               |
| `effectId`              | Unique intent identity for one emitted effect tuple.                                             | Core runtime, unique within an operation.                                  |
| `attemptId`             | One execution attempt for an effect/task.                                                        | Effect/task supervisor.                                                    |
| `stateRevision`         | Monotonic revision of the committed write head.                                                  | Runtime instance.                                                          |
| `publishedRevision`     | Latest revision visible through published subscriptions.                                         | Runtime instance.                                                          |
| `traceId` / `spanId`    | Optional diagnostic correlation.                                                                 | Tracer/exporter; never completion identity.                                |
| `runtimeId`             | Stable logical routing identity chosen by the application.                                       | Application/runtime configuration.                                         |
| `runtimeInstanceId`     | Unique lifetime of one in-memory runtime/ledger.                                                 | Core runtime; changes on restart.                                          |
| `sessionEpoch`          | DevTools connection/storage generation. It may change on reconnect without a runtime restart.    | DevTools server.                                                           |

Do not call causal event groups “epochs”; Uklad already uses epoch/session
language elsewhere. Do not reuse the current DevTools `dispatchId` as an
operation ID. During migration it remains a transport correlation field and is
eventually renamed `requestCorrelationId` or removed.

## Architectural boundary

```text
agent / test / developer
          |
          | command or dev-only event request
          v
gateway (MCP / HTTP / direct API)
  validation, authentication, policy, bounds, requestId
          |
          | trusted invocation envelope
          v
Uklad operation coordinator --------------------------+
  operation ledger, idempotency, revisions, budgets    |
          |                                              |
          v                                              |
event queue -> interceptor pipeline -> state commit      |
                  |                    |                 |
                  |                    +-> publication   |
                  v                                      |
             effect intents -> adapters/tasks -> children
          |
          +-> authoritative operation snapshot/result
          |
          +-> optional traces/logs/audit exporters
```

The boundaries are intentional:

- **Core** decides identity, causality, commit truth, completion, revisions,
  and the authoritative result.
- **Application contracts/policy** decide which commands are externally
  callable, validation, risk, required effects, authorization, and semantic
  result schemas.
- **Effect adapters/task supervisor** decide how declared work is executed and
  report provenance, attempts, and acknowledgement.
- **Inspector** is a runtime-bound development adapter; it does not reconstruct
  results.
- **DevTools server** routes, authenticates, redacts, bounds, audits, and
  transports operation resources. It does not infer them from traces or a
  mirrored state.
- **MCP** exposes structured tools/tasks. MCP task IDs may map to operation IDs,
  but MCP is not the internal state machine.
- **Tracing** derives spans from operation lifecycle events and may be disabled.

## Core invocation API

The additive event-level API is:

```ts
const wait = await runtime.dispatchAndWait(['cart/checkout', { cartId: 'cart-7' }], {
  completion: 'cascade-published',
  timeoutMs: 5_000,
  idempotencyKey: 'agent-run-42/checkout-cart-7',
  expectedRevision: 81,
  observe: [['cart/status', 'cart-7'], ['orders/latest-id']],
});
```

`dispatchAndWait` is deliberately named as an event API. It does not imply that
arbitrary registered events are safe external commands. Existing `dispatch`
remains fire-and-forget, `dispatchSync` remains an immediate compatibility API,
and `flush` remains a runtime-wide queue/publication barrier.

The future production surface is separate:

```ts
const operation = await runtime.executeCommand({
  command: 'cart/checkout@2',
  input: { cartId: 'cart-7' },
  idempotencyKey: 'agent-run-42/checkout-cart-7',
  expectedRevision: 81,
  deadline: '2026-07-20T15:30:00Z',
});
```

The command gateway validates and authorizes the request, then invokes the same
core operation coordinator. Raw event dispatch remains an internal,
development, test, and migration capability.

Lookup is independent of the original wait:

```ts
runtime.getOperation({ operationId });
runtime.getOperation({ idempotencyKey });
```

An in-progress duplicate returns the existing operation. A completed duplicate
returns the retained result. Reusing a key with a different canonical input
returns `IDEMPOTENCY_CONFLICT` and never enqueues work.

## Invocation envelope

Agent-controlled values never carry trusted metadata inside their event
payload. The gateway and core build an out-of-band envelope:

```ts
interface OperationEnvelope {
  schemaVersion: 1;
  operationId: string;
  runtimeId: string;
  runtimeInstanceId: string;
  requestId?: string;
  idempotencyKey?: string;
  requestFingerprint?: string;
  principal?: PrincipalRef;
  policyDecision?: PolicyDecisionRef;
  command?: {
    id: string;
    version: number;
    contractHash: string;
  };
  root: EventEnvelope;
  completion: 'cascade-published' | 'required-work';
  expectedRevision?: number;
  deadline?: string;
  limits: OperationLimits;
}

interface EventEnvelope {
  eventInstanceId: string;
  parentEventInstanceId?: string;
  causedByEffectId?: string;
  event: readonly [eventId: string, ...params: unknown[]];
  source?: SourceRef;
}
```

The queue should store envelopes, not bare vectors. Compatibility handlers
continue to receive the event vector through `coeffects.event`. Internal
metadata is not enumerable application input and cannot be forged by setting a
property on a vector.

Every synchronous call to the runtime dispatch primitive while an event or its
effect handler is active inherits its operation and records its parent. This
includes the built-in `dispatch` effect, custom synchronous adapters, and the
currently warned impure handler path. A delayed callback does not inherit
joined status merely because it closes over an event vector; it must use an
explicit supervised/joined task API.

## Lifecycle and completion semantics

### Operation state

The authoritative orchestration state is:

```text
accepted -> queued -> running -> completed
    |          |         |          |
    +----------+---------+--------> failed
    +-----------------------------> cancelled   (future supervised work)

rejected  (terminal; execution never began)
expired   (ledger tombstone/retention fact, not execution failure)
```

`completed` means the requested completion target was reached. It does not
mean every outcome dimension succeeded. For example, an operation can be
`completed` with committed state and failed external effects.

Client wait states such as `timed-out` or `disconnected` are not operation
states. A wait result contains `delivery.status: 'unknown'` or
`wait.status: 'timed-out'` plus the operation handle. The operation may still
be `queued`, `running`, or `completed` in the ledger.

### `cascade-published`

Version 1 joins work by explicit pending-count accounting:

- the root event starts with one pending event occurrence;
- each synchronous descendant dispatch increments the same operation before it
  is enqueued;
- each occurrence decrements the count exactly once on success, failure,
  queue-drop, or runtime disposal;
- zero pending occurrences closes the causal cascade;
- Uklad synchronously publishes the latest committed revision;
- requested observations run against that published revision; and
- the immutable terminal receipt is retained and waiters resolve.

There is no quiet-time window. Unrelated events do not keep the operation open.
They may interleave in the shared FIFO queue, so the receipt reports revisions
for every event and the revision at observation time. Observations describe
what the shared application actually saw, which may include earlier
interleaved commits. Preconditions and, where needed, isolated runtimes protect
work that requires a stable base.

The target includes:

- root and joined synchronous child handlers/interceptors;
- their actual commit decisions and patches;
- synchronous effect-handler invocation and synchronous child dispatch;
- explicit queue-drop/failure records;
- subscription publication; and
- requested semantic observations.

It excludes, but records when detected:

- `dispatch-later` and timers;
- promise-returning legacy effect handlers;
- HTTP/WebSocket callbacks;
- browser/user activity after the synchronous adapter returns;
- independently dispatched events; and
- background work not registered with the task supervisor.

### `required-work`

This future target adds runtime-supervised tasks marked `joined` or effects
declared `required`. It waits until those descendants reach a terminal
disposition, subject to deadline, cancellation, retry, and budget policy.
Detached work never delays it.

Cancellation is best effort and never implies rollback. A receipt must say
which state was already committed and which effect attempts may have reached
the outside world.

## Result model

The receipt schema is versioned independently of the trace schema and wire
protocol. A representative result is:

```json
{
  "schemaVersion": 1,
  "operationId": "op_01K0...",
  "runtime": {
    "runtimeId": "checkout-headless",
    "runtimeInstanceId": "ri_01K0..."
  },
  "status": "completed",
  "completion": "cascade-published",
  "acceptedAt": "2026-07-20T14:00:00.000Z",
  "completedAt": "2026-07-20T14:00:00.013Z",
  "idempotency": {
    "key": "agent-run-42/checkout-cart-7",
    "scope": "runtime-instance",
    "requestFingerprint": "sha256:...",
    "replayed": false,
    "retainedUntil": "2026-07-20T14:10:00.000Z"
  },
  "revisions": {
    "accepted": 81,
    "lastCommitted": 83,
    "published": 83,
    "observed": 83
  },
  "rootEventInstanceId": "evt_01K0...",
  "events": [
    {
      "eventInstanceId": "evt_01K0...",
      "event": ["cart/checkout", { "cartId": "cart-7" }],
      "status": "completed",
      "state": {
        "status": "committed",
        "fromRevision": 81,
        "committedRevision": 82,
        "patches": []
      },
      "effects": ["fx_01K0..."]
    },
    {
      "eventInstanceId": "evt_01K0...child",
      "parentEventInstanceId": "evt_01K0...",
      "event": ["checkout/succeeded", { "orderId": "order-7" }],
      "status": "completed",
      "state": {
        "status": "committed",
        "fromRevision": 82,
        "committedRevision": 83,
        "patches": []
      },
      "effects": []
    }
  ],
  "state": {
    "status": "committed",
    "patches": [],
    "truncated": false
  },
  "effects": {
    "status": "partially-failed",
    "items": [
      {
        "effectId": "fx_01K0...",
        "eventInstanceId": "evt_01K0...",
        "effectType": "orders/write",
        "declaration": { "payload": {} },
        "adapter": {
          "profile": "headless-safe",
          "mode": "fixture",
          "name": "orders-fixture-v3",
          "fixture": "checkout-success/order-7"
        },
        "required": true,
        "status": "failed",
        "attempts": [
          {
            "attemptId": "attempt_01K0...",
            "status": "failed",
            "error": {
              "code": "FIXTURE_MISS",
              "phase": "effect",
              "message": "No matching fixture",
              "retryable": false
            }
          }
        ]
      }
    ]
  },
  "observations": {
    "status": "succeeded",
    "revision": 83,
    "items": [
      {
        "query": ["cart/status", "cart-7"],
        "status": "succeeded",
        "value": "submitted"
      }
    ]
  },
  "errors": [],
  "diagnostics": {
    "traceIds": [],
    "logsCursor": null
  },
  "limits": {
    "truncated": false,
    "omitted": {},
    "continuation": null
  }
}
```

This is the **target stable v1 schema**, not the current implementation
payload. The implementation spike deliberately emits a smaller experimental
`schemaVersion: 0` snapshot plus a separate caller delivery wrapper. It must
either converge on this schema before a stable release or be replaced by a
separately versioned v1 migration; two incompatible structures must never both
claim `schemaVersion: 1`.

### Independent outcome dimensions

Do not reduce the record to one `ok` boolean. Consumers should inspect:

- orchestration: accepted/queued/running/completed/failed/rejected/cancelled;
- each event occurrence: reached/completed/failed/dropped/not-reached;
- state: not-attempted/unchanged/committed/partially-committed/failed;
- publication: pending/published/failed;
- joined effects: none/pending/all-succeeded/partially-failed/failed/unknown;
- observations: not-requested/succeeded/partially-failed/failed/stale; and
- caller delivery: delivered/unknown.

For compatibility, DevTools may derive the old summary:

| Compatibility `outcome` | Derivation                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`             | Operation completed; state/publication succeeded; no required or observed effect failure; no incomplete joined work.                            |
| `effects-failed`        | State committed/published, but at least one effect failed or was unhandled.                                                                     |
| `incomplete`            | The requested boundary was reached, but detached, unacknowledged, or truncated work prevents a success claim.                                   |
| `failed`                | Request rejected, a handler/commit/publication failed, or a required child was dropped.                                                         |
| `rejected`              | The operation was accepted as a request but did not begin execution because a precondition, idempotency conflict, or capacity rule rejected it. |
| `unknown`               | Only the caller's delivery/wait result is unknown; never stored as terminal runtime truth.                                                      |

### Event records and patches

Patches are captured for tracked operations even when tracing is disabled.
They are attached to the event whose commit actually happened. If an
interceptor throws before the commit interceptor, candidate patches may be kept
only as explicitly labeled diagnostics; `state.status` remains `failed` or
`not-attempted` and no committed revision is assigned.

The operation-level patch list is an ordered, bounded aggregation. It is
evidence, not a domain result. Versioned commands may additionally return a
typed semantic result such as `{ orderId: 'order-7' }`.

### Effect records

Effect **adapter provenance** and effect **execution status** are orthogonal.

Adapter mode:

```text
real | memory | fixture | stub | noop | suppressed | unavailable
```

Execution status:

```text
declared | started | succeeded | failed | skipped | detached | unknown
```

`fixture` records fixture identity and match/miss. `suppressed` and `noop` are
successful policy dispositions only when the effect contract permits them;
they are never reported as real execution. A missing handler is `unavailable`,
not success. Promise-returning legacy effects are `detached` until migrated to
supervised tasks.

Each effect intent receives a stable `effectId`; each attempt receives an
`attemptId`. Downstream adapters should receive an idempotency token derived
from the operation/effect identity when their contract supports it.

### Semantic observations

Agents usually care about what the application now derives, not every leaf in
a patch. `observe` accepts registered subscription queries only. Uklad
publishes first, evaluates each query at the reported `publishedRevision`, and
returns a bounded/redacted value or structured query error.

Observations are not assertions and do not make shared state serializable.
Under concurrent operations they report the real state at observation time.
The receipt therefore includes `observedRevision`. A future command contract
may declare named result projections so agents do not need to know internal
subscription IDs.

## Failure semantics

| Situation                               | Runtime truth                                                                                                    | Caller guidance                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Input/schema/policy rejection           | `rejected`; no event enqueued, no state/effects.                                                                 | Correct the request or obtain authority; do not retry unchanged.                            |
| `expectedRevision` mismatch             | `rejected` with `REVISION_CONFLICT`.                                                                             | Re-read semantic state, re-plan, use a new idempotency key only for the new intent.         |
| Handler/interceptor fails before commit | Event `failed`; state `not-attempted`/`failed`.                                                                  | Fix handler/interceptor or input.                                                           |
| Root commits; child handler fails       | Operation `failed` or completed-with-errors; root state remains committed and is published.                      | Do not assume rollback. Inspect the exact child record.                                     |
| State commits; effect throws            | State `committed`; effect `failed`; compatibility outcome `effects-failed`.                                      | Repair/retry the effect only if its contract and idempotency policy allow it.               |
| Missing/malformed effect                | Effect `unavailable`/`failed`, never silent success.                                                             | Register/fix the adapter or explicitly allow suppression.                                   |
| Legacy effect returns a promise         | Effect `detached`; `cascade-published` may complete with incomplete external evidence.                           | Use supervised tasks for authoritative completion.                                          |
| Queue failure drops work                | Every affected event occurrence becomes terminal `dropped`; every operation waiter resolves to a record.         | Phase 0 should stop purging unrelated operations entirely.                                  |
| Runtime disposed                        | Pending occurrences fail with `RUNTIME_DISPOSED`; no hanging promises.                                           | Start/select a new runtime; do not assume unacknowledged external effects were rolled back. |
| Wait deadline expires                   | Operation stays queued/running/completed as applicable; wait result says timed out and includes lookup identity. | Call `getOperation`; never blind-retry with a new key.                                      |
| Connection lost after send              | Caller delivery unknown; runtime truth unchanged.                                                                | Recover by `operationId` or the same `idempotencyKey`.                                      |
| Ledger entry expired                    | `expired` tombstone where possible; execution truth no longer available.                                         | Retry is safe only if a durable/downstream idempotency contract still covers it.            |

The runtime error model uses stable codes, a phase, a safe message, optional
details, and explicit retryability:

```ts
interface OperationError {
  code: string;
  phase:
    | 'validation'
    | 'authorization'
    | 'queue'
    | 'coeffect'
    | 'handler'
    | 'commit'
    | 'effect'
    | 'publication'
    | 'observation'
    | 'runtime';
  message: string;
  retryable: boolean;
  eventInstanceId?: string;
  effectId?: string;
  attemptId?: string;
  details?: unknown;
}
```

Stack traces are optional redacted diagnostics, not stable machine fields.

## Idempotency, lookup, and unknown delivery

Idempotency is established before execution:

1. validate and canonicalize the semantic request;
2. compute a versioned request fingerprint;
3. atomically reserve `(scope, idempotencyKey) -> operationId`;
4. enqueue only after reservation succeeds; and
5. retain the mapping with the terminal result for a documented period.

Rules:

- same key + same fingerprint while running returns the existing handle;
- same key + same fingerprint after completion returns the original retained
  result, even if current state has since changed;
- same key + different fingerprint returns `IDEMPOTENCY_CONFLICT`;
- validation/authorization failures before reservation may be retried after
  correction;
- callers must not use a new key merely because delivery was unknown; and
- the receipt states the deduplication scope and retention deadline.

Phase 1 is explicitly **runtime-instance scoped and in memory**. It protects
retries while that runtime and retained ledger entry exist. It cannot protect a
retry after process restart. Production durability requires a pluggable ledger
or application inbox plus effect outbox/downstream idempotency. Until then,
`retrySafe` must not claim more than the actual scope.

Operation IDs and idempotency keys are capability-sensitive identifiers. The
gateway binds lookup to the same principal/runtime/tenant policy that permitted
execution; possessing a guessable ID must not reveal another principal's
result.

## Revisions and concurrency

Each runtime instance owns two monotonic counters:

- `stateRevision` advances on each actual state commit;
- `publishedRevision` advances to the latest state revision made visible to
  subscriptions.

Initial state is revision `0`. Restore/fixture replacement is an explicit
operation that advances revision; it must coordinate with persistence
lifecycles rather than mutating the DevTools mirror.

Every operation records its accepted revision. Every event records its
`fromRevision` and optional `committedRevision`. Reads, command results, and
observations state the revision they represent.

`expectedRevision` provides optimistic concurrency. It is checked at the
defined serialization point immediately before the root begins. Checking only
when the transport request arrives is insufficient because earlier queued work
may commit first.

The queue remains serial within one runtime, but concurrent operations can
interleave:

```text
A.root -> B.root -> A.child -> B.child
```

This is visible, not inferred. Each record carries exact IDs and revisions.
The causal completion of A excludes B's event records, while A's final semantic
observations can legitimately include B's earlier committed state. Work that
must not share this state should use isolated runtime instances; work that can
share it should use revisions/preconditions and domain idempotency.

Before 1.0, Uklad should also correct two existing ordering hazards:

- `dispatchSync` must not overtake accepted queued work; and
- one failed operation must not purge unrelated operations.

These are intentional behavioral changes and require migration notes and
tests, as event ordering and dispatch completion are semver-visible contracts.

## Headless effect profiles and overrides

**Target design — not implemented in the experimental core slice.** The slice
only records an unverified caller declaration (`enforced: false`). It does not
select, constrain, or prove an adapter.

Headless execution uses a registered, enforced profile rather than arbitrary
status strings:

```ts
runtime.registerEffectProfile({
  id: 'headless-safe@1',
  defaultMode: 'suppressed',
  effects: {
    'storage/write': { adapter: 'memory-storage@1', mode: 'memory' },
    'http/request': { adapter: 'checkout-fixtures@3', mode: 'fixture' },
    'analytics/track': { adapter: 'analytics-noop@1', mode: 'noop' },
  },
});
```

The selected profile is part of the trusted operation context and the result.
Registration is validated against the effect catalog. Risk policy may forbid
`real` adapters in headless mode or require approval for a specific effect.

Invocation-scoped overrides should follow re-frame's good design: carry named
override/profile references in the operation context, inherit them through the
joined cascade, and never mutate global handlers. Across a wire, callers select
pre-registered profiles/fixtures; they cannot upload executable functions.

## Safety and bounds

**Target design — partially implemented.** The core currently bounds retained
operation/event/effect/error counts and rejects uncloneable tracked input. Byte
budgets, redaction, authorization, principal quotas, and continuations belong
to later control-plane work.

Every operation has enforced limits. At minimum:

- request bytes and result bytes;
- queued/running operations per runtime and per principal;
- event count, causal depth, and fan-out;
- effect intents, attempts, and joined tasks;
- patches and total patch bytes;
- observations, result items, depth, and bytes;
- wall-clock deadline;
- retained operation count/bytes/TTL; and
- trace/log/audit references.

Budget exhaustion is a structured `BUDGET_EXCEEDED` outcome. It stops or
cancels descendants where possible and reports what already committed. It does
not silently truncate execution. Result sections may be truncated for delivery
only when the receipt includes counts, digests, omitted fields, and an
authorized continuation/artifact reference.

Redaction happens before data crosses the runtime trust boundary and again at
the server defense-in-depth boundary. Input, events, patches, effect payloads,
observations, errors, and command results all participate. A redaction or
serialization failure produces a small structured result/artifact error rather
than degrading into an unexplained trace timeout.

Production commands are private by default and authorized by principal,
command/version, tenant/resource, risk, effect domain, and approval. MCP
annotations such as read-only/idempotent/destructive are useful hints, not
enforcement.

## Protocol boundaries and versioning

### Core and Inspector

The core receipt schema, Inspector API, DevTools wire protocol, and MCP tool
schema have separate version numbers. They can evolve independently through
explicit capability negotiation.

The first migration keeps `apiVersion: 2` and adds an **optional** operation
capability. Old v2 inspectors therefore remain structurally compatible and
must take the explicitly labeled legacy trace path; new SDKs use operation
messages only after both peers advertise `operationApiVersion: 1`.

```ts
interface UkladInspectorV2 {
  readonly apiVersion: 2;
  readonly operationApiVersion?: 1;
  readonly runtimeInstanceId?: string;
  startEvent?(event: [string, ...unknown[]], options?: InspectorOperationOptions): OperationHandle;
  executeEvent?(
    event: [string, ...unknown[]],
    options?: InspectorOperationOptions,
  ): Promise<OperationWaitResult>;
  getOperation?(query: OperationLookup): OperationSnapshot | undefined;
}
```

Once the legacy path is retired, the mandatory surface may become v3:

```ts
interface UkladInspectorV3 {
  readonly apiVersion: 3;
  executeEvent(
    event: [string, ...unknown[]],
    options: InspectorOperationOptions,
  ): Promise<OperationWaitResult>;
  getOperation(query: OperationLookup): OperationSnapshot;
  subscribeOperations?(cursor: OperationCursor): OperationStream;
}
```

The immediate `startEvent` handle exposes a core-owned `operationId` before a
wait completes. `dispatchAndWait` remains a convenience wrapper. Callers do
not choose operation IDs; idempotency keys are the supplied retry mechanism.

### DevTools wire and HTTP

Protocol v3 treats operations as resources:

```text
POST /api/operations/events      create/await a dev-only event operation
GET  /api/operations/:id         recover current/final state
POST /api/operations/lookup      recover by authorized operation ID or idempotency key
GET  /api/operations/:id/events  bounded causal history/cursor
```

The initial response returns acceptance and `operationId` as soon as practical.
The connection may then wait up to its caller deadline for completion. A 202 or
wait timeout points to the same status resource; it never implies rollback.
WebSocket progress has monotonic sequence numbers and resumable cursors, but
lookup remains authoritative.

The server may cache redacted operation snapshots for reconnect efficiency,
but it does not invent state transitions. On SDK reconnect to the same
`runtimeInstanceId`, it can refresh from core. On runtime restart it reports
the previous in-memory operation as unavailable/expired unless a durable ledger
can recover it. `sessionEpoch` still governs DevTools trace/cursor storage and
must not be confused with runtime lifetime.

### MCP

`dispatch_event` remains a development compatibility tool and starts returning
the core receipt. Add `get_operation`. Both declare `outputSchema` and return
`structuredContent`; a concise JSON text copy remains for older clients.

When MCP Tasks are negotiated, a long-running Uklad operation can be exposed
as a task. Uklad operation identity, authorization, retention, and result
remain authoritative because MCP Tasks are still experimental and generic.

The production tool is eventually `execute_command`, backed only by explicitly
exposed command contracts. Do not create one MCP tool per event; use compact
`search_contracts`, `get_contract`, `execute_command`, `get_operation`, `query`,
and `wait_for` surfaces.

## Tracing and audit

Each operation milestone emits optional trace/span data with:

- `operationId`;
- `eventInstanceId` and parent/causation links;
- `effectId`/`attemptId`;
- state/published revisions; and
- terminal status/error code.

The trace schema should be versioned and validated, following recent re-frame
prior art. OpenTelemetry export may use parents for a simple event tree and
links for fan-in, batching, or work that also has another ambient context.

Trace collection can be disabled, sampled, delayed, dropped, or redacted
without affecting operation execution or lookup. `traceIds` in the receipt are
optional forensic pointers.

Development in-memory operation history is not durable audit. Production
deployments may configure an append-only sink containing principal, policy,
contract hashes, input fingerprint, revisions, effect attempts, approval, and
retention gaps. Redaction occurs before persistence. A transactional outbox is
the preferred boundary when state and external effect intent must survive a
crash together.

## Fixtures, replay, and preview

Build these after the operation spine:

- **Snapshot restore** is a core/fixture-adapter operation, not a mutation of
  the DevTools server's redacted state mirror.
- **Pure replay** reruns handlers with captured coeffects, suppresses I/O, and
  compares state/effect/result hashes.
- **State replay** applies recorded patches for debugging only.
- **Live retry** requires fresh policy/approval and an idempotency contract.
- **Preview** returns proposed state/effects and a plan token bound to input,
  contract hash, state revision, and policy; committing a stale token fails.

Named scenarios compose restore/replay, operation execution, semantic
observations, and assertions. Generic replay never performs real external I/O
by default.

## Alternatives considered

### Keep matching traces

Rejected. Better matching can fix duplicate event names but cannot make
optional buffered telemetry authoritative, prove publication, recover after
loss, or supervise effects.

### Use `flush()` as the completion primitive

Rejected. It is a runtime-global idle boundary, includes unrelated work, and
excludes asynchronous effects. It remains useful for tests and lifecycle
barriers.

### Use a quiet period after the last observed child

Rejected as authoritative behavior. It is vulnerable to unrelated concurrency
and slow callbacks. Quiet windows may remain a heuristic diagnostic labeled
with non-exact confidence.

### Treat a trace ID as the operation ID

Rejected. Trace IDs belong to optional observability, may be local/reused after
restart, and do not carry idempotency or result retention semantics.

### Make raw events the production agent API

Rejected. Internal facts such as `payment/succeeded` or
`session/token-restored` must not become callable merely because a handler is
registered. Commands add validation, versioned results, policy, and intent.

### Promise-wrap every effect and await all of them

Rejected. Some effects are intentionally detached or streaming; arbitrary
callbacks cannot be discovered; cancellation and retry need explicit policy;
and awaiting everything introduces unbounded hangs. Supervised tasks make
joining explicit.

### Promise exactly-once behavior

Rejected. A crash can occur after external I/O but before acknowledgement.
Uklad can provide durable state/effect intent and stable attempt IDs, while
exactly-once business behavior still requires idempotent downstream contracts
or reconciliation.

## Phased roadmap

### Phase 0 — deterministic integrity prerequisites

**Status: complete in the experimental core slice.**

**Deliverables**

- [x] Own/copy accepted event inputs and state ingress sufficiently that later
      caller mutation cannot invalidate evidence.
- [x] Add committed and published revisions.
- [x] Make missing/malformed required effects and coeffects structured failures.
- [x] Prevent `dispatchSync` from overtaking accepted queued work.
- [x] Isolate queue failure by operation; never purge unrelated work.
- [x] Ensure successful earlier commits are published even when a later event
      fails.

**Acceptance criteria**

- [x] Mutation-after-dispatch and mutation-after-restore tests cannot alter queued
      input or owned state.
- [x] A missing/throwing coeffect or malformed/missing required effect is visible
      as failure.
- [x] FIFO tests cover queued async followed immediately by sync invocation.
- [x] One failing operation does not drop another agent/user operation.
- [x] A failed queue batch publishes every earlier committed revision before its
      waiter completes.

### Phase 1 — core synchronous operation spine

**Status: complete in the experimental core slice.**

**Deliverables**

- [x] Queued operation/event envelopes with exact root/parent identities.
- [x] Additive `dispatchAndWait` and `getOperation` runtime APIs.
- [x] Bounded in-memory operation/idempotency registry.
- [x] Causal pending-count settlement for synchronous dispatch descendants.
- [x] Patches captured for tracked operations with tracing disabled.
- [x] Explicit handler, commit, publication, observation, and synchronous effect
      records.
- [x] Queue-drop and runtime-dispose terminal settlement.
- [x] Operation/revision tags added to optional traces.

**Acceptance criteria**

- [x] Concurrent identical event IDs receive distinct operation/event-instance
      IDs and the correct individual result.
- [x] A root plus multi-level/multi-branch child cascade has exact parentage and
      resolves only after its joined children and publication.
- [x] An unrelated interleaved event is absent from the causal event list.
- [x] A child failure preserves and reports a parent state commit.
- [x] A synchronous effect failure cannot turn a committed state transition into a
      handler failure or a false success.
- [x] Tracing can be disabled throughout with identical receipt semantics.
- [x] A wait timeout returns a running handle; later lookup returns the terminal
      record.
- [x] Same idempotency key/input executes once; different input is rejected.
- [x] Explicit queue purge and runtime disposal settle every affected waiter; an event failure never purges unrelated accepted work.
- [x] Thenable and delayed legacy effects are reported as detached/excluded.

### Phase 2 — Inspector, DevTools, and MCP vertical slice

**Deliverables**

- Additive Inspector-v2 operation capability and feature negotiation; reserve Inspector v3 for making it mandatory.
- Keep DevTools protocol v2 while negotiating `operation-receipts-v1`; use protocol v3 only for a coordinated breaking cleanup.
- `dispatch_event` backed by the core receipt; trace inference labeled legacy.
- `get_operation` by operation ID or idempotency key.
- Structured MCP output schemas, `structuredContent`, compact text fallback.
- Timeout/disconnect/reconnect recovery and explicit runtime-instance mismatch.
- Bounded result/artifact transfer with redaction/truncation metadata.

**Acceptance criteria**

- A real runtime -> SDK -> server -> MCP integration test covers two concurrent
  same-ID events without object-identity matching.
- Tracing disabled still produces the same MCP result.
- Losing the initial response and reconnecting to the same runtime retrieves
  the result without re-executing.
- Restarting the runtime produces an explicit unavailable/expired result rather
  than matching a new trace/session accidentally.
- Oversized or redaction-failed sections return a structured bounded result,
  not generic `unknown`.
- Old Inspector/protocol peers fail closed or use an explicitly provisional
  compatibility path.

### Phase 3 — enforced effects and semantic observations

**Deliverables**

- Registered effect catalog with requiredness, risk, result, idempotency, and
  async/join policy.
- Enforced named headless profiles and per-effect adapter provenance.
- Invocation-scoped named overrides/fixtures inherited by the cascade.
- Stable effect intent/attempt IDs and fixture hit/miss evidence.
- Bounded observations at explicit published revisions.

**Acceptance criteria**

- The result distinguishes real, memory, fixture, stub, noop, suppressed, and
  unavailable adapters.
- Suppression cannot satisfy an effect declared real/required without policy
  permitting it.
- Concurrent override profiles never interfere.
- Fixture misses and fallback-to-real attempts are explicit; safe profiles
  never silently access the network.
- Observation errors do not erase successful state/effect evidence.

### Phase 4 — executable contracts and production command plane

**Deliverables**

- `defineCommand`, `defineQuery`, and `defineEffect` descriptors with runtime
  schemas, versions, hashes, source metadata, risks, capabilities, and results.
- Generated static/runtime manifest and compact discovery tools.
- Private-by-default external exposure.
- Principal/tenant/resource authorization, approvals, expected revisions, and
  budgets.
- Durable/pluggable idempotency ledger option.

**Acceptance criteria**

- Invalid external input never reaches a handler.
- An internal event cannot be invoked through the command plane.
- Static and connected runtime contract hashes match or the request fails.
- Stale writes fail without state/effects.
- Authorization and approval are rechecked before irreversible adapters.
- Every successful command returns a schema-valid semantic result and
  authoritative operation ID.

### Phase 5 — supervised async work and durability

**Deliverables**

- Runtime-owned tasks with parent/causation IDs, `AbortSignal`, deadlines,
  cancellation, retry policy, progress, and backpressure.
- `required-work` completion for explicitly joined tasks/effects.
- `latest`, `queue`, and bounded `parallel` concurrency policies.
- Durable operation/task ledger plus state/effect-intent outbox integration.
- MCP Task adapter where negotiated.

**Acceptance criteria**

- Joined async work cannot outlive a successful `required-work` result.
- Detached work remains visible but does not block completion.
- Cancellation reports already committed state and possibly-applied effects;
  it never promises rollback.
- Crash/restart recovery resumes or terminally reconciles durable operations.
- Retried effect attempts reuse stable intent/idempotency identity.
- Progress/history is cursor-based, bounded, and reconnectable.

### Phase 6 — explanation, fixtures, replay, audit, and evaluation

**Deliverables**

- `explainOperation` and indexed `findStateChanges(path)`.
- Core-owned snapshots, named scenarios, safe preview, and explicit replay
  modes.
- Source provenance and versioned trace-schema validation.
- Durable redacted audit sink and retention-gap reporting.
- Coding-agent and runtime-agent evaluation harnesses.

**Acceptance criteria**

- One bounded call explains root -> child -> commit -> effect -> observation
  causality exactly.
- Replaying a scenario cannot perform external I/O without a separate live
  authorization.
- A snapshot/restore cannot bypass persistence lifecycle or revision rules.
- Evaluations cover duplicate IDs, response loss, concurrent actors, stale
  writes, dangerous effects, large results, runtime restart, and adversarial
  payloads.
- Uklad does not claim production-grade autonomous execution until the release
  gates below pass.

## Release gates for an agent-operation claim

- Every accepted command has a stable queryable operation ID.
- Tracing-disabled behavior is covered and identical at the receipt boundary.
- No terminal success hides a failed, missing, or unknown required effect.
- State commit and publication revisions are explicit.
- Unknown delivery is recoverable without blind duplicate execution.
- Idempotency scope/retention is truthful and conflict-tested.
- Concurrent operations have exact event causality and isolated failure.
- External inputs are validated and internal events are private by default.
- Results are bounded, redacted, schema-valid, and disclose omissions.
- Headless effect policy is enforced and evidenced per effect.
- Joined async work is supervised, cancellable, and bounded.
- Durable deployments address state/effect intent atomicity and downstream
  idempotency rather than claiming exactly once.
- Automated evaluations measure false success, duplicate mutation,
  unauthorized action, stale writes, recovery, budget enforcement, and replay
  safety.

## Open questions and provisional decisions

| Question                                                | Provisional decision                                                                                                          | Revisit when                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Exact public event API name                             | `dispatchAndWait`; it is explicit and additive. Avoid presenting it as the production command API.                            | Before Phase 1 public release.         |
| Default core timeout                                    | Finite for remote/devtools calls; direct in-process API may allow no timeout. A wait timeout never terminates the operation.  | Phase 1 API review.                    |
| Default ledger size/TTL                                 | Small bounded runtime-instance ring with terminal-entry eviction and explicit metadata. Never evict running entries silently. | Benchmarks and Phase 2 payload limits. |
| Whether ordinary `dispatch` creates retained operations | Give every occurrence causal identity internally; retain full records only when requested/policy requires it.                 | Phase 1 overhead benchmark.            |
| Observation behavior under interleaving                 | Report actual `observedRevision`; use preconditions or isolated runtimes for stronger assumptions.                            | Real concurrent-agent scenarios.       |
| Command descriptor library/schema implementation        | Keep schema adapter-neutral at the contract boundary; support common validators through adapters.                             | Phase 4 design.                        |
| Durable ledger location                                 | Pluggable application-owned store; persistence package may provide an adapter but should not be mandatory.                    | Phase 5.                               |
| Effect success for `noop`/`suppressed`                  | A known policy disposition, not real execution; satisfies required work only if the effect contract/profile permits it.       | Phase 3 contracts.                     |
| Trace schema compatibility                              | Separate version, additive fields by default, deprecation for rename/removal.                                                 | Phase 2/6.                             |
| MCP Tasks adoption                                      | Adapter when client/server negotiate it; keep `get_operation` regardless.                                                     | MCP task stability and client support. |

## Maintainer decision checklist

Before marking this RFC accepted, maintainers should confirm:

- the command/event boundary;
- `dispatchAndWait` naming and exact `cascade-published` boundary;
- the identity taxonomy, especially retiring protocol-level `dispatchId`;
- independent state/effect/publication/observation outcomes;
- runtime-instance-scoped Phase 1 idempotency limitations;
- pre-1.0 queue ordering and failure-isolation changes;
- Inspector/wire protocol version strategy; and
- the roadmap reorder that moves the operation spine and supervised tasks ahead
  of broader agent-platform claims.

The central rule is simple:

> The operation ledger is authoritative. Traces, patches, progress streams,
> transport responses, and server mirrors are evidence or delivery mechanisms
> around it.
