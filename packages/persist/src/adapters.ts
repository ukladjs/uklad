import type {
  AsyncPersistStorage,
  AsyncStorageLike,
  SyncPersistStorage,
  SyncMethodsStorageLike,
  SyncStorageLike,
} from './types';

/** Wrap an AsyncStorage-compatible object without importing a native package. */
export function asyncStorageAdapter(storage: AsyncStorageLike): AsyncPersistStorage {
  return {
    sync: false,
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  };
}

/** Wrap a synchronous string storage implementation, including Expo SQLite kv-store. */
export function syncStorageAdapter(
  storage: SyncStorageLike | SyncMethodsStorageLike,
): SyncPersistStorage {
  const getItem = 'getItemSync' in storage ? storage.getItemSync : storage.getItem;
  const setItem = 'setItemSync' in storage ? storage.setItemSync : storage.setItem;
  const removeItem = 'removeItemSync' in storage ? storage.removeItemSync : storage.removeItem;
  return {
    sync: true,
    getItem: (key) => getItem.call(storage, key),
    setItem: (key, value) => setItem.call(storage, key, value),
    removeItem: (key) => removeItem.call(storage, key),
  };
}

/** localStorage-backed synchronous adapter (browser CSR). */
export function localStorageAdapter(): SyncPersistStorage {
  return {
    sync: true,
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
    removeItem: (key) => globalThis.localStorage.removeItem(key),
  };
}

/** In-memory synchronous adapter for tests. */
export function memoryStorageAdapter(initial?: Record<string, string>): SyncPersistStorage {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    sync: true,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}
