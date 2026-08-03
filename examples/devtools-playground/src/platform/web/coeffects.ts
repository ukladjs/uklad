import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

/**
 * Web implementations of the application's coeffect ids: read real browser
 * state into the event's injected inputs.
 *
 * `platform/headless/coeffects.ts` registers the same ids against the
 * in-memory environment. Coeffect handlers are synchronous by contract — an
 * asynchronous read is an effect that later dispatches a result event.
 */
export const webCoeffectModes = {
  [appIds.coeffects.systemNow]: 'real',
  [appIds.coeffects.storageLocalValue]: 'real',
} as const;

export const registerWebCoeffects: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regCoeffect(appIds.coeffects.systemNow, () => Date.now());

  registrar.regCoeffect(appIds.coeffects.storageLocalValue, (key) =>
    window.localStorage.getItem(key),
  );
};
