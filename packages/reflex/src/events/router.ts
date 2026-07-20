import { IS_DEV } from '../core/environment';
import { consoleLog } from '../core/logging';
import { scheduleAfterRender, scheduleNextTick } from '../core/scheduling';
import { isEventVector } from '../core/validation';
import { flushSubscriptionsForRuntime } from '../runtime/app-db';
import { cloneStructuredValue } from '../runtime/ownership';
import {
  beginOperationEventForRuntime,
  createOperationDispatchForRuntime,
  dropOperationEventsForRuntime,
  finalizeOperationForRuntime,
  finishOperationEventForRuntime,
  prepareOperationChildDispatchForRuntime,
} from '../runtime/operations';
import { defaultRuntimeScope, isRuntimeDisposed, type RuntimeScope } from '../runtime/scope';
import { assertPublicationAllowedForRuntime } from '../runtime/subscriptions/engine';
import { hasHandlerForRuntime } from '../runtime/handlers';
import { getSubscriptionValueForRuntime } from '../subscriptions/queries';
import { registerBuiltInEffectsForRuntime } from './effects';
import {
  getHandlingEventIdForRuntime,
  getRunningHandlerEventIdForRuntime,
  handleForRuntime,
} from './pipeline';

import type {
  DispatchAndWaitOptions,
  OperationHandle,
  OperationWaitResult,
} from '../runtime/operations';
import type { DispatchVector, EventVector } from '../types';

type FsmState = 'idle' | 'scheduled' | 'running' | 'paused';
type FsmTrigger = 'add-event' | 'run-queue' | 'pause' | 'finish-run' | 'resume';
type ScheduleFunction = (callback: () => void) => void;
type EventSchedulingMetadata = Partial<Record<'flush' | 'yield', boolean>>;
type ScheduledEventVector = EventVector & { meta?: EventSchedulingMetadata };

export type EventQueueDropReason = 'queue-dropped' | 'disposed';
export type EventQueueDropHandler = (
  events: readonly EventVector[],
  reason: EventQueueDropReason,
  cause: unknown,
) => void;

const eventSchedulers = new Map<string, ScheduleFunction>([
  ['flush', scheduleAfterRender],
  ['yield', scheduleNextTick],
]);

/** @internal Event queue finite-state machine. */
export class EventQueue {
  private fsmState: FsmState = 'idle';
  private queue: EventVector[] = [];
  private readonly eventHandler: (event: EventVector) => void;
  private readonly dropHandler: EventQueueDropHandler | undefined;
  private idleWaiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private pendingError: unknown;
  private runError: unknown;
  private disposed = false;

  constructor(eventHandler: (event: EventVector) => void, dropHandler?: EventQueueDropHandler) {
    this.eventHandler = eventHandler;
    this.dropHandler = dropHandler;
  }

  push(event: EventVector): void {
    this.fsmTrigger('add-event', event);
  }

  purge(): void {
    const droppedEvents = this.queue;
    this.queue = [];
    if (droppedEvents.length > 0) {
      this.dropHandler?.(
        droppedEvents,
        'queue-dropped',
        new Error('[reflex] Event queue was purged before processing completed.'),
      );
    }
  }

  getState(): FsmState {
    return this.fsmState;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  /** Resolve at the next idle boundary, rejecting if queue processing failed. */
  whenIdle(): Promise<void> {
    const pendingError = this.pendingError;
    this.pendingError = undefined;
    if (this.fsmState === 'idle') {
      if (pendingError !== undefined) return Promise.reject(pendingError);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.idleWaiters.push({
        resolve: pendingError === undefined ? resolve : () => reject(pendingError),
        reject,
      });
    });
  }

