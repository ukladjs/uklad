import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds, stateKeys } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

export const registerUsersSubscriptions: UkladModule<UkladRegistrar<AppContracts>> = (
  registrar,
) => {
  registrar.regRootSub(appIds.subscriptions.usersList, stateKeys.usersList);
  registrar.regRootSub(appIds.subscriptions.usersLoading, stateKeys.usersLoading);

  /** Deliberately slow, so the devtools subscription timings have something to show. */
  function randomBlockingDelay() {
    const delay = Math.floor(Math.random() * 200) + 1;
    const start = Date.now();
    while (Date.now() - start < delay) {}
  }

  registrar.regSub(
    appIds.subscriptions.usersById,
    () => [[appIds.subscriptions.usersList]],
    ([users], id) => {
      randomBlockingDelay();
      return users.find((user) => user.id === id);
    },
  );
};
