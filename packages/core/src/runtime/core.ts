import { EventRuntime } from './event-runtime';
import { StateStore } from './state';
import { RuntimeRegistry } from './registry';
import { SubscriptionRuntime } from './subscriptions/subscription-runtime';
import type { RuntimeProbe } from './probe-types';
import type { UkladRuntimeClient } from './api';

/**
 * The instance-owned core state of one Uklad application.
 *
 * It deliberately has no process-global registry and no default instance:
 * every handler, queue, subscription cache, and diagnostic service belongs to
 * the runtime that created it.
 */
export interface RuntimeIdentity {
  readonly runtimeId: string;
  /** Unique for this in-process runtime instance, even when runtimeId is reused. */
  readonly runtimeInstanceId: string;
  readonly runtimeName: string;
}

export interface RuntimeCore {
  readonly identity: RuntimeIdentity;
  /** Mandatory hot-path services are eagerly constructed and directly addressable. */
  readonly state: StateStore;
  readonly registry: RuntimeRegistry;
  readonly events: EventRuntime;
  readonly subscriptions: SubscriptionRuntime;
  /** Injected after construction so effect handlers receive the stable client facade. */
  effectRuntime: UkladRuntimeClient<any> | undefined;
  /** The only optional hot-path instrumentation capability. */
  probe: RuntimeProbe | undefined;
}

export interface RuntimeIdentityOptions {
  readonly runtimeId?: string;
  readonly name?: string;
}

const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

let nextRuntimeId = 0;
let nextRuntimeInstanceId = 0;
const DISPOSED_RUNTIMES = new WeakSet<RuntimeCore>();

/** @internal Create a process-local, instance-owned runtime core. */
export function createRuntimeCore(options: RuntimeIdentityOptions = {}): RuntimeCore {
  const runtimeId = options.runtimeId ?? createGeneratedRuntimeId();
  if (typeof runtimeId !== 'string' || !RUNTIME_ID_PATTERN.test(runtimeId)) {
    throw new Error(
      '[uklad] runtimeId must be 1-128 characters and contain only letters, numbers, dot, underscore, colon, or hyphen.',
    );
  }

  const runtimeName = options.name ?? runtimeId;
  if (typeof runtimeName !== 'string' || runtimeName.length === 0 || runtimeName.length > 128) {
    throw new Error('[uklad] runtime name must be between 1 and 128 characters.');
  }

  const owner: { runtime?: RuntimeCore } = {};
  const getRuntime = (): RuntimeCore => {
    if (!owner.runtime) throw new Error('[uklad] Runtime service used before initialization.');
    return owner.runtime;
  };
  const state = new StateStore(getRuntime);
  const subscriptions = new SubscriptionRuntime(getRuntime);
  const events = new EventRuntime(getRuntime);
  const runtime = {
    identity: Object.freeze({
      runtimeId,
      runtimeInstanceId: `${runtimeId}:instance:${++nextRuntimeInstanceId}`,
      runtimeName,
    }),
    registry: new RuntimeRegistry(),
    state,
    subscriptions,
    events,
    probe: undefined,
  } as RuntimeCore;
  Object.defineProperty(runtime, 'effectRuntime', {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: true,
  });
  owner.runtime = runtime;
  return runtime;
}

/** @internal Mark a runtime terminally disposed. */
export function markRuntimeDisposed(runtime: RuntimeCore): void {
  DISPOSED_RUNTIMES.add(runtime);
}

/** @internal Return whether a runtime has entered its terminal state. */
export function isRuntimeDisposed(runtime: RuntimeCore): boolean {
  return DISPOSED_RUNTIMES.has(runtime);
}

function createGeneratedRuntimeId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return `runtime-${randomUUID.call(globalThis.crypto)}`;
  nextRuntimeId++;
  return `runtime-${Date.now().toString(36)}-${nextRuntimeId.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
