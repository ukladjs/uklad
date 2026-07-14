/**
 * Port of re-frame.router from ClojureScript to TypeScript.
 * Implements an event queue with a finite-state-machine to schedule and process events.
 */

import type { DispatchVector, EventVector } from './types';
import { getHandlingEventId, getRunningHandlerEventId, handle } from './events';
import { flushSubscriptions } from './db';
import { assertPublicationAllowed } from './subscription-runtime';
import { consoleLog } from './loggers';
import { scheduleAfterRender, scheduleNextTick } from './schedule';
import { IS_DEV } from './env';

type FSMState = 'idle' | 'scheduled' | 'running' | 'paused';

type FSMTrigger =
    | 'add-event'
    | 'run-queue'
    | 'pause'
    | 'exception'
    | 'finish-run'
    | 'resume';

// Mapping of metadata keys to scheduling functions
const laterFns: Record<string, (f: () => void) => void> = {
    flush: scheduleAfterRender,
    yield: scheduleNextTick,
};

/**
 * Core event queue class implementing a finite-state-machine.
 */
export class EventQueue {
    private fsmState: FSMState = 'idle';
    private queue: EventVector[] = [];

    constructor(private eventHandler: (event: EventVector) => void) { }

    push(event: EventVector): void {
        this.fsmTrigger('add-event', event);
    }

    purge(): void {
        this.queue = [];
    }

    private fsmTrigger(trigger: FSMTrigger, arg?: any): void {
        let newState: FSMState;
        let actionFn: (() => void) | undefined;

        switch (`${this.fsmState}:${trigger}`) {
            case 'idle:add-event':
                newState = 'scheduled';
                actionFn = () => {
                    this.addEvent(arg);
                    this.runNextTick();
                };
                break;
            case 'scheduled:add-event':
                newState = 'scheduled';
                actionFn = () => this.addEvent(arg);
                break;
            case 'scheduled:run-queue':
                newState = 'running';
                actionFn = () => this.runQueue();
                break;
            case 'running:add-event':
                newState = 'running';
                actionFn = () => this.addEvent(arg);
                break;
            case 'running:pause':
                newState = 'paused';
                actionFn = () => this.pause(arg);
                break;
            case 'running:exception':
                newState = 'idle';
                actionFn = () => this.exception(arg);
                break;
            case 'running:finish-run':
                if (this.queue.length === 0) {
                    newState = 'idle';
                } else {
                    newState = 'scheduled';
                    actionFn = () => this.runNextTick();
                }
                break;
            case 'paused:add-event':
                newState = 'paused';
                actionFn = () => this.addEvent(arg);
                break;
            case 'paused:resume':
                newState = 'running';
                actionFn = () => this.resume();
                break;
            default:
                consoleLog('error', `[reflex] router state transition not found. ${this.fsmState} ${trigger}`);
                return;
        }

        this.fsmState = newState;
        if (actionFn) actionFn();
    }

    private addEvent(event: EventVector): void {
        this.queue.push(event);
    }

    private processFirstEvent(): void {
        const event = this.queue[0];
        try {
            this.eventHandler(event);
            this.queue.shift();
        } catch (ex) {
            this.fsmTrigger('exception', ex);
        }
    }

    private runNextTick(): void {
        laterFns.yield(() => this.fsmTrigger('run-queue'));
    }

    private runQueue(): void {
        let n = this.queue.length;
        while (n > 0) {
            const nextEvent = this.queue[0];
            // Check if queue was purged (e.g., due to exception) or if event is undefined
            if (!nextEvent || this.queue.length === 0) {
                break;
            }
            const metaKeys = (nextEvent as any).meta ? Object.keys((nextEvent as any).meta) : [];
            const laterKey = metaKeys.find(k => laterFns[k]);
            if (laterKey) {
                this.fsmTrigger('pause', laterFns[laterKey]);
                return;
            }
            this.processFirstEvent();
            n -= 1;
        }
        this.fsmTrigger('finish-run');
    }

    private exception(ex: any): void {
        // queue[0] is the event whose processing threw; the rest never ran.
        const failedEvent = this.queue[0];
        const droppedEventIds = this.queue.slice(1).map((event) => event[0]);
        this.purge();
        consoleLog('error', '[reflex] event processing exception:', ex);
        if (droppedEventIds.length > 0) {
            consoleLog('error', `[reflex] event queue purged: ${droppedEventIds.length} pending event(s) dropped because '${String(failedEvent?.[0])}' threw:`, droppedEventIds);
        }
    }

    private pause(laterFn: (f: () => void) => void): void {
        laterFn(() => this.fsmTrigger('resume'));
    }

    private resume(): void {
        this.processFirstEvent();
        this.runQueue();
    }

    /**
     * Get current state for debugging
     */
    getState(): FSMState {
        return this.fsmState;
    }

    /**
     * Get queue length for debugging
     */
    getQueueLength(): number {
        return this.queue.length;
    }
}

// Create the global event queue
const eventQueue = new EventQueue(handle);

function isValidEventVector(value: any): value is EventVector {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Dispatch an event asynchronously.
 *
 * Accepts any `[id, ...params]` vector by default; once the app augments
 * `EventPayloads`, only declared event ids with matching payloads typecheck.
 */
export function dispatch(event: DispatchVector): void {
    if (!isValidEventVector(event)) {
        consoleLog('error', '[reflex] invalid dispatch event vector.');
        return;
    }
    if (IS_DEV) {
        // Calling dispatch inside an event handler works (the event is
        // queued, not lost) but breaks the purity contract handlers are
        // verified by. Warn instead of throwing: unlike dispatchSync, no
        // state can be corrupted.
        const handlerId = getRunningHandlerEventId();
        if (handlerId !== null) {
            consoleLog('warn', `[reflex] dispatch called for '${String(event[0])}' from inside the event handler for '${handlerId}'. Event handlers must stay pure — return a ['dispatch', [...]] effect instead. The event was queued anyway.`);
        }
    }
    eventQueue.push(event);
}

/**
 * Dispatch an event synchronously: the handler runs, the db commits, and
 * subscription watchers are notified before this function returns — bypassing
 * both the event queue and the animation-frame flush.
 *
 * Use it only where the synchronous timing is load-bearing, e.g. controlled
 * inputs whose value comes from db state (`onChange` must commit before React
 * processes the next keystroke). `dispatch` remains the default.
 *
 * Notes:
 * - Must not be called from within an event handler — that throws. Return a
 *   `['dispatch', ...]` effect instead.
 * - Unlike `dispatch`, handler errors propagate synchronously to the caller
 *   (after the registered event error handler runs).
 */
export function dispatchSync(event: DispatchVector): void {
    if (!isValidEventVector(event)) {
        consoleLog('error', '[reflex] invalid dispatchSync event vector.');
        return;
    }
    const handlingId = getHandlingEventId();
    if (handlingId !== null) {
        const message = `[reflex] dispatchSync called for '${String(event[0])}' while event '${handlingId}' is being handled. dispatchSync must not be called from an event handler; return a ['dispatch', ...] effect instead.`;
        consoleLog('error', message);
        throw new Error(message);
    }
    // Check before the event handler can commit a new app-db generation. A
    // synchronous publication nested inside subscription computation or
    // listener delivery cannot honor its before-return timing contract.
    assertPublicationAllowed();
    handle(event);
    flushSubscriptions();
}
