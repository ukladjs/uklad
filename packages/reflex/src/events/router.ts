import { consoleLog } from '../core/logging';
import { scheduleAfterRender, scheduleNextTick } from '../core/scheduling';

import type { EventVector } from '../types';

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
export class EventQueue<WorkItem = EventVector> {
  private fsmState: FsmState = 'idle';
  private queue: WorkItem[] = [];
  private queueHead = 0;
  private readonly eventHandler: (item: WorkItem) => void;
  private idleWaiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private pendingError: unknown;
  private runError: unknown;
  private disposed = false;
  private readonly onDrop: (
    items: readonly WorkItem[],
    reason: 'queue-dropped' | 'disposed',
    error: unknown,
  ) => void;
  private readonly getScheduler: (item: WorkItem) => ScheduleFunction | undefined;

  constructor(
    eventHandler: (item: WorkItem) => void,
    onDrop: (
      items: readonly WorkItem[],
      reason: 'queue-dropped' | 'disposed',
      error: unknown,
    ) => void = () => {},
    getScheduler: (item: WorkItem) => ScheduleFunction | undefined = (item) =>
      getEventScheduler(item as EventVector),
  ) {
    this.eventHandler = eventHandler;
    this.onDrop = onDrop;
    this.getScheduler = getScheduler;
  }

  push(item: WorkItem): void {
    this.fsmTrigger('add-event', item);
  }

  purge(): void {
    const dropped = this.queue.slice(this.queueHead);
    this.queue = [];
    this.queueHead = 0;
    if (dropped.length > 0) {
      this.onDrop(dropped, 'queue-dropped', new Error('[reflex] Event queue was purged.'));
    }
  }

  getState(): FsmState {
    return this.fsmState;
  }
  getQueueLength(): number {
    return this.queue.length - this.queueHead;
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
    const dropped = this.queue.slice(this.queueHead);
    this.queue = [];
    this.queueHead = 0;
    this.fsmState = 'idle';
    const error = new Error('[reflex] Runtime disposed before its event queue became idle.');
    if (dropped.length > 0) this.onDrop(dropped, 'disposed', error);
    this.settleIdle(error);
  }

  private fsmTrigger(trigger: 'add-event', argument: WorkItem): void;
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
          this.addEvent(argument as WorkItem);
          this.runNextTick();
        };
        break;
      case 'scheduled:add-event':
        nextState = 'scheduled';
        action = () => this.addEvent(argument as WorkItem);
        break;
      case 'scheduled:run-queue':
        nextState = 'running';
        action = () => this.runQueue();
        break;
      case 'running:add-event':
        nextState = 'running';
        action = () => this.addEvent(argument as WorkItem);
        break;
      case 'running:pause':
        nextState = 'paused';
        action = () => this.pause(argument as ScheduleFunction);
        break;
      case 'running:finish-run':
        if (this.getQueueLength() === 0) {
          nextState = 'idle';
          action = () => this.finishRun();
        } else {
          nextState = 'scheduled';
          action = () => this.runNextTick();
        }
        break;
      case 'paused:add-event':
        nextState = 'paused';
        action = () => this.addEvent(argument as WorkItem);
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

  private addEvent(item: WorkItem): void {
    this.queue.push(item);
  }

  private processFirstEvent(): boolean {
    const item = this.queue[this.queueHead];
    if (!item) return true;
    try {
      this.eventHandler(item);
      this.consumeFirstEvent();
      return true;
    } catch (error: unknown) {
      this.consumeFirstEvent();
      this.runError ??= error;
      consoleLog('error', '[reflex] event processing exception:', error);
      return true;
    }
  }

  private runNextTick(): void {
    scheduleNextTick(() => this.fsmTrigger('run-queue'));
  }

  private runQueue(): void {
    let remainingEvents = this.getQueueLength();
    while (remainingEvents > 0) {
      const item = this.queue[this.queueHead];
      if (!item) break;
      const scheduler = this.getScheduler(item);
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

  private consumeFirstEvent(): void {
    this.queueHead++;
    if (this.queueHead >= 64 && this.queueHead * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  private settleIdle(error?: unknown): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    if (error === undefined) for (const waiter of waiters) waiter.resolve();
    else for (const waiter of waiters) waiter.reject(error);
  }
}

export function getEventScheduler(event: EventVector): ScheduleFunction | undefined {
  const metadata = (event as ScheduledEventVector).meta;
  if (!metadata) return undefined;
  for (const key of Object.keys(metadata)) {
    const scheduler = eventSchedulers.get(key);
    if (scheduler) return scheduler;
  }
  return undefined;
}
