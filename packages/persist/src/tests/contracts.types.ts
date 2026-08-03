import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import type { ReflexContracts } from '@flexsurfer/reflex/vanilla';

import { PERSIST_IDS, memoryStorageAdapter, persist } from '../index';
import type { AsyncPersistStorage, PersistContracts, PersistData, PersistStatus } from '../index';

interface AppContracts extends ReflexContracts {
  readonly state: {
    readonly todos: Map<number, { readonly title: string }>;
    readonly ready: boolean;
  };
  readonly events: {
    readonly 'todos/add': [id: number, title: string];
  };
  readonly subscriptions: {
    readonly ready: { readonly params: []; readonly result: boolean };
  };
}

type AppWithPersist = PersistContracts<AppContracts>;

const runtime = createReflexRuntime<AppWithPersist>({
  initialState: { todos: new Map(), ready: false },
});
const testHarness = createReflexTestHarness(runtime);
const handle = persist(runtime, {
  storage: memoryStorageAdapter(),
  keys: [
    {
      key: 'todos',
      serialize: (todos) => Array.from(todos.entries()),
      deserialize: (data) => new Map(data as [number, { title: string }][]),
    },
  ],
});

runtime.dispatch([PERSIST_IDS.HYDRATE]);
runtime.dispatch([PERSIST_IDS.PURGE]);
const status: PersistStatus = testHarness.getSubscriptionValue([PERSIST_IDS.STATUS]);

const asyncStorage: AsyncPersistStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};
// @ts-expect-error async storage requires an explicit experimental opt-in.
persist(runtime, { storage: asyncStorage, keys: ['ready'] });
persist(runtime, {
  storage: asyncStorage,
  keys: ['ready'],
  experimentalAsync: true,
});

// @ts-expect-error nested thenables are not persistable JSON data.
const invalidAsyncData: PersistData = { nested: Promise.resolve('nope') };
// @ts-expect-error Map values require an explicit serializer.
const invalidMapData: PersistData = new Map<string, string>();

// Internal completion events intentionally remain outside the strict public protocol.
// @ts-expect-error LOADED is library-owned, not a caller dispatch surface.
runtime.dispatch([PERSIST_IDS.LOADED, {}]);

// Configured roots are checked against the runtime state contract.
persist(runtime, {
  storage: memoryStorageAdapter(),
  // @ts-expect-error `missing` is not an state root.
  keys: ['missing'],
});

void status;
void invalidAsyncData;
void invalidMapData;
handle.dispose();
runtime.dispose();
