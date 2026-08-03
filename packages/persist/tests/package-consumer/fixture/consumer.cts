import uklad = require('@ukladjs/core/vanilla');
import ukladTesting = require('@ukladjs/core/testing');
import persistPackage = require('@ukladjs/persist');
import type { UkladContracts } from '@ukladjs/core/vanilla';
import type { PersistContracts, PersistStatus } from '@ukladjs/persist';

interface AppContracts extends UkladContracts {
  readonly state: { readonly count: number };
  readonly events: { readonly increment: [] };
}

type Contracts = PersistContracts<AppContracts>;
const runtime = uklad.createUkladRuntime<Contracts>({ initialState: { count: 0 } });
const testHarness = ukladTesting.createUkladTestHarness(runtime);
const handle = persistPackage.persist(runtime, {
  storage: persistPackage.memoryStorageAdapter(),
  keys: [{ key: 'count', serialize: (count) => count, deserialize: Number }],
});

runtime.dispatch([persistPackage.PERSIST_IDS.HYDRATE]);
runtime.dispatch([persistPackage.PERSIST_IDS.PURGE]);
const status: PersistStatus = testHarness.getSubscriptionValue([persistPackage.PERSIST_IDS.STATUS]);

void status;
handle.dispose();
runtime.dispose();
