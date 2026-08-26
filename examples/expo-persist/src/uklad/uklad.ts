import { createUkladRuntime } from '@ukladjs/core/vanilla';
import { persist, syncStorageAdapter } from '@ukladjs/persist';
import type { PersistContracts } from '@ukladjs/persist';
import Storage from 'expo-sqlite/kv-store';

import { eventIds, stateKeys, subscriptionIds } from './catalog';
import type { AppContracts as BaseContracts } from './contracts';

export type AppContracts = PersistContracts<BaseContracts>;

export const runtime = createUkladRuntime<AppContracts>({
  initialState: { [stateKeys.count]: 0 },
  runtimeId: 'expo-persist-demo',
  name: 'Uklad Persist Expo Demo',
});

runtime.registerModule((registrar) => {
  registrar.regEvent(eventIds.increment, ({ draftState }) => {
    draftState[stateKeys.count] += 1;
  });
  registrar.regRootSub(subscriptionIds.count, stateKeys.count);
});

export const persistence = persist(runtime, {
  storage: syncStorageAdapter(Storage),
  prefix: 'uklad-demo-expo-sqlite',
  keys: [stateKeys.count],
  onError: (error) => console.warn('[expo-persist-demo]', error),
});

persistence.hydrate();
void persistence.whenHydrated().catch(() => {});
