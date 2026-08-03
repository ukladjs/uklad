import type {
  DevtoolsEffectFact,
  DevtoolsExecutionObserver,
  OperationEventVector,
} from './runtime.js';
import type {
  OperationEffectSnapshot,
  OperationEventSnapshot,
  OperationSnapshot,
} from './types.js';

interface OperationReference {
  readonly operationId: string;
  readonly eventInstanceId: string;
  readonly parentEventInstanceId?: string;
  readonly sourceEffectId?: string;
  readonly sourceEffectIndex?: number;
  readonly acceptedSequence: number;
}

interface MutableEvent {
  readonly reference: OperationReference;
  readonly effects: OperationEffectSnapshot[];
  acceptedRevision?: number;
  startedRevision?: number;
  committedRevision?: number;
  status: OperationEventSnapshot['status'];
}

interface MutableOperation {
  readonly operationId: string;
  readonly rootEventInstanceId: string;
  readonly acceptedSequence: number;
  acceptedRevision?: number;
  startedRevision?: number;
  publishedRevision?: number;
  status: OperationSnapshot['status'];
  readonly events: Map<string, MutableEvent>;
  readonly pending: Set<string>;
  readonly committedRevisions: number[];
  readonly errors: unknown[];
  hasNonTerminalError: boolean;
  pendingPublishedRevision: number | undefined;
}

const MAX_RETAINED_OPERATIONS = 256;

/** DevTools-owned canonical operation view populated from core execution hooks. */
export class OperationCoordinator implements DevtoolsExecutionObserver {
  private nextOperationId = 0;
  private nextEventId = 0;
  private nextSequence = 0;
  private publishedRevision = 0;
  private readonly operations = new Map<string, MutableOperation>();
  private readonly runtimeInstanceId: string;

  constructor(runtimeInstanceId: string) {
    this.runtimeInstanceId = runtimeInstanceId;
  }

  accept(
    _event: OperationEventVector,
    parent?: {
      readonly operation: { readonly operationId: string; readonly value: unknown };
      readonly sourceEffectId?: string;
      readonly sourceEffectIndex?: number;
    },
  ): { operationId: string; value: unknown } {
    const parentReference = parent?.operation.value as OperationReference | undefined;
    const operationId =
      parentReference?.operationId ?? `op_${this.runtimeInstanceId}_${++this.nextOperationId}`;
    const reference: OperationReference = Object.freeze({
      operationId,
      eventInstanceId: `evt_${this.runtimeInstanceId}_${++this.nextEventId}`,
      ...(parentReference === undefined
        ? {}
        : { parentEventInstanceId: parentReference.eventInstanceId }),
      ...(parent?.sourceEffectId === undefined ? {} : { sourceEffectId: parent.sourceEffectId }),
      ...(parent?.sourceEffectIndex === undefined
        ? {}
        : { sourceEffectIndex: parent.sourceEffectIndex }),
      acceptedSequence: ++this.nextSequence,
    });
    const operation = this.getOrCreate(reference);
    operation.events.set(reference.eventInstanceId, {
      reference,
      effects: [],
      status: 'queued',
    });
    operation.pending.add(reference.eventInstanceId);
    return Object.freeze({ operationId, value: reference });
  }

  queued(operationRef: { readonly value: unknown }, committedRevision: number): void {
    const { operation, event } = this.resolve(operationRef);
    operation.acceptedRevision ??= committedRevision;
    event.acceptedRevision = committedRevision;
  }

  started(operationRef: { readonly value: unknown }, committedRevision: number): void {
    const { operation, event } = this.resolve(operationRef);
    if (operation.status === 'queued') operation.status = 'running';
    operation.startedRevision ??= committedRevision;
    event.startedRevision = committedRevision;
    event.status = 'running';
  }

  transition(operationRef: { readonly value: unknown }, status: string, error?: unknown): void {
    const { operation, event } = this.resolve(operationRef);
    if (status === 'failed' || status === 'missing-handler') {
      operation.status = 'failed';
      event.status = 'failed';
      this.recordError(operation, error);
    } else if (status !== 'completed') {
      operation.hasNonTerminalError = true;
      this.recordError(operation, error);
    }
  }

