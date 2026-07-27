import { consoleLog } from '../core/logging';
import { isEventVector } from '../core/validation';
import { hasTrackedRuntimeEventCallback, notifyTrackedRuntimeEvent } from '../runtime/probe';
import { type RuntimeCore } from '../runtime/core';
import { DISPATCH, DISPATCH_LATER } from './built-in-effects';
import type { ExecutionEnvelope } from './envelope';

import type { DispatchLaterEffect } from '../types';
import type { RuntimeProbeEffect } from '../runtime/probe-types';

interface ActiveEffectExecution {
  readonly envelope: ExecutionEnvelope;
  readonly effectId: string;
  readonly effectIndex: number;
}

/**
 * Execute effects after a state transition has committed. The result is a
 * bounded, immutable record per intent; effect failures remain isolated.
 */
export function executeEffects(
  runtime: RuntimeCore,
  envelope: ExecutionEnvelope,
  effects: unknown,
): void {
  if (!Array.isArray(effects)) {
    consoleLog('warn', `[reflex] effects expects a vector, but was given ${typeof effects}`);
    reportEffect(
      envelope,
      '<invalid>',
      effects,
      -1,
      'invalid',
      hasTrackedRuntimeEventCallback(envelope.tracking, 'effect') ? Date.now() : 0,
      new Error('[reflex] effects expects a vector.'),
    );
    return;
  }

  const reporting = hasTrackedRuntimeEventCallback(envelope.tracking, 'effect');
  const effectRuntime = runtime.effectRuntime;
  if (!effectRuntime) {
    throw new Error('[reflex] Runtime effect capability was not initialized.');
  }

  for (const [effectIndex, effect] of effects.entries()) {
    if (
      !Array.isArray(effect) ||
      effect.length === 0 ||
      effect.length > 2 ||
      typeof effect[0] !== 'string'
    ) {
      consoleLog('warn', '[reflex] invalid effect in effects:', effect);
      reportEffect(
        envelope,
        '<invalid>',
        effect,
        effectIndex,
        'invalid',
        reporting ? Date.now() : 0,
        new Error('[reflex] Invalid effect vector.'),
      );
      continue;
    }

    const [effectId, value] = effect;
    const handler = runtime.registry.fx.get(effectId);
    if (!handler) {
      consoleLog(
        'warn',
        `[reflex] in 'effects' found ${effectId} which has no associated handler. Ignoring.`,
      );
      reportEffect(
        envelope,
        effectId,
        value,
        effectIndex,
        'unhandled',
        reporting ? Date.now() : 0,
        new Error(`[reflex] No effect handler is registered for '${effectId}'.`),
      );
      continue;
    }

    const startedAtMs = reporting ? Date.now() : 0;
    try {
      const invoke = () =>
        (handler as (effectValue: unknown, runtime: unknown) => unknown)(value, effectRuntime);
      const result =
        envelope.tracking === undefined
          ? invoke()
          : withActiveEffectExecution(runtime, { envelope, effectId, effectIndex }, invoke);
      const invalidDispatch =
        (effectId === DISPATCH && !isEventVector(value)) ||
        (effectId === DISPATCH_LATER && !isValidDispatchLaterEffect(value));
      const error = invalidDispatch
        ? new Error(`[reflex] Invalid ${effectId} effect payload.`)
        : undefined;
      reportEffect(
        envelope,
        effectId,
        value,
        effectIndex,
        invalidDispatch
          ? 'failed'
          : effectId === DISPATCH
            ? 'succeeded'
            : effectId === DISPATCH_LATER || isThenable(result)
              ? 'detached'
              : 'returned',
        startedAtMs,
        error,
      );
    } catch (error: unknown) {
      consoleLog('error', `[reflex] error in effects for ${effectId}:`, error);
      reportEffect(envelope, effectId, value, effectIndex, 'failed', startedAtMs, error);
    }
  }
}

function withActiveEffectExecution<T>(
  runtime: RuntimeCore,
  execution: ActiveEffectExecution,
  fn: () => T,
): T {
  const previous = runtime.events.activeEffect;
  runtime.events.activeEffect = execution;
  try {
    return fn();
  } finally {
    runtime.events.activeEffect = previous;
  }
}

/** Construct effect evidence only when an accepting probe requested it. */
function reportEffect(
  envelope: ExecutionEnvelope,
  type: string,
  value: unknown,
  index: number,
  status: RuntimeProbeEffect['status'],
  startedAtMs: number,
  error?: unknown,
): void {
  if (!hasTrackedRuntimeEventCallback(envelope.tracking, 'effect')) return;
  notifyTrackedRuntimeEvent(envelope.tracking, 'effect', {
    type,
    value,
    index,
    status,
    startedAtMs,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    ...(error === undefined ? {} : { error }),
  } satisfies RuntimeProbeEffect);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function isValidDispatchLaterEffect(value: unknown): value is DispatchLaterEffect {
  if (typeof value !== 'object' || value === null) return false;
  const effect = value as Partial<DispatchLaterEffect>;
  return (
    typeof effect.ms === 'number' && Number.isFinite(effect.ms) && isEventVector(effect.dispatch)
  );
}
