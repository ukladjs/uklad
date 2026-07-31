/** Roots owned by the `counter` feature. */

export type CounterValue = number;

/** How many events the `diagnostics/dispatch-event` effect has dispatched back in. */
export type CounterEffectDispatches = number;

/** Where the counter is stored by `counter/persist` and read by `counter/load`. */
export const COUNTER_STORAGE_KEY = 'playground.counter';

export function createCounterValue(): CounterValue {
  return 0;
}

export function createCounterEffectDispatches(): CounterEffectDispatches {
  return 0;
}
