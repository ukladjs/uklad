import { createUkladRuntime } from '@ukladjs/core/vanilla';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import type { UkladContracts } from '@ukladjs/core/vanilla';
import { PERSIST_IDS, memoryStorageAdapter, persist } from '@ukladjs/persist';
import type { PersistContracts, PersistStatus } from '@ukladjs/persist';

interface AppContracts extends UkladContracts {
  readonly state: { readonly count: number };
  readonly events: { readonly increment: [] };
}

type Contracts = PersistContracts<AppContracts>;
const runtime = createUkladRuntime<Contracts>({ initialState: { count: 0 } });
const testHarness = createUkladTestHarness(runtime);
const handle = persist(runtime, {
  storage: memoryStorageAdapter(),
  keys: [{ key: 'count', serialize: (count) => count, deserialize: Number }],
});

runtime.dispatch([PERSIST_IDS.HYDRATE]);
runtime.dispatch([PERSIST_IDS.PURGE]);
const status: PersistStatus = testHarness.getSubscriptionValue([PERSIST_IDS.STATUS]);

void status;
handle.dispose();
runtime.dispose();
