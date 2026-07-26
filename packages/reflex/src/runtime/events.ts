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
import { getInjectCofxInterceptor } from '../events/coeffects';
import { isInterceptor } from '../events/interceptors';

import type { ExecutionEnvelope } from '../events/envelope';
import type { RegistrationOwnership } from './handler-types';
import type { RuntimeProbeParent } from './probe-types';
import type {
  DispatchVector,
  EventHandler,
  EventRegistrationOptions,
  EventVector,
  Interceptor,
} from '../types';

type ScheduledEventVector = EventVector & { meta?: Partial<Record<'flush' | 'yield', boolean>> };
const EMPTY_INTERCEPTORS: readonly Interceptor[] = Object.freeze([]);

interface RuntimeEventDefinition {
  readonly handler: EventHandler<any, any>;
  readonly interceptors: readonly Interceptor[];
}

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
  private readonly globalInterceptorOwners = new Map<string, symbol>();
  private readonly eventDefinitions = new Map<string, RuntimeEventDefinition>();

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
    options?: EventRegistrationOptions<T>,
  ): RegistrationOwnership {
    const interceptors = this.buildEventInterceptors(id, options);
    const ownership = this.getRuntime().registry.event.register(id, handler);
    this.eventDefinitions.set(id, createEventDefinition(handler, interceptors));
    return Object.freeze({
      get current(): boolean {
        return ownership.current;
      },
      release: (): boolean => {
        if (!ownership.current || !ownership.release()) return false;
        const currentHandler = this.getRuntime().registry.event.get(id);
        if (currentHandler === undefined) this.eventDefinitions.delete(id);
        else
          this.eventDefinitions.set(id, createEventDefinition(currentHandler, EMPTY_INTERCEPTORS));
        return true;
      },
    });
  }

  getEvent(id: string): RuntimeEventDefinition | undefined {
    return this.eventDefinitions.get(id);
  }

  getEventInterceptors(id: string): readonly Interceptor[] {
    return this.eventDefinitions.get(id)?.interceptors ?? EMPTY_INTERCEPTORS;
  }

  setEventInterceptors(id: string, interceptors: readonly Interceptor[]): void {
    const handler = this.getRuntime().registry.event.get(id);
    if (handler !== undefined)
      this.eventDefinitions.set(id, createEventDefinition(handler, interceptors));
  }

  clearEventDefinitions(id?: string): void {
    if (id === undefined) this.eventDefinitions.clear();
    else this.eventDefinitions.delete(id);
  }

  registerInterceptor(interceptor: Interceptor): RegistrationOwnership {
    if (this.globalInterceptorOwners.has(interceptor.id)) {
      throw new Error(`[reflex] Global interceptor '${interceptor.id}' is already registered.`);
    }
    this.globalInterceptors = [...this.globalInterceptors, interceptor];
    const owner = Symbol(interceptor.id);
    this.globalInterceptorOwners.set(interceptor.id, owner);
    const isCurrent = () => this.globalInterceptorOwners.get(interceptor.id) === owner;
    const release = (): boolean => {
      if (!isCurrent()) return false;
      this.globalInterceptors = this.globalInterceptors.filter(
        (existing) => existing.id !== interceptor.id,
      );
      this.globalInterceptorOwners.delete(interceptor.id);
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
    this.globalInterceptors =
      id === undefined
        ? []
        : this.globalInterceptors.filter((interceptor) => interceptor.id !== id);
    if (id === undefined) this.globalInterceptorOwners.clear();
    else this.globalInterceptorOwners.delete(id);
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

  private buildEventInterceptors<T>(
    id: string,
    options?: EventRegistrationOptions<T>,
  ): readonly Interceptor[] {
    const runtime = this.getRuntime();
    const coeffectInterceptors: Interceptor[] = [];
    const coeffects = Array.isArray(options?.coeffects) ? options.coeffects : [];

    for (const specification of coeffects) {
      if (!Array.isArray(specification) || typeof specification[0] !== 'string') {
        consoleLog('warn', '[reflex] invalid cofx specification:', specification);
        continue;
      }

      if (specification.length === 1) {
        coeffectInterceptors.push(getInjectCofxInterceptor(runtime, specification[0]));
      } else if (specification.length === 2) {
        coeffectInterceptors.push(
          getInjectCofxInterceptor(runtime, specification[0], specification[1]),
        );
      } else {
        consoleLog('warn', '[reflex] invalid cofx specification:', specification);
      }
    }

    const eventInterceptors: Interceptor[] = [];
    const interceptors = Array.isArray(options?.interceptors) ? options.interceptors : [];
    for (const candidate of interceptors) {
      if (isInterceptor(candidate)) {
        eventInterceptors.push(candidate);
      } else {
        consoleLog(
          'error',
          '[reflex] invalid interceptor provided for event:',
          id,
          'interceptor:',
          candidate,
        );
      }
    }

    return [...coeffectInterceptors, ...eventInterceptors];
  }
}

function createEventDefinition(
  handler: EventHandler<any, any>,
  interceptors: readonly Interceptor[],
): RuntimeEventDefinition {
  return Object.freeze({
    handler,
    interceptors: interceptors.length === 0 ? EMPTY_INTERCEPTORS : Object.freeze([...interceptors]),
  });
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
