import { IS_DEV } from '../core/environment';
import { consoleLog } from '../core/logging';
import { isEventVector } from '../core/validation';
import { isRuntimeDisposed, type RuntimeCore } from './core';
import { cloneStructuredValue } from './ownership';
import { assertRuntimeUsable } from './validation';
import { acceptRuntimeEvent, notifyDroppedRuntimeEvents, notifyTrackedRuntimeEvent } from './probe';
import { EventQueue, getEventScheduler } from '../events/router';
import { registerBuiltInEffects } from '../events/effects';
import { executeEventEnvelope } from '../events/execution';
import { regEvent } from '../events/registration';

import type { ExecutionEnvelope } from '../events/envelope';
import type { RegistrationOwnership } from './handler-types';
import type { RuntimeProbeParent } from './probe-types';
import type { DispatchVector, EventHandler, EventVector, Interceptor } from '../types';

type ScheduledEventVector = EventVector & { meta?: Partial<Record<'flush' | 'yield', boolean>> };

/** Runtime-owned event orchestration: queueing, dispatch, execution and rate limits. */
export class EventRuntime {
  readonly queue: EventQueue<ExecutionEnvelope>;
  handlingEventId: string | null = null;
  handlingEnvelope: ExecutionEnvelope | null = null;
  runningHandlerEventId: string | null = null;
  activeEffect:
    | {
        readonly envelope: ExecutionEnvelope;
        readonly effectId: string;
        readonly effectIndex: number;
      }
    | undefined;
  readonly delayedEffectTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  readonly debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  readonly throttledEventIds: Set<string> = new Set();
  readonly throttleTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  readonly injectGlobalInterceptors: Interceptor;
  private readonly getRuntime: () => RuntimeCore;
  private globalInterceptors: Interceptor[] = [];
  private readonly globalInterceptorVersions = new Map<string, number>();
  private nextGlobalInterceptorVersion = 0;

  constructor(getRuntime: () => RuntimeCore) {
    this.getRuntime = getRuntime;
    this.injectGlobalInterceptors = {
      id: 'inject-global-interceptors',
      before(context) {
        context.queue = [...getRuntime().events.getInterceptors(), ...context.queue];
        return context;
      },
    };
    this.queue = new EventQueue<ExecutionEnvelope>(
      (envelope) => this.execute(envelope),
      (envelopes, reason, error) => {
        const tracking = envelopes.flatMap((envelope) =>
          envelope.tracking === undefined ? [] : [envelope.tracking],
        );
        if (tracking.length > 0) notifyDroppedRuntimeEvents(tracking, reason, error);
      },
      (envelope) => getEventScheduler(envelope.event),
    );
  }

  initialize(): void {
    registerBuiltInEffects(this.getRuntime(), (event) => this.dispatchOwned(event));
  }

  registerEvent<T = Record<string, any>>(
    id: string,
    handler: EventHandler<T>,
    registration?: unknown,
    legacyInterceptors?: Interceptor<T>[],
  ): RegistrationOwnership {
    return regEvent(this.getRuntime(), id, handler, registration, legacyInterceptors);
  }

  registerInterceptor(interceptor: Interceptor): RegistrationOwnership {
    const existingIndex = this.globalInterceptors.findIndex(({ id }) => id === interceptor.id);
    this.globalInterceptors =
      existingIndex === -1
        ? [...this.globalInterceptors, interceptor]
        : this.globalInterceptors.map((existing, index) =>
            index === existingIndex ? interceptor : existing,
          );
    const version = this.bumpGlobalInterceptorVersion();
    this.globalInterceptorVersions.set(interceptor.id, version);
    const isCurrent = () => this.globalInterceptorVersions.get(interceptor.id) === version;
    const release = (): boolean => {
      if (!isCurrent()) return false;
      this.globalInterceptors = this.globalInterceptors.filter(
        (existing) => existing.id !== interceptor.id,
      );
      this.globalInterceptorVersions.set(interceptor.id, this.bumpGlobalInterceptorVersion());
      return true;
    };
    return Object.freeze({
      get current(): boolean {
        return isCurrent();
      },
      release,
    });
  }

  getInterceptors(): Interceptor[] {
    return [...this.globalInterceptors];
  }

  clearInterceptors(id?: string): void {
    const removedIds =
      id === undefined ? this.globalInterceptors.map((interceptor) => interceptor.id) : [id];
    this.globalInterceptors =
      id === undefined
        ? []
        : this.globalInterceptors.filter((interceptor) => interceptor.id !== id);
    for (const removedId of removedIds) {
      this.globalInterceptorVersions.set(removedId, this.bumpGlobalInterceptorVersion());
    }
  }

  execute(envelope: ExecutionEnvelope): void {
    executeEventEnvelope(this.getRuntime(), envelope);
  }

