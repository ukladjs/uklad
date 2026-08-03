import { IS_DEV } from '../core/environment';
import { consoleLog } from '../core/logging';
import { isEventVector } from '../core/validation';
import { RUNTIME_OWNED_COEFFECT_IDS } from '../contracts';
import { isRuntimeDisposed, type RuntimeCore } from './core';
import {
  createRegistrationHandle,
  RegistrationCollisionError,
  RegistrationStore,
} from './registrations';
import { assertRuntimeUsable } from './validation';
import { acceptRuntimeEvent, notifyDroppedRuntimeEvents, notifyTrackedRuntimeEvent } from './probe';
import { EventQueue, getEventScheduler } from '../events/router';
import { registerBuiltInEffects } from '../events/built-in-effects';
import { executeEventEnvelope } from '../events/execution';
import { isInterceptor } from '../events/interceptors-executor';
import { createEventHandlerInterceptor } from '../events/runner';

import type { ExecutionEnvelope } from '../events/envelope';
import type { RegistrationHandle } from './registrations';
import type { RuntimeProbeParent } from './probe-types';
import type {
  CoeffectReadContext,
  Context,
  EventHandler,
  EventRegistrationOptions,
  EventVector,
  Interceptor,
  InternalInterceptor,
} from '../types';

const EMPTY_INTERCEPTORS: readonly Interceptor[] = Object.freeze([]);
const EMPTY_NAMED_COEFFECT_BINDINGS: readonly NamedCoeffectBinding[] = Object.freeze([]);

interface NamedCoeffectBinding {
  readonly slot: string;
  readonly id: string;
  readonly arg?: unknown;
}

interface RuntimeEventDefinition {
  readonly handler: EventHandler<any, any>;
  readonly interceptors: readonly Interceptor[];
  /** Provider-to-local-name projection used only when calling the event handler. */
  readonly namedCoeffectBindings: readonly NamedCoeffectBinding[];
  /**
   * The complete chain this event executes, built once at registration.
   *
   * Composing it per dispatch would allocate the array, the handler
   * interceptor, and its closure on every event, none of which vary between
   * dispatches of the same definition.
   */
  readonly chain: Interceptor[];
}

