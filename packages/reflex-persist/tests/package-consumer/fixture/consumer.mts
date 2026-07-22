import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import type { ReflexContracts } from '@flexsurfer/reflex/vanilla';
import { PERSIST_IDS, memoryStorageAdapter, persist } from '@flexsurfer/reflex-persist';
import type { PersistContracts, PersistStatus } from '@flexsurfer/reflex-persist';

interface AppContracts extends ReflexContracts {
  readonly state: { readonly count: number };
  readonly events: { readonly increment: [] };
}

type Contracts = PersistContracts<AppContracts>;
const runtime = createReflexRuntime<Contracts>({ initialState: { count: 0 } });
const handle = persist(runtime, {
  storage: memoryStorageAdapter(),
  keys: [{ key: 'count', serialize: (count) => count, deserialize: Number }],
});

runtime.dispatch([PERSIST_IDS.HYDRATE]);
runtime.dispatch([PERSIST_IDS.PURGE]);
const status: PersistStatus = runtime.getSubscriptionValue([PERSIST_IDS.STATUS]);

void status;
handle.dispose();
runtime.dispose();
