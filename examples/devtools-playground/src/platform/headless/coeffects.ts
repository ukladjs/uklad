import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import { appIds } from '../../app/reflex/catalog';
import type { AppContracts } from '../../app/reflex/contracts';
import { memoryStorage } from './env';

/**
 * Headless implementations of the same coeffect ids as
 * `platform/web/coeffects.ts`, reading the in-memory environment instead of
 * the browser.
 */
export const headlessCoeffectModes = {
  [appIds.coeffects.systemNow]: 'real',
  [appIds.coeffects.storageLocalValue]: 'memory',
} as const;

export const registerHeadlessCoeffects: ReflexModule<ReflexRegistrar<AppContracts>> = (
  registrar,
) => {
  registrar.regCoeffect(appIds.coeffects.systemNow, () => Date.now());

  registrar.regCoeffect(
    appIds.coeffects.storageLocalValue,
    (key) => memoryStorage.get(key) ?? null,
  );
};
