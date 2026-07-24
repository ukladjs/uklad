import type {
  DevtoolsExecutionObserver,
  DevtoolsLifecycleEffect,
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
  private readonly activeEvents: OperationReference[] = [];
  private readonly runtimeInstanceId: string;

  constructor(runtimeInstanceId: string) {
    this.runtimeInstanceId = runtimeInstanceId;
  }

  accept(_event: OperationEventVector, parent?: {
    readonly operation: { readonly operationId: string; readonly value: unknown };
    readonly sourceEffectId?: string;
    readonly sourceEffectIndex?: number;
  }): { operationId: string; value: unknown } {
    const parentReference = parent?.operation.value as OperationReference | undefined;
    const operationId = parentReference?.operationId ?? `op_${this.runtimeInstanceId}_${++this.nextOperationId}`;
    const reference: OperationReference = Object.freeze({
      operationId,
      eventInstanceId: `evt_${this.runtimeInstanceId}_${++this.nextEventId}`,
      ...(parentReference === undefined ? {} : { parentEventInstanceId: parentReference.eventInstanceId }),
      ...(parent?.sourceEffectId === undefined ? {} : { sourceEffectId: parent.sourceEffectId }),
      ...(parent?.sourceEffectIndex === undefined ? {} : { sourceEffectIndex: parent.sourceEffectIndex }),
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
    this.activeEvents.push(event.reference);
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
      operation.pendingPublishedRevision = Math.max(operation.pendingPublishedRevision ?? 0, revision);
  }

  onEffect(effect: DevtoolsLifecycleEffect): void {
    const reference = this.activeEvents.at(-1);
    if (!reference) return;
    const { operation, event } = this.resolveReference(reference);
    event.effects.push(Object.freeze({
      id: effect.type,
      index: effect.index,
      value: effect.value,
      status: effect.status,
      durationMs: effect.durationMs,
      ...(effect.error === undefined ? {} : { error: effect.error }),
    }));
    if (!['failed', 'invalid', 'unhandled'].includes(effect.status)) return;
    operation.hasNonTerminalError = true;
    this.recordError(operation, effect.error);
  }

  finished(operationRef: { readonly value: unknown }, status: string, error?: unknown): void {
    const { operation, event } = this.resolve(operationRef);
    this.removeActiveEvent(event.reference);
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
      if (operation.pendingPublishedRevision !== undefined && operation.pendingPublishedRevision <= revision) {
        operation.pendingPublishedRevision = undefined;
        operation.publishedRevision = revision;
        this.settle(operation);
      }
    }
    this.prune();
  }

  disposed(error: unknown): void {
    this.activeEvents.length = 0;
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
      ...(operation.acceptedRevision === undefined ? {} : { acceptedRevision: operation.acceptedRevision }),
      ...(operation.startedRevision === undefined ? {} : { startedRevision: operation.startedRevision }),
      ...(operation.publishedRevision === undefined ? {} : { publishedRevision: operation.publishedRevision }),
      status: operation.status,
      eventInstanceIds: Object.freeze([...operation.events.keys()]),
      events: Object.freeze([...operation.events.values()].map((event) => Object.freeze({
        eventInstanceId: event.reference.eventInstanceId,
        ...(event.reference.parentEventInstanceId === undefined ? {} : { parentEventInstanceId: event.reference.parentEventInstanceId }),
        ...(event.reference.sourceEffectId === undefined ? {} : { sourceEffectId: event.reference.sourceEffectId }),
        ...(event.reference.sourceEffectIndex === undefined ? {} : { sourceEffectIndex: event.reference.sourceEffectIndex }),
        acceptedSequence: event.reference.acceptedSequence,
        ...(event.acceptedRevision === undefined ? {} : { acceptedRevision: event.acceptedRevision }),
        ...(event.startedRevision === undefined ? {} : { startedRevision: event.startedRevision }),
        ...(event.committedRevision === undefined ? {} : { committedRevision: event.committedRevision }),
        status: event.status,
        effects: Object.freeze([...event.effects]),
      }))),
      pendingEventInstanceIds: Object.freeze([...operation.pending]),
      ...(operation.pendingPublishedRevision === undefined ? {} : { pendingPublishedRevision: operation.pendingPublishedRevision }),
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

  private resolve(operationRef: { readonly value: unknown }): { operation: MutableOperation; event: MutableEvent } {
    return this.resolveReference(operationRef.value as OperationReference);
  }

  private resolveReference(reference: OperationReference): { operation: MutableOperation; event: MutableEvent } {
    const operation = this.operations.get(reference.operationId);
    const event = operation?.events.get(reference.eventInstanceId);
    if (!operation || !event) throw new Error('[Reflex Devtools] operation observer received an unknown event.');
    return { operation, event };
  }

  private removeActiveEvent(reference: OperationReference): void {
    const index = this.activeEvents.findLastIndex(
      (active) => active.eventInstanceId === reference.eventInstanceId,
    );
    if (index !== -1) this.activeEvents.splice(index, 1);
  }

  private settle(operation: MutableOperation): void {
    if (operation.status === 'failed' || operation.status === 'rejected') return;
    if (operation.pending.size > 0 || operation.pendingPublishedRevision !== undefined) return;
    operation.status = operation.hasNonTerminalError ? 'completed-with-errors' : 'completed';
  }

  private recordError(operation: MutableOperation, error: unknown): void {
    if (error !== undefined) operation.errors.push(error);
  }

  private isTerminal(status: OperationSnapshot['status']): boolean {
    return ['completed', 'completed-with-errors', 'rejected', 'failed'].includes(status);
  }

  private prune(): void {
    while (this.operations.size > MAX_RETAINED_OPERATIONS) {
      const firstTerminal = [...this.operations.values()].find((operation) => this.isTerminal(operation.status));
      if (!firstTerminal) return;
      this.operations.delete(firstTerminal.operationId);
    }
  }
}