/** Runtime-owned event orchestration: queueing, dispatch, execution, and rate limits. */
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
  private readonly getRuntime: () => RuntimeCore;
  private readonly globalInterceptors = new RegistrationStore<Interceptor>();
  private readonly eventDefinitions = new Map<string, RuntimeEventDefinition>();

  constructor(getRuntime: () => RuntimeCore) {
    this.getRuntime = getRuntime;
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
  ): RegistrationHandle {
    const { interceptors, namedCoeffectBindings } = this.buildEventInterceptors(id, options);
    const registration = this.getRuntime().registry.event.register(id, handler);
    this.eventDefinitions.set(
      id,
      createEventDefinition(this.getRuntime(), handler, interceptors, namedCoeffectBindings),
    );
    return createRegistrationHandle({
      isActive: () => registration.active,
      release: (): boolean => {
        if (!registration.active || !registration.release()) return false;
        const currentHandler = this.getRuntime().registry.event.get(id);
        if (currentHandler === undefined) this.eventDefinitions.delete(id);
        else
          this.eventDefinitions.set(
            id,
            createEventDefinition(this.getRuntime(), currentHandler, EMPTY_INTERCEPTORS),
          );
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
    const namedCoeffectBindings =
      this.eventDefinitions.get(id)?.namedCoeffectBindings ?? EMPTY_NAMED_COEFFECT_BINDINGS;
    if (handler !== undefined)
      this.eventDefinitions.set(
        id,
        createEventDefinition(this.getRuntime(), handler, interceptors, namedCoeffectBindings),
      );
  }

  clearEventDefinitions(id?: string): void {
    if (id === undefined) this.eventDefinitions.clear();
    else this.eventDefinitions.delete(id);
  }

  registerInterceptor(interceptor: Interceptor): RegistrationHandle {
    return this.globalInterceptors.register(interceptor.id, interceptor);
  }

  /**
   * Install the immutable global interceptor policy selected by runtime
   * composition. Validate the whole list before mutating the registry so an
   * invalid option cannot leave a partially configured runtime behind.
   */
  installGlobalInterceptors(interceptors: readonly Interceptor[] | undefined): void {
    if (interceptors === undefined) return;
    if (!Array.isArray(interceptors)) {
      throw new TypeError('[reflex] runtime interceptors must be an array.');
    }

    const ids = new Set<string>();
    const owned: Interceptor[] = [];
    for (const candidate of interceptors) {
      // Copy before validating so the runtime never retains a caller-owned
      // interceptor object whose hooks or id could change after construction.
      const interceptor = Object.freeze({ ...candidate }) as Interceptor;
      if (!isInterceptor(interceptor)) {
        throw new TypeError(
          '[reflex] runtime interceptors must each have a string id and a before or after function.',
        );
      }
      if (ids.has(interceptor.id) || this.globalInterceptors.has(interceptor.id)) {
        throw new RegistrationCollisionError(interceptor.id);
      }
      ids.add(interceptor.id);
      owned.push(interceptor);
    }

    for (const interceptor of owned) this.registerInterceptor(interceptor);
  }

  get hasGlobalInterceptors(): boolean {
    return this.globalInterceptors.size > 0;
  }

  getInterceptors(): Interceptor[] {
    return this.globalInterceptors.list();
  }

  clearInterceptors(id?: string): void {
    this.globalInterceptors.clear(id);
  }

  execute(envelope: ExecutionEnvelope): void {
    executeEventEnvelope(this.getRuntime(), envelope);
  }

  dispatch(event: EventVector, requireTrackedOperation = false): ExecutionEnvelope | undefined {
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

  /**
   * Accept an event from application code or from a dispatch effect.
   *
   * The runtime borrows this immutable event without copying or freezing it.
   * Application code transfers ownership and must not mutate it afterward.
   */
  dispatchOwned(event: EventVector): void {
    this.dispatch(event);
  }

  dispatchSync(event: EventVector): void {
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

  debounce(event: EventVector, durationMs: number): void {
    const eventId = event[0];
    this.clearRateLimit(eventId);
    const timeout = setTimeout(() => {
      this.debounceTimers.delete(eventId);
      this.dispatch(event);
    }, durationMs);
    this.debounceTimers.set(eventId, timeout);
  }

  throttle(event: EventVector, durationMs: number): void {
    const eventId = event[0];
    if (this.throttledEventIds.has(eventId)) return;
    this.throttledEventIds.add(eventId);
    const timeout = setTimeout(() => {
      this.throttledEventIds.delete(eventId);
      this.throttleTimers.delete(timeout);
    }, durationMs);
    this.throttleTimers.add(timeout);
    this.dispatch(event);
  }

  private buildEventInterceptors<T>(
    id: string,
    options?: EventRegistrationOptions<T>,
  ): {
    readonly interceptors: readonly Interceptor[];
    readonly namedCoeffectBindings: readonly NamedCoeffectBinding[];
  } {
    const runtime = this.getRuntime();
    const coeffectInterceptors: Interceptor[] = [];
    const namedCoeffectBindings: NamedCoeffectBinding[] = [];
    const coeffects = options?.coeffects;

    if (Array.isArray(coeffects)) {
      throw new Error(
        "[reflex] event coeffects must be an object of local bindings, for example { now: 'system/now' }.",
      );
    } else if (coeffects && typeof coeffects === 'object') {
      const bindings = readNamedCoeffectBindings(coeffects);
      for (const binding of bindings) {
        namedCoeffectBindings.push(binding);
        coeffectInterceptors.push(getInjectCofxInterceptor(runtime, binding.id, binding.arg));
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

    return {
      interceptors: [...coeffectInterceptors, ...eventInterceptors],
      namedCoeffectBindings,
    };
  }
}

/**
 * Create a coeffect interceptor bound to one runtime.
 *
 * The handler returns a value and the interceptor always stores it under the
 * coeffect's own id. Named event bindings are projected only for the final
 * event-handler call, so providers remain available to later coeffects and
 * infrastructure interceptors without leaking provider ids into application
 * handler inputs.
 *
 * A missing or throwing handler aborts the event before its state transition
 * runs. A successful handler may still deliberately inject `undefined`.
 */
function getInjectCofxInterceptor(
  runtime: RuntimeCore,
  id: string,
  arg?: any,
): InternalInterceptor {
  return {
    id: `inject-${id}`,
    before(context: Context): Context {
      const handler = runtime.registry.cofx.get(id);
      if (!handler) {
        throw new Error(`[reflex] No coeffect handler registered for '${id}'.`);
      }

      const value = handler(arg, createCoeffectReadContext(context.coeffects));
      context.coeffects[id] = value;
      return context;
    },
  };
}

function readCoeffectSpecification(
  specification: unknown,
): { readonly id: string; readonly arg?: unknown } | undefined {
  if (!Array.isArray(specification) || typeof specification[0] !== 'string') return;
  if (specification.length === 1) return { id: specification[0] };
  if (specification.length === 2) return { id: specification[0], arg: specification[1] };
  return;
}

function readNamedCoeffectBindings(coeffects: object): NamedCoeffectBinding[] {
  const bindings: NamedCoeffectBinding[] = [];
  for (const [slot, binding] of Object.entries(coeffects)) {
    if (!isNamedCoeffectSlot(slot)) {
      consoleLog(
        'warn',
        `[reflex] invalid named coeffect binding slot '${slot}'. Slots must not replace runtime-owned coeffects.`,
      );
      continue;
    }

    if (typeof binding === 'string') {
      bindings.push({ slot, id: binding });
      continue;
    }

    const request = readCoeffectSpecification(binding);
    if (request) {
      bindings.push({ slot, ...request });
      continue;
    }

    consoleLog('warn', '[reflex] invalid named coeffect binding:', slot, binding);
  }
  return bindings;
}

function isNamedCoeffectSlot(slot: string): boolean {
  return (
    slot.length > 0 &&
    slot !== '__proto__' &&
    !RUNTIME_OWNED_COEFFECT_IDS.some((runtimeOwnedId) => runtimeOwnedId === slot)
  );
}

/**
 * Give a coeffect handler a detached, immutable view of inputs it may read.
 *
 * `draftState` is deliberately omitted: it is an event-handler capability,
 * not a coeffect capability. The event vector is copied before freezing, so a
 * coeffect cannot replace its id or parameters for the event that follows.
 * Values supplied by earlier coeffects retain their own identity; handlers
 * should treat those values as read-only too.
 */
function createCoeffectReadContext(coeffects: Context['coeffects']): CoeffectReadContext {
  const previous = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(coeffects)) {
    if (key !== 'event' && key !== 'draftState') previous[key] = value;
  }

  return Object.freeze({
    ...previous,
    event: Object.freeze([...coeffects.event]) as Readonly<EventVector>,
  }) as CoeffectReadContext;
}

function createEventDefinition(
  runtime: RuntimeCore,
  handler: EventHandler<any, any>,
  interceptors: readonly Interceptor[],
  namedCoeffectBindings: readonly NamedCoeffectBinding[] = EMPTY_NAMED_COEFFECT_BINDINGS,
): RuntimeEventDefinition {
  const ownedInterceptors =
    interceptors.length === 0 ? EMPTY_INTERCEPTORS : Object.freeze([...interceptors]);
  const ownedNamedCoeffectBindings =
    namedCoeffectBindings.length === 0
      ? EMPTY_NAMED_COEFFECT_BINDINGS
      : Object.freeze([...namedCoeffectBindings]);
  return Object.freeze({
    handler,
    interceptors: ownedInterceptors,
    namedCoeffectBindings: ownedNamedCoeffectBindings,
    chain: [
      ...ownedInterceptors,
      createEventHandlerInterceptor(runtime, handler, ownedNamedCoeffectBindings),
    ],
  });
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
