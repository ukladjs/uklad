import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

export const registerUsersEvents: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regEvent(appIds.events.usersToggle, ({ draftState }, userId) => {
    const user = draftState.usersList.find((candidate) => candidate.id === userId);
    if (user) {
      user.active = !user.active;
    }
  });

  registrar.regEvent(appIds.events.usersAdd, ({ draftState }, user) => {
    draftState.usersList.push(user);
  });

  // `usersLoading` is its own root, so a spinner toggling does not change the
  // identity of `usersList` and the list subgraph is not reevaluated.
  registrar.regEvent(appIds.events.usersSetLoading, ({ draftState }, isLoading) => {
    draftState.usersLoading = isLoading;
  });
};
