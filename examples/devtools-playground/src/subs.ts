import type { ReflexRuntime } from '@flexsurfer/reflex/vanilla';
import type { PlaygroundContracts } from './state';

/** Install the shared subscription graph on one runtime. */
export function installPlaygroundSubscriptions(runtime: ReflexRuntime<PlaygroundContracts>): void {
  runtime.regRootSub('users', 'users');
  runtime.regRootSub('counter', 'counter');
  runtime.regRootSub('isLoading', 'isLoading');
  runtime.regRootSub('nestedCollections', 'nestedCollections');
  runtime.regRootSub('userMap', 'userMap');
  runtime.regRootSub('permissionsSet', 'permissionsSet');

  function randomBlockingDelay() {
    const delay = Math.floor(Math.random() * 200) + 1;
    const start = Date.now();
    while (Date.now() - start < delay) {}
  }

  runtime.regSub(
    'user-by-id',
    (users, id) => {
      randomBlockingDelay();
      return users.find((u: any) => u.id === id);
    },
    () => [['users']],
  );

  runtime.regSub(
    'nestedCollections-comp',
    (nestedCollections) => {
      return nestedCollections;
    },
    () => [['nestedCollections']],
  );
}
