import { memoryStorageAdapter } from '../adapters';
import { normalizeOptions } from '../config';
import { PERSIST_IDS } from '../ids';
import type { PersistOptions, SyncPersistStorage } from '../types';

function createStorage(): SyncPersistStorage {
  return {
    sync: true,
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

function normalize(value: unknown) {
  return normalizeOptions(value as PersistOptions);
}

describe('persistence configuration', () => {
  it('normalizes defaults and freezes key configuration', () => {
    const normalized = normalize({ storage: createStorage(), keys: ['count'] });

    expect(normalized.version).toBe(1);
    expect(normalized.prefix).toBe('uklad');
    expect(normalized.keyConfigs).toEqual([{ key: 'count' }]);
    expect(Object.isFrozen(normalized.keyConfigs)).toBe(true);
    expect(Object.isFrozen(normalized.keyConfigs[0])).toBe(true);
  });

  it('accepts asynchronous storage and optional callbacks', () => {
    const migrate = () => null;
    const onError = () => {};
    const storage = {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    };

    const normalized = normalize({
      storage,
      keys: [{ key: 'count', serialize: (value: number) => value }],
      version: 2,
      prefix: 'app',
      migrate,
      onError,
      experimentalAsync: true,
    });

    expect(normalized).toMatchObject({
      storage,
      version: 2,
      prefix: 'app',
      migrate,
      onError,
    });
  });

  it.each([
    ['non-object options', null, 'options must be an object'],
    ['non-object storage', { keys: ['count'], storage: null }, 'storage must be an object'],
    ['incomplete storage', { keys: ['count'], storage: { sync: true } }, 'storage must implement'],
    [
      'invalid sync flag',
      { keys: ['count'], storage: { ...createStorage(), sync: 'yes' } },
      'storage.sync must be',
    ],
    [
      'experimental async on sync storage',
      { keys: ['count'], storage: createStorage(), experimentalAsync: true },
      'experimentalAsync is only valid',
    ],
    ['missing keys', { storage: createStorage(), keys: [] }, 'keys must be a non-empty array'],
    [
      'non-array keys',
      { storage: createStorage(), keys: 'count' },
      'keys must be a non-empty array',
    ],
    [
      'invalid key candidate',
      { storage: createStorage(), keys: [null] },
      'every key must be a string',
    ],
    [
      'empty key',
      { storage: createStorage(), keys: [{ key: '' }] },
      'configured keys must be non-empty',
    ],
    [
      'reserved key',
      { storage: createStorage(), keys: [PERSIST_IDS.STATUS] },
      'reserved state root',
    ],
    [
      'duplicate key',
      { storage: createStorage(), keys: ['count', { key: 'count' }] },
      'Duplicate configured key',
    ],
    [
      'invalid serializer',
      { storage: createStorage(), keys: [{ key: 'count', serialize: true }] },
      'serialize for',
    ],
    [
      'invalid deserializer',
      { storage: createStorage(), keys: [{ key: 'count', deserialize: true }] },
      'deserialize for',
    ],
    [
      'invalid version',
      { storage: createStorage(), keys: ['count'], version: 0 },
      'positive safe integer',
    ],
    ['invalid prefix', { storage: createStorage(), keys: ['count'], prefix: '' }, 'prefix must be'],
    [
      'invalid migration callback',
      { storage: createStorage(), keys: ['count'], migrate: true },
      'migrate must be',
    ],
    [
      'invalid error callback',
      { storage: createStorage(), keys: ['count'], onError: true },
      'onError must be',
    ],
  ])('rejects %s', (_label, value, message) => {
    expect(() => normalize(value)).toThrow(message);
  });

  it('provides a mutable in-memory adapter for tests', () => {
    const storage = memoryStorageAdapter({ count: '1' });

    expect(storage.sync).toBe(true);
    expect(storage.getItem('count')).toBe('1');
    expect(storage.getItem('missing')).toBeNull();
    storage.setItem('count', '2');
    expect(storage.getItem('count')).toBe('2');
    storage.removeItem('count');
    expect(storage.getItem('count')).toBeNull();
  });
});
