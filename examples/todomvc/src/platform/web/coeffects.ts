import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

/**
 * Web implementations of the application's coeffect ids.
 *
 * The ids and their contracts are stable across platforms; only the handler
 * changes. `platform/test/coeffects.ts` registers the same `system/now`
 * against a fixed clock, which is why event handlers never branch on the
 * environment.
 *
 * There is no `platform/web/effects.ts`: TodoMVC declares no application
 * effects. Web storage arrives through the persistence module instead.
 */
export const registerWebCoeffects: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regCoeffect(appIds.coeffects.systemNow, () => Date.now());
};
