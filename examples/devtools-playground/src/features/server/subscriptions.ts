import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds, stateKeys } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

/** The selected region is application input; query lifecycles live in the web adapter. */
export const registerServerSubscriptions: UkladModule<UkladRegistrar<AppContracts>> = (
  registrar,
) => {
  registrar.regRootSub(appIds.subscriptions.serverRegion, stateKeys.serverRegion);
};
