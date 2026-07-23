import { consoleLog } from '../core/logging';
import { isEventVector } from '../core/validation';
import { registerHandlerForKernel, registerSystemHandlerForKernel } from '../runtime/handlers';
import {
  createRuntimeStateKey,
  getOrCreateRuntimeState,
  type RuntimeKernel,
} from '../runtime/kernel';

import type {
  DispatchLaterEffect,
  DispatchVector,
  EffectHandler,
  EffectParams,
  EventVector,
  Id,
} from '../types';

const HANDLER_KIND = 'fx';
const DELAYED_EFFECT_TIMERS =
  createRuntimeStateKey<Set<ReturnType<typeof setTimeout>>>('reflex.delayed-effects');

function getDelayedEffectTimers(runtime: RuntimeKernel): Set<ReturnType<typeof setTimeout>> {
  return getOrCreateRuntimeState(runtime, DELAYED_EFFECT_TIMERS, () => new Set());
}

export const DISPATCH_LATER = 'dispatch-later';
export const DISPATCH = 'dispatch';

/** @internal Register an effect handler in one runtime. */
export function regEffectForKernel<K extends Id = Id>(
  runtime: RuntimeKernel,
  id: K,
  handler: EffectHandler<EffectParams<K>>,
): void {
  registerHandlerForKernel(runtime, HANDLER_KIND, id, handler);
}

/** @internal Install dispatch effects in one runtime. */
export function registerBuiltInEffectsForKernel(
  runtime: RuntimeKernel,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  registerSystemHandlerForKernel(
    runtime,
    HANDLER_KIND,
    DISPATCH_LATER,
    (value: DispatchLaterEffect) => {
      dispatchLater(runtime, value, dispatchEvent);
    },
  );

  registerSystemHandlerForKernel(runtime, HANDLER_KIND, DISPATCH, (value: EventVector) => {
    if (!isEventVector(value)) {
      consoleLog(
        'error',
        '[reflex] ignoring bad dispatch value. Expected a vector, but got:',
        value,
      );
      return;
    }
    dispatchEvent(value as DispatchVector);
  });
}

function dispatchLater(
  runtime: RuntimeKernel,
  effect: unknown,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  if (typeof effect !== 'object' || effect === null) {
    consoleLog('error', '[reflex] ignoring bad dispatch-later value:', effect);
    return;
  }

  const { ms, dispatch: event } = effect as Partial<DispatchLaterEffect>;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || !isEventVector(event)) {
    consoleLog('error', '[reflex] ignoring bad dispatch-later value:', effect);
    return;
  }

  if (ms < 0) {
    consoleLog('warn', '[reflex] dispatch-later effect with negative delay:', ms);
  }
  const timers = getDelayedEffectTimers(runtime);
  const timeout = setTimeout(
    () => {
      timers.delete(timeout);
      dispatchEvent(event as DispatchVector);
    },
    Math.max(0, ms),
  );
  timers.add(timeout);
}

/** @internal Cancel delayed dispatch effects owned by one runtime. */
export function clearDelayedEffectsForKernel(runtime: RuntimeKernel): void {
  const timers = getDelayedEffectTimers(runtime);
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}
