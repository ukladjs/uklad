import type { EventVector, ReflexRuntime, SubVector } from '@flexsurfer/reflex';

import type {
  OperationClient,
  OperationEffectResult,
  OperationError,
  OperationEventStateStatus,
  OperationEventStatus,
  OperationExecutionContext,
  OperationObservationResult,
  OperationOutcome,
  OperationPatch,
  OperationStatus,
} from './types.js';

export interface MutableEvent {
  eventInstanceId: string;
  parentEventInstanceId: string | null;
  event: EventVector;
  status: OperationEventStatus;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  state: {
    status: OperationEventStateStatus;
    fromRevision: number;
    committedRevision: number | null;
    plannedPatches: OperationPatch[];
    committedPatches: OperationPatch[];
    truncated: boolean;
  };
  plannedDb: unknown;
  effectIds: string[];
  errors: OperationError[];
}

export interface MutableOperation {
  operationId: string;
  fingerprint: string;
  idempotencyKey: string | null;
  status: OperationStatus;
  outcome: OperationOutcome;
  acceptedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  rootEventInstanceId: string;
  completionBoundary: 'cascade-published';
  executionContext: OperationExecutionContext;
  acceptedRevision: number;
  expectedRevision: number | null;
  rootStartRevision: number | null;
  lastCommittedRevision: number | null;
  committedRevisions: number[];
  publishedRevision: number;
  observedRevision: number;
  pendingEvents: number;
  events: MutableEvent[];
  effects: OperationEffectResult[];
  observations: OperationObservationResult[];
  errors: OperationError[];
  requestedObservations: readonly SubVector[];
  eventsTruncated: boolean;
  effectsTruncated: boolean;
  errorsTruncated: boolean;
  terminal: boolean;
  readyToPublish: boolean;
  completionPromise: Promise<void>;
  resolveCompletion: () => void;
}

export interface EventMetadata {
  readonly operation: MutableOperation;
  readonly eventInstanceId: string;
  readonly eventRecord: MutableEvent | null;
}

export interface OperationState {
  nextOperationId: number;
  nextEventInstanceId: number;
  nextEffectId: number;
  knownPublishedRevision: number;
  operations: Map<string, MutableOperation>;
  idempotencyKeys: Map<string, string>;
  eventMetadata: WeakMap<EventVector, EventMetadata>;
  currentEvent: EventMetadata | null;
  pendingRoot: EventMetadata | null;
  client: OperationClient | undefined;
}

const states = new WeakMap<object, OperationState>();

export function getState(runtime: ReflexRuntime<any>): OperationState {
  let state = states.get(runtime);
  if (!state) {
    const revisions = runtime.getStateRevisions();
    state = {
      nextOperationId: 0,
      nextEventInstanceId: 0,
      nextEffectId: 0,
      knownPublishedRevision: revisions.publishedRevision,
      operations: new Map(),
      idempotencyKeys: new Map(),
      eventMetadata: new WeakMap(),
      currentEvent: null,
      pendingRoot: null,
      client: undefined,
    };
    states.set(runtime, state);
  }
  return state;
}
