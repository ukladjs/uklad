import type { ReflexRuntime } from '@flexsurfer/reflex/vanilla';
import type { PlaygroundContracts } from './state';

/** Install the shared subscription graph on one runtime. */
export function installPlaygroundSubscriptions(runtime: ReflexRuntime<PlaygroundContracts>): void {
  runtime.regSub('users');
  runtime.regSub('counter');
  runtime.regSub('isLoading');
  runtime.regSub('nestedCollections');
  runtime.regSub('userMap');
  runtime.regSub('permissionsSet');

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
