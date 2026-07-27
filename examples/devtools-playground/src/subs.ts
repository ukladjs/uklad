import type { ReflexRegistrar } from '@flexsurfer/reflex/vanilla';
import type { PlaygroundContracts } from './state';

/** Install the shared subscription graph on one registrar. */
export function installPlaygroundSubscriptions(registrar: ReflexRegistrar<PlaygroundContracts>): void {
  registrar.regRootSub('users', 'users');
  registrar.regRootSub('counter', 'counter');
  registrar.regRootSub('isLoading', 'isLoading');
  registrar.regRootSub('nestedCollections', 'nestedCollections');
  registrar.regRootSub('userMap', 'userMap');
  registrar.regRootSub('permissionsSet', 'permissionsSet');

  function randomBlockingDelay() {
    const delay = Math.floor(Math.random() * 200) + 1;
    const start = Date.now();
    while (Date.now() - start < delay) {}
  }

  registrar.regSub(
    'user-by-id',
    (users, id) => {
      randomBlockingDelay();
      return users.find((u: any) => u.id === id);
    },
    () => [['users']],
  );

  registrar.regSub(
    'nestedCollections-comp',
    (nestedCollections) => {
      return nestedCollections;
    },
    () => [['nestedCollections']],
  );
}
