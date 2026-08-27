import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { createUkladRuntime } from '@ukladjs/core/vanilla';
import { asyncStorageAdapter, persist } from '@ukladjs/persist';
import type { PersistContracts } from '@ukladjs/persist';

import { eventIds, stateKeys, subscriptionIds } from './catalog';
import type { AppContracts as BaseContracts } from './contracts';

export type AppContracts = PersistContracts<BaseContracts>;

const appStorage = createAsyncStorage('uklad-demo');

export const runtime = createUkladRuntime<AppContracts>({
  initialState: { [stateKeys.count]: 0 },
  runtimeId: 'react-native-persist-demo',
  name: 'Uklad Persist React Native Demo',
});

runtime.registerModule((registrar) => {
  registrar.regEvent(eventIds.increment, ({ draftState }) => {
    draftState[stateKeys.count] += 1;
  });
  registrar.regRootSub(subscriptionIds.count, stateKeys.count);
});

export const persistence = persist(runtime, {
  storage: asyncStorageAdapter(appStorage),
  prefix: 'uklad-demo-react-native',
  keys: [stateKeys.count],
  onError: (error) => console.warn('[react-native-persist-demo]', error),
});

persistence.hydrate();
void persistence.whenHydrated().catch(() => {});
