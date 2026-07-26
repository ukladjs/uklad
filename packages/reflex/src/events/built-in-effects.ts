import { consoleLog } from '../core/logging';
import { isEventVector } from '../core/validation';
import { type RuntimeCore } from '../runtime/core';

import type { DispatchLaterEffect, DispatchVector, EventVector } from '../types';

export const DISPATCH_LATER = 'dispatch-later';
export const DISPATCH = 'dispatch';

/** @internal Install built-in dispatch effects in one runtime. */
export function registerBuiltInEffects(
  runtime: RuntimeCore,
  dispatchEvent: (event: DispatchVector) => void,
): void {
  runtime.registry.fx.registerSystem(DISPATCH_LATER, (value: DispatchLaterEffect) => {
    dispatchLater(runtime, value, dispatchEvent);
  });

  runtime.registry.fx.registerSystem(DISPATCH, (value: EventVector) => {
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
  runtime: RuntimeCore,
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
  const timers = runtime.events.delayedEffectTimers;
  const timeout = setTimeout(
    () => {
      timers.delete(timeout);
      dispatchEvent(event as DispatchVector);
    },
    Math.max(0, ms),
  );
  timers.add(timeout);
}