  committed(operationRef: { readonly value: unknown }, status: string, revision: number): void {
    if (status !== 'committed') return;
    const { operation, event } = this.resolve(operationRef);
    operation.committedRevisions.push(revision);
    event.committedRevision = revision;
    if (revision > this.publishedRevision)
      operation.pendingPublishedRevision = Math.max(
        operation.pendingPublishedRevision ?? 0,
        revision,
      );
  }

  effect(operationRef: { readonly value: unknown }, effect: DevtoolsEffectFact): void {
    const { operation, event } = this.resolve(operationRef);
    event.effects.push(
      Object.freeze({
        id: effect.type,
        index: effect.index,
        value: snapshotValue(effect.value),
        status: effect.status,
        durationMs: effect.durationMs,
        ...(effect.error === undefined ? {} : { error: snapshotValue(effect.error) }),
      }),
    );
    if (!['failed', 'invalid', 'unhandled'].includes(effect.status)) return;
    operation.hasNonTerminalError = true;
    this.recordError(operation, effect.error);
    // A detached effect can fail after its operation settled. Re-settle so the
    // status reflects the recorded error instead of staying `completed`; while
    // events are still pending this is a no-op and `finished` settles as usual.
    this.settle(operation);
  }

  finished(operationRef: { readonly value: unknown }, status: string, error?: unknown): void {
    const { operation, event } = this.resolve(operationRef);
    operation.pending.delete(event.reference.eventInstanceId);
    if (status === 'failed') {
      operation.status = 'failed';
      event.status = 'failed';
      this.recordError(operation, error);
    } else if (status === 'rejected') {
      operation.status = 'rejected';
      event.status = 'rejected';
      this.recordError(operation, error);
    } else if (event.status !== 'failed') {
      event.status = 'completed';
      this.settle(operation);
    }
    this.prune();
  }

  dropped(operationRefs: readonly { readonly value: unknown }[], error: unknown): void {
    for (const ref of operationRefs) {
      const { operation, event } = this.resolve(ref);
      operation.pending.delete(event.reference.eventInstanceId);
      operation.status = 'failed';
      event.status = 'dropped';
      this.recordError(operation, error);
    }
    this.prune();
  }

  published(revision: number): void {
    this.publishedRevision = Math.max(this.publishedRevision, revision);
    for (const operation of this.operations.values()) {
      if (
        operation.pendingPublishedRevision !== undefined &&
        operation.pendingPublishedRevision <= revision
      ) {
        operation.pendingPublishedRevision = undefined;
        operation.publishedRevision = revision;
        this.settle(operation);
      }
    }
    this.prune();
  }

  disposed(error: unknown): void {
    for (const operation of this.operations.values()) {
      if (this.isTerminal(operation.status)) continue;
      operation.status = 'failed';
      operation.pending.clear();
      operation.pendingPublishedRevision = undefined;
      this.recordError(operation, error);
      for (const event of operation.events.values()) {
        if (event.status === 'queued' || event.status === 'running') event.status = 'dropped';
      }
    }
    this.prune();
  }

  get(operationId: string): OperationSnapshot | undefined {
    const operation = this.operations.get(operationId);
    if (!operation) return undefined;
    return Object.freeze({
      operationId: operation.operationId,
      rootEventInstanceId: operation.rootEventInstanceId,
      acceptedSequence: operation.acceptedSequence,
      ...(operation.acceptedRevision === undefined
        ? {}
        : { acceptedRevision: operation.acceptedRevision }),
      ...(operation.startedRevision === undefined
        ? {}
        : { startedRevision: operation.startedRevision }),
      ...(operation.publishedRevision === undefined
        ? {}
        : { publishedRevision: operation.publishedRevision }),
      status: operation.status,
      eventInstanceIds: Object.freeze([...operation.events.keys()]),
      events: Object.freeze(
        [...operation.events.values()].map((event) =>
          Object.freeze({
            eventInstanceId: event.reference.eventInstanceId,
            ...(event.reference.parentEventInstanceId === undefined
              ? {}
              : { parentEventInstanceId: event.reference.parentEventInstanceId }),
            ...(event.reference.sourceEffectId === undefined
              ? {}
              : { sourceEffectId: event.reference.sourceEffectId }),
            ...(event.reference.sourceEffectIndex === undefined
              ? {}
              : { sourceEffectIndex: event.reference.sourceEffectIndex }),
            acceptedSequence: event.reference.acceptedSequence,
            ...(event.acceptedRevision === undefined
              ? {}
              : { acceptedRevision: event.acceptedRevision }),
            ...(event.startedRevision === undefined
              ? {}
              : { startedRevision: event.startedRevision }),
            ...(event.committedRevision === undefined
              ? {}
              : { committedRevision: event.committedRevision }),
            status: event.status,
            effects: Object.freeze([...event.effects]),
          }),
        ),
      ),
      pendingEventInstanceIds: Object.freeze([...operation.pending]),
      ...(operation.pendingPublishedRevision === undefined
        ? {}
        : { pendingPublishedRevision: operation.pendingPublishedRevision }),
      committedRevisions: Object.freeze([...operation.committedRevisions]),
      errors: Object.freeze([...operation.errors]),
    });
  }

