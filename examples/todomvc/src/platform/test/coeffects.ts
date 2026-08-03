import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

export interface TestClock {
  /** Install `system/now` backed by this clock. */
  readonly module: UkladModule<UkladRegistrar<AppContracts>>;
  /** Set the value the next injections will read. */
  set(value: number): void;
}

/**
 * A deterministic `system/now` for integration tests that build a real runtime.
 *
 * Same coeffect id and same declared contract as the web adapter, so the event
 * handlers under test are the ones that ship. The clock is created per test,
 * not shared through module state, so isolated runtimes stay isolated.
 */
export function createTestClock(start = 1_000): TestClock {
  let now = start;
  return {
    module: (registrar) => {
      registrar.regCoeffect(appIds.coeffects.systemNow, () => now);
    },
    set(value) {
      now = value;
    },
  };
}
