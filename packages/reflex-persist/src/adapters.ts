import type { SyncPersistStorage } from './types';

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