  private getOrCreate(reference: OperationReference): MutableOperation {
    const existing = this.operations.get(reference.operationId);
    if (existing) return existing;
    const operation: MutableOperation = {
      operationId: reference.operationId,
      rootEventInstanceId: reference.eventInstanceId,
      acceptedSequence: reference.acceptedSequence,
      status: 'queued',
      events: new Map(),
      pending: new Set(),
      committedRevisions: [],
      errors: [],
      hasNonTerminalError: false,
      pendingPublishedRevision: undefined,
    };
    this.operations.set(operation.operationId, operation);
    return operation;
  }

  private resolve(operationRef: { readonly value: unknown }): {
    operation: MutableOperation;
    event: MutableEvent;
  } {
    return this.resolveReference(operationRef.value as OperationReference);
  }

  private resolveReference(reference: OperationReference): {
    operation: MutableOperation;
    event: MutableEvent;
  } {
    const operation = this.operations.get(reference.operationId);
    const event = operation?.events.get(reference.eventInstanceId);
    if (!operation || !event)
      throw new Error('[Uklad Devtools] operation observer received an unknown event.');
    return { operation, event };
  }

  private settle(operation: MutableOperation): void {
    if (operation.status === 'failed' || operation.status === 'rejected') return;
    if (operation.pending.size > 0) return;
    if (operation.pendingPublishedRevision !== undefined) {
      operation.status = 'publishing';
      return;
    }
    operation.status = operation.hasNonTerminalError ? 'completed-with-errors' : 'completed';
  }

  private recordError(operation: MutableOperation, error: unknown): void {
    if (error !== undefined) operation.errors.push(snapshotValue(error));
  }

  private isTerminal(status: OperationSnapshot['status']): boolean {
    return ['completed', 'completed-with-errors', 'rejected', 'failed'].includes(status);
  }

  private prune(): void {
    while (this.operations.size > MAX_RETAINED_OPERATIONS) {
      const firstTerminal = [...this.operations.values()].find((operation) =>
        this.isTerminal(operation.status),
      );
      if (!firstTerminal) return;
      this.operations.delete(firstTerminal.operationId);
    }
  }
}

/** Copy diagnostic values before retaining them in a DevTools operation snapshot. */
function snapshotValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function')
    return `[Function ${(value as { name?: string }).name || 'anonymous'}]`;

  const object = value as object;
  const existing = seen.get(object);
  if (existing !== undefined) return existing;
  if (value instanceof Error) {
    return Object.freeze({
      $type: value.name,
      message: value.message,
      ...(typeof value.stack === 'string' ? { stack: value.stack } : {}),
    });
  }
  if (value instanceof Date) return Object.freeze({ $type: 'Date', value: value.toISOString() });
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(object, copy);
    for (const item of value) copy.push(snapshotValue(item, seen));
    return Object.freeze(copy);
  }

  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null)
    return Object.freeze({ $type: prototype?.constructor?.name ?? 'Object' });

  const copy: Record<string, unknown> = {};
  seen.set(object, copy);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = snapshotValue(child, seen);
  }
  return Object.freeze(copy);
}
