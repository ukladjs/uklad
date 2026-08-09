import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

export const registerServerEvents: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regEvent(appIds.events.serverRegionSelected, ({ draftState }, region) => {
    draftState.serverRegion = region;
  });
};
