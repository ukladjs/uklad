import { createReflexRuntime, enableMapSet } from '@flexsurfer/reflex/vanilla';
import type { Trace } from '@flexsurfer/reflex/vanilla';
import type { ReflexContracts } from '@flexsurfer/reflex/vanilla';

import { PERSIST_IDS, localStorageAdapter, persist } from '../index';
import type {
  AsyncPersistStorage,
  PersistData,
  PersistDiagnostic,
  SyncPersistStorage,
} from '../index';

enableMapSet();

function createMemoryStorage(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  let getCalls = 0;
  let setCalls = 0;
  let removeCalls = 0;
  const storage: SyncPersistStorage = {
    sync: true,
    getItem: (key) => {
      getCalls += 1;
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      setCalls += 1;
      data.set(key, value);
    },
    removeItem: (key) => {
      removeCalls += 1;
      data.delete(key);
    },
  };
  return {
    storage,
    data,
    get getCalls() {
      return getCalls;
    },
    get setCalls() {
      return setCalls;
    },
    get removeCalls() {
      return removeCalls;
    },
  };
}

function createDeferredAsyncStorage(initial?: Record<string, string>, failReads = false) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  let setCalls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const storage: AsyncPersistStorage = {
    getItem: async (key) => {
      await gate;
      if (failReads) throw new Error('storage unavailable and contains SECRET_READ_CAUSE');
      return data.get(key) ?? null;
    },
    setItem: async (key, value) => {
      setCalls += 1;
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
  return {
    storage,
    data,
    release: release!,
    get setCalls() {
      return setCalls;
    },
  };
}

function entry(version: number, data: unknown): string {
  return JSON.stringify({ v: version, data });
}

let runtimeCounter = 0;
function makeRuntime<TState extends Record<string, any>>(initialState: TState) {
  runtimeCounter += 1;
  return createReflexRuntime<ReflexContracts & { readonly state: TState }>({
    initialState,
    runtimeId: `persist-test-${runtimeCounter}`,
  } as never);
}

function statusOf(runtime: { getState(): unknown }): unknown {
  return (runtime.getState() as Record<string, unknown>)[PERSIST_IDS.STATUS];
}

describe('persist', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('starts idle, then synchronously hydrates, migrates, and rewrites only migrated keys', async () => {
    const memory = createMemoryStorage({
      'reflex/todos': entry(1, ['a', 'b']),
      'reflex/settings': entry(2, { theme: 'dark' }),
    });
    const runtime = makeRuntime({ todos: [] as string[], settings: {}, ui: 'untouched' });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: ['todos', 'settings'],
      version: 2,
      migrate: (key, data, from) => {
        expect(key).toBe('todos');
        expect(from).toBe(1);
        return (data as string[]).map((todo) => todo.toUpperCase());
      },
    });

    expect(statusOf(runtime)).toBe('idle');
    const pending = handle.whenHydrated();
    handle.hydrate();
    await pending;

    expect(runtime.getState()).toMatchObject({
      todos: ['A', 'B'],
      settings: { theme: 'dark' },
      ui: 'untouched',
      [PERSIST_IDS.STATUS]: 'hydrated',
    });
    expect(memory.setCalls).toBe(1);
    expect(memory.data.get('reflex/todos')).toBe(entry(2, ['A', 'B']));
    expect(memory.data.get('reflex/settings')).toBe(entry(2, { theme: 'dark' }));

    handle.dispose();
    runtime.dispose();
  });

  it('never echoes hydration and does not require configured roots to be subscriptions', () => {
    const memory = createMemoryStorage({ 'reflex/todos': entry(1, ['stored']) });
    const runtime = makeRuntime({ todos: [] as string[] });
    const handle = persist(runtime, { storage: memory.storage, keys: ['todos'] });

    runtime.dispatchSync([PERSIST_IDS.HYDRATE]);

    expect(runtime.getState().todos).toEqual(['stored']);
    expect(memory.setCalls).toBe(0);
    handle.dispose();
    runtime.dispose();
  });

  it('ignores forged internal write effects before hydration', () => {
    const original = entry(1, 41);
    const diagnostics: PersistDiagnostic[] = [];
    const memory = createMemoryStorage({ 'reflex/count': original });
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: ['count'],
      onError: (value) => diagnostics.push(value),
    });
    runtime.regEvent('forge/write', () => [[PERSIST_IDS.WRITE, { key: 'count' }]]);

    runtime.dispatchSync(['forge/write']);

    expect(memory.data.get('reflex/count')).toBe(original);
    expect(memory.setCalls).toBe(0);
    expect(diagnostics).toEqual([{ code: 'invalid-completion', phase: 'lifecycle' }]);
    handle.dispose();
    runtime.dispose();
  });

  it('rejects malformed direct internal completions without changing the gate', () => {
    const memory = createMemoryStorage({ 'reflex/count': entry(1, 41) });
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });

    expect(() =>
      runtime.dispatchSync([
        PERSIST_IDS.LOADED,
        { rawByKey: { count: entry(1, 99) }, diagnostics: [] },
      ] as never),
    ).not.toThrow();
    expect(statusOf(runtime)).toBe('idle');

    handle.hydrate();
    expect(runtime.getState().count).toBe(41);
    expect(statusOf(runtime)).toBe('hydrated');
    handle.dispose();
    runtime.dispose();
  });

  it('writes exactly the changed configured roots after commit', async () => {
    const memory = createMemoryStorage();
    const runtime = makeRuntime({ todos: [] as string[], settings: { theme: 'light' }, ui: 0 });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: ['todos', 'settings'],
    });
    runtime.regEvent('todos/add', ({ draftState }, text: string) => {
      draftState.todos.push(text);
    });
    runtime.regEvent('ui/bump', ({ draftState }) => {
      draftState.ui += 1;
    });

    handle.hydrate();
    runtime.dispatch(['todos/add', 'write me']);
    runtime.dispatch(['ui/bump']);
    await runtime.flush();

    expect(memory.setCalls).toBe(1);
    expect(memory.data.get('reflex/todos')).toBe(entry(1, ['write me']));
    expect(memory.data.has('reflex/settings')).toBe(false);
    expect(memory.data.has('reflex/ui')).toBe(false);
    handle.dispose();
    runtime.dispose();
  });

  it('rejects non-JSON serializer output without overwriting storage', async () => {
    const original = entry(1, { theme: 'old' });
    const diagnostics: PersistDiagnostic[] = [];
    const memory = createMemoryStorage({ 'reflex/settings': original });
    const runtime = makeRuntime({ settings: { theme: 'light' } });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: [
        {
          key: 'settings',
          serialize: () => ({ theme: undefined }) as unknown as PersistData,
        },
      ],
      onError: (value) => diagnostics.push(value),
    });
    runtime.regEvent('settings/change', ({ draftState }) => {
      draftState.settings = { theme: 'dark' };
    });

    handle.hydrate();
    runtime.dispatch(['settings/change']);
    await runtime.flush();

    expect(memory.data.get('reflex/settings')).toBe(original);
    expect(memory.setCalls).toBe(0);
    expect(diagnostics).toContainEqual({
      code: 'serialize-failed',
      phase: 'serialize',
      key: 'settings',
    });
    handle.dispose();
    runtime.dispose();
  });

  it('rejects a serializer toJSON escape hatch and validates the encoded envelope', async () => {
    const original = entry(1, { theme: 'old' });
    const memory = createMemoryStorage({ 'reflex/settings': original });
    const runtime = makeRuntime({ settings: { theme: 'light' } });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: [
        {
          key: 'settings',
          serialize: () => {
            const data = { theme: 'dark' };
            Object.defineProperty(data, 'toJSON', { value: () => undefined });
            return data;
          },
        },
      ],
    });
    runtime.regEvent('settings/change', ({ draftState }) => {
      draftState.settings = { theme: 'dark' };
    });

    handle.hydrate();
    runtime.dispatch(['settings/change']);
    await runtime.flush();

    expect(memory.data.get('reflex/settings')).toBe(original);
    expect(memory.setCalls).toBe(0);
    handle.dispose();
    runtime.dispose();
  });

  it('uses Object.is for root identity and removes storage when a root is deleted', async () => {
    const memory = createMemoryStorage();
    const runtime = makeRuntime({ value: Number.NaN, ui: 0 });
    const handle = persist(runtime, { storage: memory.storage, keys: ['value'] });
    runtime.regEvent('ui/bump', ({ draftState }) => {
      draftState.ui += 1;
    });
    runtime.regEvent('value/delete', ({ draftState }) => {
      delete (draftState as { value?: number }).value;
    });

    handle.hydrate();
    runtime.dispatch(['ui/bump']);
    await runtime.flush();
    expect(memory.setCalls).toBe(0);

    memory.data.set('reflex/value', entry(1, 'stale'));
    runtime.dispatch(['value/delete']);
    await runtime.flush();
    expect(memory.removeCalls).toBe(1);
    expect(memory.data.has('reflex/value')).toBe(false);
    handle.dispose();
    runtime.dispose();
  });

  it('round-trips transformed Map roots with key-specific types', async () => {
    type Todo = { id: number; title: string; done: boolean };
    const memory = createMemoryStorage({
      'reflex/todos': entry(1, [
        [1, { id: 1, title: 'stored', done: false }],
        [2, { id: 2, title: 'also stored', done: true }],
      ]),
    });
    const runtime = makeRuntime({ todos: new Map<number, Todo>() });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: [
        {
          key: 'todos',
          serialize: (todos) => Array.from(todos.entries()),
          deserialize: (data) => new Map(data as [number, Todo][]),
        },
      ],
    });
    runtime.regEvent('todos/add', ({ draftState }, todo: Todo) => {
      draftState.todos.set(todo.id, todo);
    });

    handle.hydrate();
    expect(runtime.getState().todos.get(2)).toEqual({
      id: 2,
      title: 'also stored',
      done: true,
    });
    runtime.dispatch(['todos/add', { id: 3, title: 'new', done: false }]);
    await runtime.flush();

    const stored = JSON.parse(memory.data.get('reflex/todos')!) as { data: [number, Todo][] };
    expect(stored.data[2]).toEqual([3, { id: 3, title: 'new', done: false }]);
    handle.dispose();
    runtime.dispose();
  });

  it('converts a thrown synchronous read into a failed transition and settles waiters', async () => {
    const diagnostics: PersistDiagnostic[] = [];
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage: localStorageAdapter(),
      keys: ['count'],
      onError: (value) => diagnostics.push(value),
    });
    const pending = handle.whenHydrated();

    expect(() => handle.hydrate()).not.toThrow();
    await expect(pending).rejects.toThrow('Hydration failed');
    expect(statusOf(runtime)).toBe('failed');
    expect(diagnostics).toEqual([{ code: 'storage-read-failed', phase: 'read', key: 'count' }]);

    handle.dispose();
    runtime.dispose();
  });

  it('settles sync hydration waiters when a later interceptor aborts the event', async () => {
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage: createMemoryStorage({ 'reflex/count': entry(1, 41) }).storage,
      keys: ['count'],
    });
    runtime.regGlobalInterceptor({
      id: 'block-sync-hydrate-after-handler',
      after: (context) => {
        if (context.coeffects.event[0] === PERSIST_IDS.HYDRATE) {
          throw new Error('expected sync hydration interceptor failure');
        }
        return context;
      },
    });
    const pending = handle.whenHydrated();

    expect(() => handle.hydrate()).toThrow('expected sync hydration interceptor failure');
    await expect(pending).rejects.toThrow('Hydration failed');
    expect(statusOf(runtime)).toBe('failed');
    handle.dispose();
    runtime.dispose();
  });

  it('stages migrations and emits no rewrite when deserialize or any sibling entry fails', () => {
    const originalTodos = entry(1, ['old']);
    const originalSettings = 'CORRUPT_SECRET_VALUE';
    const memory = createMemoryStorage({
      'reflex/todos': originalTodos,
      'reflex/settings': originalSettings,
    });
    const runtime = makeRuntime({ todos: [] as string[], settings: {} });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: [
        {
          key: 'todos',
          deserialize: (data) => data as string[],
        },
        'settings',
      ],
      version: 2,
      migrate: (_key, data) => data as readonly PersistData[],
    });

    handle.hydrate();

    expect(runtime.getState().todos).toEqual(['old']);
    expect(statusOf(runtime)).toBe('failed');
    expect(memory.setCalls).toBe(0);
    expect(memory.data.get('reflex/todos')).toBe(originalTodos);
    expect(memory.data.get('reflex/settings')).toBe(originalSettings);
    handle.dispose();
    runtime.dispose();

    const deserializeMemory = createMemoryStorage({ 'reflex/todos': originalTodos });
    const deserializeRuntime = makeRuntime({ todos: ['initial'] });
    const deserializeHandle = persist(deserializeRuntime, {
      storage: deserializeMemory.storage,
      keys: [
        {
          key: 'todos',
          deserialize: () => {
            throw new Error('deserialize contains RAW_SECRET');
          },
        },
      ],
      version: 2,
      migrate: (_key, data) => data as readonly PersistData[],
    });
    deserializeHandle.hydrate();
    expect(deserializeRuntime.getState().todos).toEqual(['initial']);
    expect(deserializeMemory.setCalls).toBe(0);
    expect(deserializeMemory.data.get('reflex/todos')).toBe(originalTodos);
    deserializeHandle.dispose();
    deserializeRuntime.dispose();
  });

  it('rejects non-JSON migration output without publishing or erasing the original entry', () => {
    const original = entry(1, { count: 1 });
    const diagnostics: PersistDiagnostic[] = [];
    const memory = createMemoryStorage({ 'reflex/settings': original });
    const runtime = makeRuntime({ settings: { count: 0 } });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: ['settings'],
      version: 2,
      migrate: () => undefined as unknown as PersistData,
      onError: (value) => diagnostics.push(value),
    });

    handle.hydrate();

    expect(runtime.getState().settings).toEqual({ count: 0 });
    expect(statusOf(runtime)).toBe('failed');
    expect(memory.data.get('reflex/settings')).toBe(original);
    expect(memory.setCalls).toBe(0);
    expect(memory.removeCalls).toBe(0);
    expect(diagnostics).toEqual([{ code: 'migration-failed', phase: 'migrate', key: 'settings' }]);
    handle.dispose();
    runtime.dispose();
  });

  it('validates envelope shape and never migrates future versions backwards', () => {
    const migrate = jest.fn((_key: string, data: unknown) => data as string);
    const diagnostics: PersistDiagnostic[] = [];
    const memory = createMemoryStorage({
      'reflex/missingData': JSON.stringify({ v: 1 }),
      'reflex/fractional': JSON.stringify({ v: 1.5, data: true }),
      'reflex/future': entry(3, 'future'),
    });
    const runtime = makeRuntime({ missingData: 'initial', fractional: false, future: 'initial' });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: ['missingData', 'fractional', 'future'],
      version: 2,
      migrate,
      onError: (value) => diagnostics.push(value),
    });

    handle.hydrate();

    expect(statusOf(runtime)).toBe('failed');
    expect(migrate).not.toHaveBeenCalled();
    expect(diagnostics.map(({ code }) => code)).toEqual([
      'invalid-envelope',
      'invalid-version',
      'future-version',
    ]);
    expect(memory.setCalls).toBe(0);
    handle.dispose();
    runtime.dispose();
  });

  it('settles waiters through both raw synchronous and queued hydrate dispatch', async () => {
    const syncRuntime = makeRuntime({ count: 0 });
    const syncHandle = persist(syncRuntime, {
      storage: createMemoryStorage({ 'reflex/count': entry(1, 1) }).storage,
      keys: ['count'],
    });
    const syncPending = syncHandle.whenHydrated();
    syncRuntime.dispatchSync([PERSIST_IDS.HYDRATE]);
    await expect(syncPending).resolves.toBeUndefined();
    expect(syncRuntime.getState().count).toBe(1);
    syncHandle.dispose();
    syncRuntime.dispose();

    const queuedRuntime = makeRuntime({ count: 0 });
    const queuedHandle = persist(queuedRuntime, {
      storage: createMemoryStorage({ 'reflex/count': entry(1, 2) }).storage,
      keys: ['count'],
    });
    const queuedPending = queuedHandle.whenHydrated();
    queuedRuntime.dispatch([PERSIST_IDS.HYDRATE]);
    await expect(queuedPending).resolves.toBeUndefined();
    expect(queuedRuntime.getState().count).toBe(2);
    queuedHandle.dispose();
    queuedRuntime.dispose();
  });

  it('treats repeated hydration as an idempotent no-op', () => {
    const memory = createMemoryStorage({ 'reflex/count': entry(1, 10) });
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });
    runtime.regEvent('count/set', ({ draftState }, count: number) => {
      draftState.count = count;
    });

    handle.hydrate();
    runtime.dispatchSync(['count/set', 20]);
    memory.data.set('reflex/count', entry(1, 5));
    const readsAfterFirstAttempt = memory.getCalls;

    handle.hydrate();
    runtime.dispatchSync([PERSIST_IDS.HYDRATE]);

    expect(runtime.getState().count).toBe(20);
    expect(memory.getCalls).toBe(readsAfterFirstAttempt);
    handle.dispose();
    runtime.dispose();
  });

  it('rejects invalid config, protocol collisions, and duplicate attachments without partial install', () => {
    const memory = createMemoryStorage();
    const runtime = makeRuntime({ count: 0 });

    expect(() => persist(runtime, { storage: memory.storage, keys: ['count', 'count'] })).toThrow(
      'Duplicate configured key',
    );
    expect(() =>
      persist(runtime, { storage: memory.storage, keys: [PERSIST_IDS.STATUS] as never }),
    ).toThrow('reserved');
    expect(() =>
      persist(runtime, { storage: memory.storage, keys: ['count'], version: 0 }),
    ).toThrow('positive safe integer');
    const asyncStorage = createDeferredAsyncStorage().storage;
    expect(() => persist(runtime, { storage: asyncStorage, keys: ['count'] } as never)).toThrow(
      'experimental',
    );

    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });
    expect(() => persist(runtime, { storage: memory.storage, keys: ['count'] })).toThrow(
      'already attached',
    );
    handle.dispose();

    const reattached = persist(runtime, { storage: memory.storage, keys: ['count'] });
    reattached.dispose();
    runtime.dispose();

    const collisionRuntime = makeRuntime({ count: 0 });
    collisionRuntime.regEvent(PERSIST_IDS.HYDRATE, () => {});
    expect(() => persist(collisionRuntime, { storage: memory.storage, keys: ['count'] })).toThrow(
      'Protocol registration collision',
    );
    collisionRuntime.dispose();
  });

  it('shares cleanup with runtime disposal and ignores an in-flight async read', async () => {
    const deferred = createDeferredAsyncStorage({ 'reflex/count': entry(1, 7) });
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage: deferred.storage,
      keys: ['count'],
      experimentalAsync: true,
    });
    handle.hydrate();
    await runtime.flush();
    const pending = handle.whenHydrated();

    runtime.dispose();

    await expect(pending).rejects.toThrow('Disposed before operation completed');
    await expect(handle.whenHydrated()).rejects.toThrow('Disposed before operation completed');
    deferred.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('closes the stale write gate across dispose and reattach', async () => {
    const memory = createMemoryStorage();
    const runtime = makeRuntime({ count: 0 });
    runtime.regEvent('count/bump', ({ draftState }) => {
      draftState.count += 1;
    });
    const first = persist(runtime, { storage: memory.storage, keys: ['count'] });
    first.hydrate();
    runtime.dispatch(['count/bump']);
    await runtime.flush();
    expect(memory.setCalls).toBe(1);
    first.dispose();

    const second = persist(runtime, { storage: memory.storage, keys: ['count'] });
    expect(statusOf(runtime)).toBe('idle');
    runtime.dispatch(['count/bump']);
    await runtime.flush();
    expect(memory.setCalls).toBe(1);

    second.hydrate();
    runtime.dispatch(['count/bump']);
    await runtime.flush();
    expect(memory.setCalls).toBe(2);
    second.dispose();
    runtime.dispose();
  });

  it('purges corrupt entries as explicit recovery and reopens writes', async () => {
    const memory = createMemoryStorage({ 'reflex/count': 'CORRUPT_PURGE_SECRET' });
    const runtime = makeRuntime({ count: 0 });
    runtime.regEvent('count/bump', ({ draftState }) => {
      draftState.count += 1;
    });
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });
    handle.hydrate();
    expect(statusOf(runtime)).toBe('failed');

    await expect(handle.purge()).resolves.toBeUndefined();
    expect(statusOf(runtime)).toBe('hydrated');
    expect(memory.data.has('reflex/count')).toBe(false);
    await expect(handle.whenHydrated()).resolves.toBeUndefined();

    runtime.dispatch(['count/bump']);
    await runtime.flush();
    expect(memory.data.get('reflex/count')).toBe(entry(1, 1));
    handle.dispose();
    runtime.dispose();
  });

  it('does not hydrate across a queued purge request', async () => {
    const storage: SyncPersistStorage = {
      sync: true,
      getItem: () => entry(1, 41),
      setItem: () => {},
      removeItem: () => {
        throw new Error('expected purge failure');
      },
    };
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, { storage, keys: ['count'] });

    const purge = handle.purge();
    expect(() => handle.hydrate()).toThrow('Cannot hydrate while purge is in progress');

    await expect(purge).rejects.toThrow('Purge failed');
    expect(runtime.getState().count).toBe(0);
    expect(statusOf(runtime)).toBe('failed');
    handle.dispose();
    runtime.dispose();
  });

  it('keeps the gate failed when purge removal fails', async () => {
    const storage: SyncPersistStorage = {
      sync: true,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('remove contains PURGE_SECRET');
      },
    };
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, { storage, keys: ['count'] });
    handle.hydrate();

    await expect(handle.purge()).rejects.toThrow('Purge failed');
    expect(statusOf(runtime)).toBe('failed');
    handle.dispose();
    runtime.dispose();
  });

  it('settles purge when a sync adapter violates its remove contract with a thenable', async () => {
    const diagnostics: PersistDiagnostic[] = [];
    const storage = {
      sync: true,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => new Promise<void>(() => {}),
    } as unknown as SyncPersistStorage;
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage,
      keys: ['count'],
      onError: (value) => diagnostics.push(value),
    });
    handle.hydrate();

    await expect(handle.purge()).rejects.toThrow('Purge failed');
    expect(statusOf(runtime)).toBe('failed');
    expect(diagnostics).toEqual([
      { code: 'sync-contract-violation', phase: 'purge', key: 'count' },
    ]);
    handle.dispose();
    runtime.dispose();
  });

  it('processes a purge queued behind an earlier failing event', async () => {
    const memory = createMemoryStorage();
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });
    runtime.regEvent('boom', () => {
      throw new Error('expected queue failure');
    });
    handle.hydrate();

    runtime.dispatch(['boom']);
    const purge = handle.purge();

    await expect(purge).resolves.toBeUndefined();
    expect(memory.removeCalls).toBe(1);
    expect(statusOf(runtime)).toBe('hydrated');
    handle.dispose();
    runtime.dispose();
  });

  it('rejects purge when a later interceptor prevents its remove effect from starting', async () => {
    const memory = createMemoryStorage();
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });
    handle.hydrate();
    runtime.regGlobalInterceptor({
      id: 'block-purge-after-handler',
      after: (context) => {
        if (context.coeffects.event[0] === PERSIST_IDS.PURGE) {
          throw new Error('expected purge interceptor failure');
        }
        return context;
      },
    });

    const purge = handle.purge();

    await expect(
      Promise.race([
        purge,
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => reject(new Error('purge timeout')), 500),
        ),
      ]),
    ).rejects.toThrow('Purge failed');
    expect(memory.removeCalls).toBe(0);
    expect(statusOf(runtime)).toBe('hydrated');
    handle.dispose();
    runtime.dispose();
  });

  it('settles only purge requests accepted by the completing removal attempt', async () => {
    const removals: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    const storage: AsyncPersistStorage = {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: () =>
        new Promise<void>((resolve, reject) => {
          removals.push({ resolve, reject });
        }),
    };
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage,
      keys: ['count'],
      experimentalAsync: true,
    });
    handle.hydrate();
    await handle.whenHydrated();

    const originalDispatch = runtime.dispatch.bind(runtime);
    let observePurged!: () => void;
    const purgedQueued = new Promise<void>((resolve) => {
      observePurged = resolve;
    });
    runtime.dispatch = ((event) => {
      originalDispatch(event);
      if (event[0] === PERSIST_IDS.PURGED) observePurged();
    }) as typeof runtime.dispatch;

    const first = handle.purge();
    await runtime.flush();
    expect(removals).toHaveLength(1);
    removals[0]!.resolve();
    await purgedQueued;

    const second = handle.purge();
    let secondSettled = false;
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );

    await expect(first).resolves.toBeUndefined();
    await runtime.flush();
    expect(removals).toHaveLength(2);
    expect(secondSettled).toBe(false);

    removals[1]!.reject(new Error('expected second purge failure'));
    await expect(second).rejects.toThrow('Purge failed');
    expect(statusOf(runtime)).toBe('failed');
    handle.dispose();
    runtime.dispose();
  });

  it('reports only sanitized key/phase diagnostics', () => {
    const secret = 'RAW_TOP_SECRET_12345';
    const diagnostics: PersistDiagnostic[] = [];
    const memory = createMemoryStorage({ 'reflex/count': secret });
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage: memory.storage,
      keys: ['count'],
      onError: (value) => diagnostics.push(value),
    });

    handle.hydrate();

    expect(diagnostics).toEqual([{ code: 'invalid-json', phase: 'parse', key: 'count' }]);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(diagnostics)).not.toContain(secret);
    handle.dispose();
    runtime.dispose();
  });

  it('attributes interceptor-contributed WRITE to the causing event trace', async () => {
    const memory = createMemoryStorage({ 'reflex/count': entry(1, 41) });
    const runtime = makeRuntime({ count: 0 });
    const collected: Trace[] = [];
    runtime.enableTracing();
    runtime.registerTraceCallback('persist-test', (traces) => collected.push(...traces));
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });
    runtime.regEvent('bump', ({ draftState }) => {
      draftState.count += 1;
    });

    handle.hydrate();
    runtime.dispatch(['bump']);
    await runtime.flush();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const bumpTrace = collected.find((trace) => trace.operation === 'bump');
    expect((bumpTrace?.tags?.effects as unknown[]) ?? []).toContainEqual([
      PERSIST_IDS.WRITE,
      { key: 'count' },
    ]);
    runtime.removeTraceCallback('persist-test');
    handle.dispose();
    runtime.dispose();
  });

  it('uses the context snapshot for writer change detection', () => {
    const memory = createMemoryStorage({ 'reflex/count': entry(1, 41) });
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });
    runtime.regEvent('bump', ({ draftState }) => {
      draftState.count += 1;
    });

    handle.hydrate();
    const getCommittedState = jest.spyOn(runtime, 'getState');
    runtime.dispatchSync(['bump']);

    // The writer compares context.previousState and context.newState. The single
    // runtime read belongs to WRITE after do-fx committed the new generation.
    expect(getCommittedState).toHaveBeenCalledTimes(1);
    expect(memory.data.get('reflex/count')).toBe(entry(1, 42));
    getCommittedState.mockRestore();
    handle.dispose();
    runtime.dispose();
  });

  it('attaches persistence to an explicitly owned runtime', async () => {
    const runtime = createReflexRuntime({
      initialState: { count: 0 },
      runtimeId: 'persist-explicit-attachment',
    });
    runtime.regEvent('increment', ({ draftState }) => {
      (draftState as { count: number }).count += 1;
    });
    const memory = createMemoryStorage({ 'reflex/count': entry(1, 40) });
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });

    handle.hydrate();
    runtime.dispatch(['increment']);
    runtime.dispatch(['increment']);
    await runtime.flush();

    expect((runtime.getState() as { count: number }).count).toBe(42);
    expect(memory.data.get('reflex/count')).toBe(entry(1, 42));
    handle.dispose();
    runtime.dispose();
  });

  it('keeps the experimental async read gated and settles through its event chain', async () => {
    const deferred = createDeferredAsyncStorage({ 'reflex/count': entry(1, 100) });
    const runtime = makeRuntime({ count: 0, ui: { ready: false } });
    const handle = persist(runtime, {
      storage: deferred.storage,
      keys: ['count'],
      experimentalAsync: true,
    });
    runtime.regEvent('boot', ({ draftState }) => {
      draftState.count += 1;
      draftState.ui.ready = true;
    });

    handle.hydrate();
    runtime.dispatch(['boot']);
    await runtime.flush();
    expect(runtime.getState().count).toBe(1);
    expect(deferred.setCalls).toBe(0);

    deferred.release();
    await handle.whenHydrated();
    expect(runtime.getState()).toMatchObject({ count: 100, ui: { ready: true } });
    handle.dispose();
    runtime.dispose();
  });

  it('rejects a purge queued immediately behind experimental async hydration', async () => {
    const deferred = createDeferredAsyncStorage({ 'reflex/count': entry(1, 100) });
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage: deferred.storage,
      keys: ['count'],
      experimentalAsync: true,
    });

    handle.hydrate();
    const purge = handle.purge();
    await expect(purge).rejects.toThrow('Purge failed');

    deferred.release();
    await expect(handle.whenHydrated()).resolves.toBeUndefined();
    expect(runtime.getState().count).toBe(100);
    handle.dispose();
    runtime.dispose();
  });

  it('hydrates when an earlier queue error does not drop an experimental read completion', async () => {
    const runtime = makeRuntime({ count: 0 });
    runtime.regEvent('boom', () => {
      throw new Error('expected completion drop');
    });
    const storage: AsyncPersistStorage = {
      getItem: async () => {
        runtime.dispatch(['boom']);
        return entry(1, 100);
      },
      setItem: async () => {},
      removeItem: async () => {},
    };
    const handle = persist(runtime, {
      storage,
      keys: ['count'],
      experimentalAsync: true,
    });

    handle.hydrate();
    await expect(handle.whenHydrated()).resolves.toBeUndefined();

    expect(statusOf(runtime)).toBe('hydrated');
    expect(runtime.getState().count).toBe(100);
    handle.dispose();
    runtime.dispose();
  });

  it('fails experimental hydration when a later interceptor prevents READ from starting', async () => {
    const deferred = createDeferredAsyncStorage({ 'reflex/count': entry(1, 100) });
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage: deferred.storage,
      keys: ['count'],
      experimentalAsync: true,
    });
    runtime.regGlobalInterceptor({
      id: 'block-hydrate-after-handler',
      after: (context) => {
        if (context.coeffects.event[0] === PERSIST_IDS.HYDRATE) {
          throw new Error('expected hydration interceptor failure');
        }
        return context;
      },
    });

    handle.hydrate();

    await expect(
      Promise.race([
        handle.whenHydrated(),
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => reject(new Error('hydration timeout')), 500),
        ),
      ]),
    ).rejects.toThrow('Hydration failed');
    expect(statusOf(runtime)).toBe('failed');
    expect(deferred.setCalls).toBe(0);
    deferred.release();
    handle.dispose();
    runtime.dispose();
  });

  it('turns an experimental async read rejection into failed status without leaking its cause', async () => {
    const deferred = createDeferredAsyncStorage({}, true);
    const diagnostics: PersistDiagnostic[] = [];
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, {
      storage: deferred.storage,
      keys: ['count'],
      experimentalAsync: true,
      onError: (value) => diagnostics.push(value),
    });

    handle.hydrate();
    deferred.release();
    await expect(handle.whenHydrated()).rejects.toThrow('Hydration failed');

    expect(statusOf(runtime)).toBe('failed');
    expect(diagnostics).toEqual([{ code: 'storage-read-failed', phase: 'read', key: 'count' }]);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('SECRET_READ_CAUSE');
    handle.dispose();
    runtime.dispose();
  });

  it('detaches handlers while leaving the runtime usable', async () => {
    const memory = createMemoryStorage();
    const runtime = makeRuntime({ count: 0 });
    const handle = persist(runtime, { storage: memory.storage, keys: ['count'] });
    runtime.regEvent('bump', ({ draftState }) => {
      draftState.count += 1;
    });
    handle.hydrate();
    handle.dispose();

    runtime.dispatch(['bump']);
    await runtime.flush();
    expect(runtime.getState().count).toBe(1);
    expect(memory.setCalls).toBe(0);
    expect(() => runtime.dispatchSync([PERSIST_IDS.HYDRATE])).toThrow('No event handler');
    runtime.dispose();
  });
});
