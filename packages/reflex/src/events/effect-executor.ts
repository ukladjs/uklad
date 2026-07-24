import { consoleLog } from '../core/logging';
import { mergeOptionalTraceForKernel } from '../core/tracing';
import { isEventVector } from '../core/validation';
import {
  hasRuntimeLifecycleObservers,
  notifyRuntimeLifecycleForKernel,
  type RuntimeLifecycleEffect,
} from '../runtime/lifecycle';
import { getHandlerForKernel } from '../runtime/handlers';
import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  type RuntimeKernel,
} from '../runtime/kernel';
import { DISPATCH, DISPATCH_LATER } from './effects';
import type { ExecutionEnvelope } from './envelope';

import type { DispatchLaterEffect, TraceErrorTag } from '../types';

const HANDLER_KIND = 'fx';

interface ActiveEffectExecution {
  readonly envelope: ExecutionEnvelope;
  readonly effectId: string;
  readonly effectIndex: number;
}

const ACTIVE_EFFECT_EXECUTION = createRuntimeStateKey<ActiveEffectExecution | undefined>(
  'reflex.active-effect-execution',
);

/**
 * Return the synchronous effect currently invoking a built-in child dispatch.
 * Timer and promise callbacks intentionally see no active parent: they are
 * detached work under the legacy execution model.
 */
export function getActiveEffectExecutionForKernel(
  runtime: RuntimeKernel,
): ActiveEffectExecution | undefined {
  return getOrCreateRuntimeState(runtime, ACTIVE_EFFECT_EXECUTION, () => undefined);
}

function withActiveEffectExecutionForKernel<T>(
  runtime: RuntimeKernel,
  execution: ActiveEffectExecution,
  fn: () => T,
): T {
  const previous = getActiveEffectExecutionForKernel(runtime);
  runtime.extensions.set(ACTIVE_EFFECT_EXECUTION.symbol, execution);
  try {
    return fn();
  } finally {
    if (previous === undefined) runtime.extensions.delete(ACTIVE_EFFECT_EXECUTION.symbol);
    else runtime.extensions.set(ACTIVE_EFFECT_EXECUTION.symbol, previous);
  }
}

/**
 * Execute effects after a state transition has committed. The result is a
 * bounded, immutable record per intent; effect failures remain isolated.
 */
export function executeEffectsForKernel(
  runtime: RuntimeKernel,
  envelope: ExecutionEnvelope,
  effects: unknown,
): void {
  if (!Array.isArray(effects)) {
    consoleLog('warn', `[reflex] effects expects a vector, but was given ${typeof effects}`);
    reportEffect(
      runtime,
      '<invalid>',
      effects,
      -1,
      'invalid',
      Date.now(),
      new Error('[reflex] effects expects a vector.'),
    );
    return;
  }

  notifyRuntimeLifecycleForKernel(runtime, 'onEffects', effects);
  const effectErrors: TraceErrorTag[] = [];

  for (const [effectIndex, effect] of effects.entries()) {
    if (
      !Array.isArray(effect) ||
      effect.length === 0 ||
      effect.length > 2 ||
      typeof effect[0] !== 'string'
    ) {
      consoleLog('warn', '[reflex] invalid effect in effects:', effect);
      reportEffect(
        runtime,
        '<invalid>',
        effect,
        effectIndex,
        'invalid',
        Date.now(),
        new Error('[reflex] Invalid effect vector.'),
      );
      continue;
    }

    const [effectId, value] = effect;
    const handler = getHandlerForKernel(runtime, HANDLER_KIND, effectId);
    if (!handler) {
      consoleLog(
        'warn',
        `[reflex] in 'effects' found ${effectId} which has no associated handler. Ignoring.`,
      );
      reportEffect(
        runtime,
        effectId,
        value,
        effectIndex,
        'unhandled',
        Date.now(),
        new Error(`[reflex] No effect handler is registered for '${effectId}'.`),
      );
      continue;
    }

    const startedAtMs = Date.now();
    try {
      const result = withActiveEffectExecutionForKernel(
        runtime,
        { envelope, effectId, effectIndex },
        () => (handler as (effectValue: unknown) => unknown)(value),
      );
      const invalidDispatch =
        (effectId === DISPATCH && !isEventVector(value)) ||
        (effectId === DISPATCH_LATER && !isValidDispatchLaterEffect(value));
      const error = invalidDispatch
        ? new Error(`[reflex] Invalid ${effectId} effect payload.`)
        : undefined;
      reportEffect(
        runtime,
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
      effectErrors.push({
        phase: 'effect',
        effect: effectId,
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && typeof error.stack === 'string'
          ? { stack: error.stack }
          : {}),
      });
      reportEffect(runtime, effectId, value, effectIndex, 'failed', startedAtMs, error);
    }
  }

  if (effectErrors.length > 0) mergeOptionalTraceForKernel(runtime, () => ({ effectErrors }));
}

/** Report optional lifecycle facts without coupling effect execution to DevTools operations. */
function reportEffect(
  runtime: RuntimeKernel,
  type: string,
  value: unknown,
  index: number,
  status: RuntimeLifecycleEffect['status'],
  startedAtMs: number,
  error?: unknown,
): void {
  if (!hasRuntimeLifecycleObservers(runtime)) return;
  notifyRuntimeLifecycleForKernel(runtime, 'onEffect', {
    type,
    value,
    index,
    status,
    startedAtMs,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    ...(error === undefined ? {} : { error }),
  });
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