  dispatch(event: DispatchVector, requireTrackedOperation = false): ExecutionEnvelope | undefined {
    const runtime = this.getRuntime();
    if (isRuntimeDisposed(runtime)) return;
    if (!isEventVector(event)) {
      consoleLog('error', '[reflex] invalid dispatch event vector.');
      return;
    }
    if (IS_DEV && this.runningHandlerEventId !== null) {
      consoleLog(
        'warn',
        `[reflex] dispatch called for '${String(event[0])}' from inside the event handler for '${this.runningHandlerEventId}'. Event handlers must stay pure — return a ['dispatch', [...]] effect instead. The event was queued anyway.`,
      );
    }
    const envelope = createExecutionEnvelope(runtime, event as EventVector);
    if (requireTrackedOperation && !envelope.tracking?.operationTracked) {
      throw new Error(
        '[reflex] operation dispatch could not be accepted by the development observer.',
      );
    }
    this.queue.push(envelope);
    if (envelope.tracking) {
      notifyTrackedRuntimeEvent(envelope.tracking, 'eventQueued', runtime.state.committedRevision);
    }
    return envelope;
  }

  dispatchOwned(event: DispatchVector): void {
    if (!isEventVector(event)) {
      this.dispatch(event);
      return;
    }
    this.dispatch(cloneAcceptedEvent(event));
  }

  dispatchSync(event: DispatchVector): void {
    const runtime = this.getRuntime();
    assertRuntimeUsable(runtime);
    if (!isEventVector(event)) {
      consoleLog('error', '[reflex] invalid dispatchSync event vector.');
      return;
    }
    if (this.handlingEventId !== null) {
      const message = `[reflex] dispatchSync called for '${String(event[0])}' while event '${this.handlingEventId}' is being handled. dispatchSync must not be called from an event handler; return a ['dispatch', ...] effect instead.`;
      consoleLog('error', message);
      throw new Error(message);
    }
    if (!this.isIdle) {
      throw new Error(
        `[reflex] dispatchSync cannot overtake asynchronous work already accepted by runtime '${runtime.identity.runtimeId}'. Await runtime.flush() first.`,
      );
    }
    runtime.subscriptions.assertPublicationAllowed();
    executeEventEnvelope(runtime, createExecutionEnvelope(runtime, event));
    runtime.state.publish();
  }

  async flush(): Promise<void> {
    const runtime = this.getRuntime();
    assertRuntimeUsable(runtime);
    await this.queue.whenIdle();
    runtime.state.publish();
  }

  get isIdle(): boolean {
    return this.queue.getState() === 'idle';
  }
  get isRunning(): boolean {
    return this.queue.getState() === 'running';
  }
  dispose(): void {
    this.queue.dispose();
  }

  clearRateLimit(eventId: string): void {
    const timeout = this.debounceTimers.get(eventId);
    if (timeout === undefined) return;
    clearTimeout(timeout);
    this.debounceTimers.delete(eventId);
  }

  clearRateLimits(): void {
    for (const timeout of this.debounceTimers.values()) clearTimeout(timeout);
    for (const timeout of this.throttleTimers) clearTimeout(timeout);
    this.debounceTimers.clear();
    this.throttleTimers.clear();
    this.throttledEventIds.clear();
  }

  clearDelayedEffects(): void {
    for (const timer of this.delayedEffectTimers) clearTimeout(timer);
    this.delayedEffectTimers.clear();
  }

  debounce(event: DispatchVector, durationMs: number): void {
    const acceptedEvent = cloneRateLimitedEvent(event);
    const eventId = acceptedEvent[0];
    this.clearRateLimit(eventId);
    const timeout = setTimeout(() => {
      this.debounceTimers.delete(eventId);
      this.dispatch(acceptedEvent);
    }, durationMs);
    this.debounceTimers.set(eventId, timeout);
  }

  throttle(event: DispatchVector, durationMs: number): void {
    const acceptedEvent = cloneRateLimitedEvent(event);
    const eventId = acceptedEvent[0];
    if (this.throttledEventIds.has(eventId)) return;
    this.throttledEventIds.add(eventId);
    const timeout = setTimeout(() => {
      this.throttledEventIds.delete(eventId);
      this.throttleTimers.delete(timeout);
    }, durationMs);
    this.throttleTimers.add(timeout);
    this.dispatch(acceptedEvent);
  }

  private bumpGlobalInterceptorVersion(): number {
    return ++this.nextGlobalInterceptorVersion;
  }
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

function cloneRateLimitedEvent(event: DispatchVector): DispatchVector {
  try {
    return cloneStructuredValue(event);
  } catch (error: unknown) {
    throw new Error('[reflex] Rate-limited dispatch payloads must be structured-cloneable.', {
      cause: error,
    });
  }
}

function createExecutionEnvelope(runtime: RuntimeCore, event: EventVector): ExecutionEnvelope {
  if (!runtime.probe?.eventAccepted) return Object.freeze({ event });
  const activeEffect = runtime.events.activeEffect;
  const handlingEnvelope = runtime.events.handlingEnvelope;
  const parent: RuntimeProbeParent | undefined = activeEffect?.envelope.tracking
    ? {
        tracking: activeEffect.envelope.tracking,
        sourceEffectId: activeEffect.effectId,
        sourceEffectIndex: activeEffect.effectIndex,
      }
    : handlingEnvelope?.tracking === undefined
      ? undefined
      : { tracking: handlingEnvelope.tracking };
  const tracking = acceptRuntimeEvent(runtime, event, parent);
  return tracking === undefined ? Object.freeze({ event }) : Object.freeze({ event, tracking });
}
