import reflex = require('@flexsurfer/reflex/vanilla');
import persistPackage = require('@flexsurfer/reflex-persist');
import type { ReflexContracts } from '@flexsurfer/reflex/vanilla';
import type { PersistContracts, PersistStatus } from '@flexsurfer/reflex-persist';

interface AppContracts extends ReflexContracts {
  readonly state: { readonly count: number };
  readonly events: { readonly increment: [] };
}

type Contracts = PersistContracts<AppContracts>;
const runtime = reflex.createReflexRuntime<Contracts>({ initialState: { count: 0 } });
const handle = persistPackage.persist(runtime, {
  storage: persistPackage.memoryStorageAdapter(),
  keys: [{ key: 'count', serialize: (count) => count, deserialize: Number }],
});

runtime.dispatch([persistPackage.PERSIST_IDS.HYDRATE]);
runtime.dispatch([persistPackage.PERSIST_IDS.PURGE]);
const status: PersistStatus = runtime.getSubscriptionValue([persistPackage.PERSIST_IDS.STATUS]);

void status;
handle.dispose();
runtime.dispose();
