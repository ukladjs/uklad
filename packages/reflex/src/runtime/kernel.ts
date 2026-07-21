import type { EqualityCheckFn } from '../types';
import type { EventQueue } from '../events/router';
import type { RateLimitState } from '../events/rate-limit';
import type { TraceState } from '../core/tracing';
import type { AppDbState } from './app-db';
import type { HandlerState } from './handlers';
import type { SubscriptionCacheState } from './subscriptions/cache';
import type { SubscriptionEngine } from './subscriptions/engine';

const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

let nextRuntimeId = 0;

/**
 * A private key for one independently owned runtime service.
 *
 * Keeping service state behind symbols lets the kernel own all mutable state
 * without making internal implementation details part of its public shape.
 */
export interface RuntimeStateKey<T> {
  readonly description: string;
  readonly symbol: symbol;
  readonly __state?: T;
}

/**
 * The instance-owned core state of one Reflex application.
 *
 * It deliberately has no process-global registry and no default instance:
 * every handler, queue, subscription cache, and diagnostic service belongs to
 * the runtime that created it.
 */
export interface RuntimeKernel {
  readonly runtimeId: string;
  readonly runtimeName: string;
  /** Hot-path state is typed and directly addressable. It remains lazy. */
  appDb?: AppDbState;
  handlers?: HandlerState;
  eventQueue?: EventQueue;
  subscriptionCache?: SubscriptionCacheState;
  subscriptionEngine?: SubscriptionEngine;
  tracing?: TraceState;
  rateLimit?: RateLimitState;
  equalityCheck?: EqualityCheckFn;
  /** Rare/optional services use this extension storage. */
  readonly extensions: Map<symbol, unknown>;
  readonly lifecycle: {
    disposed: boolean;
  };
}

export interface RuntimeIdentityOptions {
  readonly runtimeId?: string;
  readonly name?: string;
}

/** @internal Define one private slot on every runtime kernel that uses it. */
export function createRuntimeStateKey<T>(description: string): RuntimeStateKey<T> {
  return Object.freeze({ description, symbol: Symbol(description) });
}

/** @internal Read or lazily initialise state owned by one runtime kernel. */
export function getOrCreateRuntimeState<T>(
  runtime: RuntimeKernel,
  key: RuntimeStateKey<T>,
  create: () => T,
): T {
  const existing = runtime.extensions.get(key.symbol);
  if (existing !== undefined) return existing as T;
  const state = create();
  runtime.extensions.set(key.symbol, state);
  return state;
}

/** @internal Create a process-local, instance-owned runtime kernel. */
export function createRuntimeKernel(options: RuntimeIdentityOptions = {}): RuntimeKernel {
  const runtimeId = options.runtimeId ?? createGeneratedRuntimeId();
  if (typeof runtimeId !== 'string' || !RUNTIME_ID_PATTERN.test(runtimeId)) {
    throw new Error(
      '[reflex] runtimeId must be 1-128 characters and contain only letters, numbers, dot, underscore, colon, or hyphen.',
    );
  }

  const runtimeName = options.name ?? runtimeId;
  if (typeof runtimeName !== 'string' || runtimeName.length === 0 || runtimeName.length > 128) {
    throw new Error('[reflex] runtime name must be between 1 and 128 characters.');
  }

  return {
    runtimeId,
    runtimeName,
    extensions: new Map<symbol, unknown>(),
    lifecycle: { disposed: false },
  };
}

function createGeneratedRuntimeId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return `runtime-${randomUUID.call(globalThis.crypto)}`;
  nextRuntimeId++;
  return `runtime-${Date.now().toString(36)}-${nextRuntimeId.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** @internal Mark a runtime terminally disposed. */
export function markRuntimeDisposed(runtime: RuntimeKernel): void {
  runtime.lifecycle.disposed = true;
}

/** @internal Return whether a runtime has entered its terminal state. */
export function isRuntimeDisposed(runtime: RuntimeKernel): boolean {
  return runtime.lifecycle.disposed;
}
