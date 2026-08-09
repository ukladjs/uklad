import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds, stateKeys } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import { createLoadingServerQuery } from './state';
import type { ServerItem } from './state';

/** Pure roots/selectors; their TanStack lifecycles are installed by the web adapter. */
export const registerServerSubscriptions: UkladModule<UkladRegistrar<AppContracts>> = (
  registrar,
) => {
  registrar.regRootSub(appIds.subscriptions.serverClock, stateKeys.serverClock);
  registrar.regRootSub(appIds.subscriptions.serverItems, stateKeys.serverItems);
  registrar.regRootSub(appIds.subscriptions.serverRegion, stateKeys.serverRegion);
  registrar.regRootSub(appIds.subscriptions.serverRegionSummary, stateKeys.serverRegionSummary);

  registrar.regSub(
    appIds.subscriptions.serverItemById,
    () => [[appIds.subscriptions.serverItems]],
    ([items], itemId) => items[itemId] ?? createLoadingServerQuery<ServerItem>(),
  );
};
