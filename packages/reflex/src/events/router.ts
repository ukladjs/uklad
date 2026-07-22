import { IS_DEV } from '../core/environment';
import { consoleLog } from '../core/logging';
import { scheduleAfterRender, scheduleNextTick } from '../core/scheduling';
import { isEventVector } from '../core/validation';
import { flushSubscriptionsForKernel } from '../runtime/state';
import { isRuntimeDisposed, type RuntimeKernel } from '../runtime/kernel';
import { notifyRuntimeLifecycleForKernel } from '../runtime/lifecycle';
import { cloneStructuredValue } from '../runtime/ownership';
import { assertPublicationAllowedForKernel } from '../runtime/subscriptions/engine';
import { registerBuiltInEffectsForKernel } from './effects';
import {
  getHandlingEventIdForKernel,
  getRunningHandlerEventIdForKernel,
  handleForKernel,
} from './pipeline';

import type { DispatchVector, EventVector } from '../types';

type FsmState = 'idle' | 'scheduled' | 'running' | 'paused';
type FsmTrigger = 'add-event' | 'run-queue' | 'pause' | 'finish-run' | 'resume';
type ScheduleFunction = (callback: () => void) => void;
type EventSchedulingMetadata = Partial<Record<'flush' | 'yield', boolean>>;
type ScheduledEventVector = EventVector & { meta?: EventSchedulingMetadata };

const eventSchedulers = new Map<string, ScheduleFunction>([
  ['flush', scheduleAfterRender],
  ['yield', scheduleNextTick],
]);

/** @internal Event queue finite-state machine. */
export class EventQueue {
  private fsmState: FsmState = 'idle';
  private queue: EventVector[] = [];
  private readonly eventHandler: (event: EventVector) => void;
  private idleWaiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private pendingError: unknown;
  private runError: unknown;
  private disposed = false;
  private readonly onDrop: (
    events: readonly EventVector[],
    reason: 'queue-dropped' | 'disposed',
    error: unknown,
  ) => void;

  constructor(
    eventHandler: (event: EventVector) => void,
    onDrop: (
      events: readonly EventVector[],
      reason: 'queue-dropped' | 'disposed',
      error: unknown,
    ) => void = () => {},
  ) {
    this.eventHandler = eventHandler;
    this.onDrop = onDrop;
  }

  push(event: EventVector): void {
    this.fsmTrigger('add-event', event);
  }

  purge(): void {
    const dropped = this.queue;
    this.queue = [];
    if (dropped.length > 0) {
      this.onDrop(dropped, 'queue-dropped', new Error('[reflex] Event queue was purged.'));
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
    const dropped = this.queue;
    this.queue = [];
    this.fsmState = 'idle';
    const error = new Error('[reflex] Runtime disposed before its event queue became idle.');
    if (dropped.length > 0) this.onDrop(dropped, 'disposed', error);
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

function getEventQueue(runtime: RuntimeKernel): EventQueue {
  return (runtime.eventQueue ??= new EventQueue(
    (event) => handleForKernel(runtime, event),
    (events, reason, error) =>
      notifyRuntimeLifecycleForKernel(runtime, 'onEventDropped', events, reason, error),
  ));
}

/** @internal Dispatch an event asynchronously in one runtime. */
export function dispatchForKernel(runtime: RuntimeKernel, event: DispatchVector): void {
  if (isRuntimeDisposed(runtime)) return;
  if (!isEventVector(event)) {
    consoleLog('error', '[reflex] invalid dispatch event vector.');
    return;
  }

  if (IS_DEV) {
    const handlerId = getRunningHandlerEventIdForKernel(runtime);
    if (handlerId !== null) {
      consoleLog(
        'warn',
        `[reflex] dispatch called for '${String(event[0])}' from inside the event handler for '${handlerId}'. Event handlers must stay pure — return a ['dispatch', [...]] effect instead. The event was queued anyway.`,
      );
    }
  }

  notifyRuntimeLifecycleForKernel(runtime, 'onEventQueued', event as EventVector);
  getEventQueue(runtime).push(event);
}

/** @internal Take ownership of caller input before accepting it into a runtime queue. */
export function dispatchOwnedForKernel(runtime: RuntimeKernel, event: DispatchVector): void {
  if (!isEventVector(event)) {
    dispatchForKernel(runtime, event);
    return;
  }
  dispatchForKernel(runtime, cloneAcceptedEvent(event));
}

/** @internal Dispatch and publish synchronously in one runtime. */
export function dispatchSyncForKernel(runtime: RuntimeKernel, event: DispatchVector): void {
  if (isRuntimeDisposed(runtime)) {
    throw new Error(`[reflex] Runtime '${runtime.runtimeId}' has been disposed.`);
  }
  if (!isEventVector(event)) {
    consoleLog('error', '[reflex] invalid dispatchSync event vector.');
    return;
  }

  const handlingId = getHandlingEventIdForKernel(runtime);
  if (handlingId !== null) {
    const message = `[reflex] dispatchSync called for '${String(event[0])}' while event '${handlingId}' is being handled. dispatchSync must not be called from an event handler; return a ['dispatch', ...] effect instead.`;
    consoleLog('error', message);
    throw new Error(message);
  }
  if (!isEventQueueIdleForKernel(runtime)) {
    throw new Error(
      `[reflex] dispatchSync cannot overtake asynchronous work already accepted by runtime '${runtime.runtimeId}'. Await runtime.flush() first.`,
    );
  }

  assertPublicationAllowedForKernel(runtime);
  handleForKernel(runtime, event);
  flushSubscriptionsForKernel(runtime);
}

/** @internal Wait for one runtime's accepted queue work and publish its state head. */
export async function flushRuntime(runtime: RuntimeKernel): Promise<void> {
  if (isRuntimeDisposed(runtime)) {
    throw new Error(`[reflex] Runtime '${runtime.runtimeId}' has been disposed.`);
  }
  await getEventQueue(runtime).whenIdle();
  flushSubscriptionsForKernel(runtime);
}

/** @internal Return whether one runtime's event queue is idle. */
export function isEventQueueIdleForKernel(runtime: RuntimeKernel): boolean {
  return getEventQueue(runtime).getState() === 'idle';
}

/** @internal Return whether one runtime is synchronously processing queue work. */
export function isEventQueueRunningForKernel(runtime: RuntimeKernel): boolean {
  return getEventQueue(runtime).getState() === 'running';
}

/** @internal Stop one runtime's event queue. */
export function disposeEventQueueForKernel(runtime: RuntimeKernel): void {
  getEventQueue(runtime).dispose();
}

/** @internal Install dispatch-dependent framework effects in one runtime. */
export function initializeEventRouterForKernel(runtime: RuntimeKernel): void {
  registerBuiltInEffectsForKernel(runtime, (event) => dispatchOwnedForKernel(runtime, event));
}

function cloneAcceptedEvent(event: DispatchVector): DispatchVector {
  try {
    const clonedEvent = cloneStructuredValue(event) as DispatchVector;
    const metadata = (event as ScheduledEventVector).meta;
    if (metadata !== undefined)
      (clonedEvent as ScheduledEventVector).meta = cloneStructuredValue(metadata);
    return clonedEvent;
  } catch (error: unknown) {
    throw new Error('[reflex] event input must be structured-cloneable so the runtime owns it.', {
      cause: error,
    });
  }
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