  /** Stop accepting events and release every idle waiter. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const droppedEvents = this.queue;
    this.queue = [];
    this.fsmState = 'idle';
    const error = new Error('[reflex] Runtime disposed before its event queue became idle.');
    if (droppedEvents.length > 0) this.dropHandler?.(droppedEvents, 'disposed', error);
    this.settleIdle(error);
  }

  private fsmTrigger(trigger: 'add-event', argument: EventVector): void;
  private fsmTrigger(trigger: 'pause', argument: ScheduleFunction): void;
  private fsmTrigger(trigger: 'run-queue' | 'finish-run' | 'resume'): void;
  private fsmTrigger(trigger: FsmTrigger, argument?: unknown): void {
    if (this.disposed) return;
    let nextState: FsmState;
    let action: (() => void) | undefined;

    switch (`${this.fsmState}:${trigger}`) {
      case 'idle:add-event':
        nextState = 'scheduled';
        action = () => {
          this.addEvent(argument as EventVector);
          this.runNextTick();
        };
        break;
      case 'scheduled:add-event':
        nextState = 'scheduled';
        action = () => this.addEvent(argument as EventVector);
        break;
      case 'scheduled:run-queue':
        nextState = 'running';
        action = () => this.runQueue();
        break;
      case 'running:add-event':
        nextState = 'running';
        action = () => this.addEvent(argument as EventVector);
        break;
      case 'running:pause':
        nextState = 'paused';
        action = () => this.pause(argument as ScheduleFunction);
        break;
      case 'running:finish-run':
        if (this.queue.length === 0) {
          nextState = 'idle';
          action = () => this.finishRun();
        } else {
          nextState = 'scheduled';
          action = () => this.runNextTick();
        }
        break;
      case 'paused:add-event':
        nextState = 'paused';
        action = () => this.addEvent(argument as EventVector);
        break;
      case 'paused:resume':
        nextState = 'running';
        action = () => this.resume();
        break;
      default:
        consoleLog(
          'error',
          `[reflex] router state transition not found. ${this.fsmState} ${trigger}`,
        );
        return;
    }

    this.fsmState = nextState;
    action?.();
  }

  private addEvent(event: EventVector): void {
    this.queue.push(event);
  }

  private processFirstEvent(): boolean {
    const event = this.queue[0];
    if (!event) return true;

    try {
      this.eventHandler(event);
      this.queue.shift();
      return true;
    } catch (error: unknown) {
      this.queue.shift();
      this.runError ??= error;
      consoleLog('error', '[reflex] event processing exception:', error);
      return true;
    }
  }

  private runNextTick(): void {
    scheduleNextTick(() => this.fsmTrigger('run-queue'));
  }

  private runQueue(): void {
    let remainingEvents = this.queue.length;
    while (remainingEvents > 0) {
      const event = this.queue[0];
      if (!event) break;

      const scheduler = getEventScheduler(event);
      if (scheduler) {
        this.fsmTrigger('pause', scheduler);
        return;
      }

      if (!this.processFirstEvent()) return;
      remainingEvents -= 1;
    }
    this.fsmTrigger('finish-run');
  }

  private pause(schedule: ScheduleFunction): void {
    schedule(() => this.fsmTrigger('resume'));
  }

  private resume(): void {
    if (!this.processFirstEvent()) return;
    this.runQueue();
  }

  private finishRun(): void {
    const error = this.runError;
    this.runError = undefined;
    if (error === undefined) {
      this.settleIdle();
      return;
    }
    this.pendingError = this.idleWaiters.length === 0 ? error : undefined;
    this.settleIdle(error);
  }

  private settleIdle(error?: unknown): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    if (error === undefined) {
      for (const waiter of waiters) waiter.resolve();
    } else {
      for (const waiter of waiters) waiter.reject(error);
    }
  }
}

const eventQueues = new WeakMap<RuntimeScope, EventQueue>();

function getEventQueue(runtime: RuntimeScope): EventQueue {
  let eventQueue = eventQueues.get(runtime);
  if (!eventQueue) {
    eventQueue = new EventQueue(
      (event) => processEventForRuntime(runtime, event),
      (events, reason, cause) => {
        const readyOperationIds = dropOperationEventsForRuntime(runtime, events, reason, cause);
        for (const operationId of readyOperationIds) {
          publishAndFinalizeOperation(runtime, operationId);
        }
      },
    );
    eventQueues.set(runtime, eventQueue);
  }
  return eventQueue;
}

/** Dispatch an event asynchronously. */
export function dispatch(event: DispatchVector): void {
  dispatchOwnedForRuntime(defaultRuntimeScope, event);
}

/** @internal Copy caller-owned input before accepting it into one runtime queue. */
export function dispatchOwnedForRuntime(runtime: RuntimeScope, event: DispatchVector): void {
  if (!isEventVector(event)) {
    dispatchForRuntime(runtime, event);
    return;
  }
  dispatchForRuntime(runtime, cloneAcceptedEvent(event));
}

/** @internal Dispatch an event asynchronously in one runtime. */
export function dispatchForRuntime(runtime: RuntimeScope, event: DispatchVector): void {
  if (isRuntimeDisposed(runtime)) return;
  if (!isEventVector(event)) {
    consoleLog('error', '[reflex] invalid dispatch event vector.');
    return;
  }

  if (IS_DEV) {
    const handlerId = getRunningHandlerEventIdForRuntime(runtime);
    if (handlerId !== null) {
      consoleLog(
        'warn',
        `[reflex] dispatch called for '${String(event[0])}' from inside the event handler for '${handlerId}'. Event handlers must stay pure — return a ['dispatch', [...]] effect instead. The event was queued anyway.`,
      );
    }
  }

  getEventQueue(runtime).push(prepareOperationChildDispatchForRuntime(runtime, event));
}

/** @internal Dispatch one authoritative tracked operation and wait for its boundary. */
export function dispatchAndWaitForRuntime(
  runtime: RuntimeScope,
  event: DispatchVector,
  options?: DispatchAndWaitOptions,
): Promise<OperationWaitResult> {
  return startOperationForRuntime(runtime, event, options).result;
}

/** @internal Start a tracked operation and return its identity before it settles. */
export function startOperationForRuntime(
  runtime: RuntimeScope,
  event: DispatchVector,
  options?: DispatchAndWaitOptions,
): OperationHandle {
  if (isRuntimeDisposed(runtime)) {
    throw new Error(`[reflex] Runtime '${runtime.runtimeId}' has been disposed.`);
  }
  if (!isEventVector(event)) {
    throw new Error(
      '[reflex] dispatchAndWait expects a non-empty event vector starting with an event id string.',
    );
  }
  const operationDispatch = createOperationDispatchForRuntime(runtime, event, options);
  if (operationDispatch.event !== event) getEventQueue(runtime).push(operationDispatch.event);
  return {
    operationId: operationDispatch.operationId,
    runtimeInstanceId: runtime.runtimeInstanceId,
    result: operationDispatch.wait,
  };
}

/**
 * Dispatch an event and publish subscription updates before returning.
 *
 * This must not be called from an event handler. Return a `dispatch` effect
 * from the handler instead.
 */
export function dispatchSync(event: DispatchVector): void {
  dispatchSyncForRuntime(defaultRuntimeScope, event);
}

/** @internal Dispatch and publish synchronously in one runtime. */
export function dispatchSyncForRuntime(runtime: RuntimeScope, event: DispatchVector): void {
  if (isRuntimeDisposed(runtime)) {
    throw new Error(`[reflex] Runtime '${runtime.runtimeId}' has been disposed.`);
  }
  if (!isEventVector(event)) {
    consoleLog('error', '[reflex] invalid dispatchSync event vector.');
    return;
  }

  const handlingId = getHandlingEventIdForRuntime(runtime);
  if (handlingId !== null) {
    const message = `[reflex] dispatchSync called for '${String(event[0])}' while event '${handlingId}' is being handled. dispatchSync must not be called from an event handler; return a ['dispatch', ...] effect instead.`;
    consoleLog('error', message);
    throw new Error(message);
  }

  if (getEventQueue(runtime).getState() !== 'idle') {
    const message = `[reflex] dispatchSync cannot overtake already accepted asynchronous work in runtime '${runtime.runtimeId}'. Await runtime.flush() before dispatchSync, or use dispatchAndWait().`;
    consoleLog('error', message);
    throw new Error(message);
  }

  assertPublicationAllowedForRuntime(runtime);
  handleForRuntime(runtime, event);
  flushSubscriptionsForRuntime(runtime);
}

/** @internal Wait for one runtime's accepted queue work and publish its db head. */
export async function flushRuntime(runtime: RuntimeScope): Promise<void> {
  if (isRuntimeDisposed(runtime)) {
    throw new Error(`[reflex] Runtime '${runtime.runtimeId}' has been disposed.`);
  }
  await getEventQueue(runtime).whenIdle();
  flushSubscriptionsForRuntime(runtime);
}

/** @internal Return whether one runtime's event queue is idle. */
export function isEventQueueIdleForRuntime(runtime: RuntimeScope): boolean {
  return getEventQueue(runtime).getState() === 'idle';
}

/** @internal Return whether one runtime is synchronously processing its queue. */
export function isEventQueueRunningForRuntime(runtime: RuntimeScope): boolean {
  return getEventQueue(runtime).getState() === 'running';
}

/** @internal Stop one runtime's event queue. */
export function disposeEventQueueForRuntime(runtime: RuntimeScope): void {
  getEventQueue(runtime).dispose();
}

/** @internal Install dispatch-dependent framework effects in one runtime. */
export function initializeEventRouterForRuntime(runtime: RuntimeScope): void {
  registerBuiltInEffectsForRuntime(runtime, (event) => dispatchOwnedForRuntime(runtime, event));
}

function processEventForRuntime(runtime: RuntimeScope, event: EventVector): void {
  const operationStart = beginOperationEventForRuntime(runtime, event);
  if (operationStart === 'untracked') {
    handleForRuntime(runtime, event);
    return;
  }
  if (operationStart === 'rejected') return;

  let didThrow = false;
  let thrownError: unknown;
  try {
    handleForRuntime(runtime, event);
  } catch (error: unknown) {
    didThrow = true;
    thrownError = error;
  }

  const readyOperationId = finishOperationEventForRuntime(
    runtime,
    event,
    didThrow ? (thrownError ?? new Error('[reflex] Event processing threw undefined.')) : undefined,
  );
  if (readyOperationId) publishAndFinalizeOperation(runtime, readyOperationId);
  if (didThrow) throw thrownError;
}

function publishAndFinalizeOperation(runtime: RuntimeScope, operationId: string): void {
  let publicationError: unknown;
  try {
    flushSubscriptionsForRuntime(runtime);
  } catch (error: unknown) {
    publicationError = error;
  }
  finalizeOperationForRuntime(
    runtime,
    operationId,
    (query) => {
      if (
        !Array.isArray(query) ||
        query.length === 0 ||
        typeof query[0] !== 'string' ||
        !hasHandlerForRuntime(runtime, 'sub', query[0])
      ) {
        throw new Error(
          `[reflex] No subscription registered for '${String(query[0])}' in runtime '${runtime.runtimeId}'.`,
        );
      }
      return getSubscriptionValueForRuntime(runtime, query);
    },
    publicationError,
  );
}

function getEventScheduler(event: EventVector): ScheduleFunction | undefined {
  const metadata = (event as ScheduledEventVector).meta;
  if (!metadata) return undefined;

  for (const key of Object.keys(metadata)) {
    const scheduler = eventSchedulers.get(key);
    if (scheduler) return scheduler;
  }
  return undefined;
}

function cloneAcceptedEvent(event: DispatchVector): DispatchVector {
  const clonedEvent = event.map(cloneAcceptedValue) as DispatchVector;
  const metadata = (event as ScheduledEventVector).meta;
  if (metadata !== undefined) {
    (clonedEvent as ScheduledEventVector).meta = cloneAcceptedValue(metadata);
  }
  return clonedEvent;
}

function cloneAcceptedValue<T>(value: T): T {
  try {
    return cloneStructuredValue(value);
  } catch (error: unknown) {
    throw new Error(
      '[reflex] Dispatch payloads must be structured-cloneable so accepted input cannot be mutated later.',
      { cause: error },
    );
  }
}

// Compatibility APIs can import this module without constructing defaultRuntime.
// Install dispatch-dependent effects for the default scope after dispatch exists.
initializeEventRouterForRuntime(defaultRuntimeScope);
