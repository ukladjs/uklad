import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

export const registerCollectionsEvents: UkladModule<UkladRegistrar<AppContracts>> = (
  registrar,
) => {
  registrar.regEvent(appIds.events.collectionsAddUser, ({ draftState }, userId, user) => {
    draftState.collectionsUsers.set(userId, user);
  });

  registrar.regEvent(appIds.events.collectionsRemoveUser, ({ draftState }, userId) => {
    draftState.collectionsUsers.delete(userId);
  });

  registrar.regEvent(appIds.events.collectionsUpdateUser, ({ draftState }, userId, updates) => {
    const user = draftState.collectionsUsers.get(userId);
    if (user) Object.assign(user, updates);
  });

  registrar.regEvent(appIds.events.collectionsAddPermission, ({ draftState }, permission) => {
    draftState.collectionsPermissions.add(permission);
  });

  registrar.regEvent(appIds.events.collectionsRemovePermission, ({ draftState }, permission) => {
    draftState.collectionsPermissions.delete(permission);
  });

  // Reads one root and writes another in the same transition. Flat roots do
  // not weaken transactional consistency — both changes commit together.
  registrar.regEvent(appIds.events.collectionsAssignRole, ({ draftState }, userId, role) => {
    const rolePermissions = draftState.collectionsRoles.get(role);
    if (rolePermissions) {
      draftState.collectionsUserPermissions.set(userId, new Set(rolePermissions));
    }
  });
};
