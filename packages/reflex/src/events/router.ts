import { IS_DEV } from '../core/environment';
import { consoleLog } from '../core/logging';
import { scheduleAfterRender, scheduleNextTick } from '../core/scheduling';
import { isEventVector } from '../core/validation';
import { flushSubscriptionsForRuntime } from '../runtime/app-db';
import { isRuntimeDisposed, type RuntimeScope } from '../runtime/scope';
import { assertPublicationAllowedForRuntime } from '../runtime/subscriptions/engine';
import { registerBuiltInEffectsForRuntime } from './effects';
import {
  getHandlingEventIdForRuntime,
  getRunningHandlerEventIdForRuntime,
  handleForRuntime,
} from './pipeline';

import type { DispatchVector, EventVector } from '../types';

type FsmState = 'idle' | 'scheduled' | 'running' | 'paused';
type FsmTrigger = 'add-event' | 'run-queue' | 'pause' | 'exception' | 'finish-run' | 'resume';
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
  private disposed = false;

  constructor(eventHandler: (event: EventVector) => void) {
    this.eventHandler = eventHandler;
  }

  push(event: EventVector): void {
    this.fsmTrigger('add-event', event);
  }

  purge(): void {
    this.queue = [];
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
    this.queue = [];
    this.fsmState = 'idle';
    this.settleIdle(new Error('[reflex] Runtime disposed before its event queue became idle.'));
  }

  private fsmTrigger(trigger: 'add-event', argument: EventVector): void;
  private fsmTrigger(trigger: 'pause', argument: ScheduleFunction): void;
  private fsmTrigger(trigger: 'exception', argument: unknown): void;
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
      case 'running:exception':
        nextState = 'idle';
        action = () => this.handleException(argument);
        break;
      case 'running:finish-run':
        if (this.queue.length === 0) {
          nextState = 'idle';
          action = () => this.settleIdle();
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
      this.fsmTrigger('exception', error);
      return false;
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

  private handleException(error: unknown): void {
    const failedEvent = this.queue[0];
    const droppedEventIds = this.queue.slice(1).map((event) => event[0]);
    this.purge();
    consoleLog('error', '[reflex] event processing exception:', error);

    if (droppedEventIds.length > 0) {
      consoleLog(
        'error',
        `[reflex] event queue purged: ${droppedEventIds.length} pending event(s) dropped because '${String(failedEvent?.[0])}' threw:`,
        droppedEventIds,
      );
    }
    this.pendingError = this.idleWaiters.length === 0 ? error : undefined;
    this.settleIdle(error);
  }

  private pause(schedule: ScheduleFunction): void {
    schedule(() => this.fsmTrigger('resume'));
  }

  private resume(): void {
    if (!this.processFirstEvent()) return;
    this.runQueue();
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

function getEventQueue(runtime: RuntimeScope): EventQueue {
  return (runtime.eventQueue ??= new EventQueue((event) => handleForRuntime(runtime, event)));
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

  getEventQueue(runtime).push(event);
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

/** @internal Stop one runtime's event queue. */
export function disposeEventQueueForRuntime(runtime: RuntimeScope): void {
  getEventQueue(runtime).dispose();
}

/** @internal Install dispatch-dependent framework effects in one runtime. */
export function initializeEventRouterForRuntime(runtime: RuntimeScope): void {
  registerBuiltInEffectsForRuntime(runtime, (event) => dispatchForRuntime(runtime, event));
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
