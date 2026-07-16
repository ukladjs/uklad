import { IS_DEV } from '../core/environment';
import { consoleLog } from '../core/logging';
import { scheduleAfterRender, scheduleNextTick } from '../core/scheduling';
import { isEventVector } from '../core/validation';
import { flushSubscriptions } from '../runtime/app-db';
import { assertPublicationAllowed } from '../runtime/subscriptions/engine';
import { registerBuiltInEffects } from './effects';
import { getHandlingEventId, getRunningHandlerEventId, handle } from './pipeline';

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
  private eventHandler: (event: EventVector) => void;

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

  private fsmTrigger(trigger: 'add-event', argument: EventVector): void;
  private fsmTrigger(trigger: 'pause', argument: ScheduleFunction): void;
  private fsmTrigger(trigger: 'exception', argument: unknown): void;
  private fsmTrigger(trigger: 'run-queue' | 'finish-run' | 'resume'): void;
  private fsmTrigger(trigger: FsmTrigger, argument?: unknown): void {
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

  private processFirstEvent(): void {
    const event = this.queue[0];
    if (!event) return;

    try {
      this.eventHandler(event);
      this.queue.shift();
    } catch (error: unknown) {
      this.fsmTrigger('exception', error);
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

      this.processFirstEvent();
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
  }

  private pause(schedule: ScheduleFunction): void {
    schedule(() => this.fsmTrigger('resume'));
  }

  private resume(): void {
    this.processFirstEvent();
    this.runQueue();
  }
}

const eventQueue = new EventQueue(handle);

/** Dispatch an event asynchronously. */
export function dispatch(event: DispatchVector): void {
  if (!isEventVector(event)) {
    consoleLog('error', '[reflex] invalid dispatch event vector.');
    return;
  }

  if (IS_DEV) {
    const handlerId = getRunningHandlerEventId();
    if (handlerId !== null) {
      consoleLog(
        'warn',
        `[reflex] dispatch called for '${String(event[0])}' from inside the event handler for '${handlerId}'. Event handlers must stay pure — return a ['dispatch', [...]] effect instead. The event was queued anyway.`,
      );
    }
  }

  eventQueue.push(event);
}

/**
 * Dispatch an event and publish subscription updates before returning.
 *
 * This must not be called from an event handler. Return a `dispatch` effect
 * from the handler instead.
 */
export function dispatchSync(event: DispatchVector): void {
  if (!isEventVector(event)) {
    consoleLog('error', '[reflex] invalid dispatchSync event vector.');
    return;
  }

  const handlingId = getHandlingEventId();
  if (handlingId !== null) {
    const message = `[reflex] dispatchSync called for '${String(event[0])}' while event '${handlingId}' is being handled. dispatchSync must not be called from an event handler; return a ['dispatch', ...] effect instead.`;
    consoleLog('error', message);
    throw new Error(message);
  }

  assertPublicationAllowed();
  handle(event);
  flushSubscriptions();
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

// Bind dispatch-dependent built-ins at module evaluation after dispatch exists,
// avoiding an effects -> router initialization cycle.
registerBuiltInEffects(dispatch);
