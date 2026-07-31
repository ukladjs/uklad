import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import { appIds, stateKeys } from '../../app/reflex/catalog';
import type { AppContracts } from '../../app/reflex/contracts';

export const registerCollectionsSubscriptions: ReflexModule<ReflexRegistrar<AppContracts>> = (
  registrar,
) => {
  registrar.regRootSub(appIds.subscriptions.collectionsUsers, stateKeys.collectionsUsers);
  registrar.regRootSub(
    appIds.subscriptions.collectionsPermissions,
    stateKeys.collectionsPermissions,
  );
  registrar.regRootSub(appIds.subscriptions.collectionsRoles, stateKeys.collectionsRoles);
  registrar.regRootSub(
    appIds.subscriptions.collectionsUserPermissions,
    stateKeys.collectionsUserPermissions,
  );

  // The nested shape the panel renders is composed here rather than stored.
  // Roles and user permissions change independently, so they stay independent
  // roots; only this subscription recomputes when either of them does.
  registrar.regSub(
    appIds.subscriptions.collectionsNested,
    () => [
      [appIds.subscriptions.collectionsRoles],
      [appIds.subscriptions.collectionsUserPermissions],
    ],
    ([roles, userPermissions]) => ({ roles, userPermissions }),
    // No equality check: this handler cannot produce an unchanged result. It
    // only runs when a dependency's identity changed, and each dependency is
    // a member of the wrapper it returns, so the answer is already known to
    // be "changed". Omitting the config would not mean "no check" — it falls
    // back to the runtime default, which is deep equality, and that would
    // walk two Maps of Sets on every recompute to reach that same answer.
    { equalityCheck: () => false },
  );
};
