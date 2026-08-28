import { createUkladRuntimeForTests as createUkladRuntime } from '@ukladjs/core/internal';
import type { UkladContracts, UkladRegistrar } from '@ukladjs/core/vanilla';

import { attachQueryClient, QueryClient, regQuerySub } from '../index';

interface Todo {
  readonly id: number;
  readonly title: string;
}

type QueryValue<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: T }
  | { readonly kind: 'error'; readonly message: string };

interface ExternalQueryContracts extends UkladContracts {
  readonly state: {
    readonly queryEnabled: boolean;
  };
  readonly subscriptions: {
    readonly 'query/enabled-input': {
      readonly params: [];
      readonly result: boolean;
    };
    readonly 'query/cached': {
      readonly params: [];
      readonly result: QueryValue<Todo>;
    };
    readonly 'query/enabled': {
      readonly params: [];
      readonly result: QueryValue<Todo>;
    };
    readonly 'query/item': {
      readonly params: [id: number];
      readonly result: QueryValue<Todo>;
    };
    readonly 'query/failing': {
      readonly params: [];
      readonly result: QueryValue<Todo>;
    };
    readonly 'query/lifecycle': {
      readonly params: [];
      readonly result: { readonly data: Todo | undefined; readonly refreshing: boolean };
    };
  };
}

let runtimeSequence = 0;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
  });
}

async function settleQuery(runtime: { flush(): Promise<void> }): Promise<void> {
  // Query Core schedules observer notifications with a zero-delay timer while
  // Uklad keeps its own event/publication queue. Give both boundaries time to
  // settle so the assertions observe the public external-subscription value.
  for (let index = 0; index < 5; index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await runtime.flush();
  }
}

function install(
  register: (registrar: UkladRegistrar<ExternalQueryContracts>, queryClient: QueryClient) => void,
  initialState: ExternalQueryContracts['state'] = { queryEnabled: false },
) {
  const queryClient = createQueryClient();
  const runtime = createUkladRuntime<ExternalQueryContracts>({
    initialState,
    runtimeId: `external-query-${++runtimeSequence}`,
  });
  const detach = attachQueryClient(runtime, queryClient);
  runtime.registerModule((registrar) => register(registrar, queryClient));
  return { queryClient, runtime, detach };
}

function toQueryValue<T>(query: { data: T | undefined; error: Error | null }): QueryValue<T> {
  if (query.error !== null) return { kind: 'error', message: query.error.message };
  if (query.data === undefined) return { kind: 'loading' };
  return { kind: 'ready', data: query.data };
}

function dispose(runtime: { dispose(): void }, detach: () => void, queryClient: QueryClient): void {
  detach();
  runtime.dispose();
  queryClient.clear();
}

describe('cache-owned TanStack Query subscriptions', () => {
  it('reads hydrated cache data synchronously without activation or fetching', () => {
    const todo = { id: 1, title: 'Hydrated' } satisfies Todo;
    const queryFn = jest.fn(async () => todo);
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/cached',
        () => [],
        () => ({
          queryKey: ['todos', 1] as const,
          queryFn,
          staleTime: Infinity,
        }),
        (query) => toQueryValue(query),
      );
    });
    queryClient.setQueryData(['todos', 1], todo);

    try {
      expect(runtime.getSubscriptionValue(['query/cached'])).toEqual({
        kind: 'ready',
        data: todo,
      });
      expect(queryFn).not.toHaveBeenCalled();
      expect(queryClient.isFetching({ queryKey: ['todos', 1] })).toBe(0);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 1] })
          ?.getObserversCount(),
      ).toBe(0);
      expect(runtime.getState()).toEqual({ queryEnabled: false });
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('re-reads a cache value that changes between render and first subscription', () => {
    const first = { id: 10, title: 'Rendered value' } satisfies Todo;
    const next = { id: 10, title: 'Committed value' } satisfies Todo;
    const queryFn = jest.fn(async () => next);
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/cached',
        () => [],
        () => ({
          queryKey: ['todos', 10] as const,
          queryFn,
          staleTime: Infinity,
        }),
        (query) => toQueryValue(query),
      );
    });
    queryClient.setQueryData(['todos', 10], first);

    try {
      expect(runtime.getSubscriptionValue(['query/cached'])).toEqual({
        kind: 'ready',
        data: first,
      });
      queryClient.setQueryData(['todos', 10], next);

      const updates: QueryValue<Todo>[] = [];
      const stop = runtime.watchSubscription(['query/cached'], (value) => updates.push(value), {
        emitInitial: false,
      });

      expect(runtime.getSubscriptionValue(['query/cached'])).toEqual({
        kind: 'ready',
        data: next,
      });
      expect(updates).toHaveLength(0);
      expect(queryFn).not.toHaveBeenCalled();
      stop();
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('activates an uncached observer only when watched and invalidates on fetch completion', async () => {
    const todo = { id: 2, title: 'Fetched' } satisfies Todo;
    const queryFn = jest.fn(async () => todo);
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/cached',
        () => [],
        () => ({
          queryKey: ['todos', 2] as const,
          queryFn,
          staleTime: Infinity,
        }),
        (query) => toQueryValue(query),
      );
    });

    try {
      expect(runtime.getSubscriptionValue(['query/cached'])).toEqual({ kind: 'loading' });
      expect(queryFn).not.toHaveBeenCalled();

      const updates: QueryValue<Todo>[] = [];
      const stop = runtime.watchSubscription(['query/cached'], (value) => updates.push(value));
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(updates[0]).toEqual({ kind: 'loading' });
      await settleQuery(runtime);

      expect(runtime.getSubscriptionValue(['query/cached'])).toEqual({
        kind: 'ready',
        data: todo,
      });
      expect(updates.at(-1)).toEqual({ kind: 'ready', data: todo });
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 2] })
          ?.getObserversCount(),
      ).toBe(1);
      stop();
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 2] })
          ?.getObserversCount(),
      ).toBe(0);
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('applies same-key option changes through QueryObserver.setOptions', async () => {
    const todo = { id: 3, title: 'Enabled later' } satisfies Todo;
    const queryFn = jest.fn(async () => todo);
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      registrar.regRootSub('query/enabled-input', 'queryEnabled');
      registrar.regEvent('query/enable', ({ draftState }) => {
        draftState.queryEnabled = true;
      });
      regQuerySub(
        registrar,
        queryClient,
        'query/enabled',
        () => [['query/enabled-input']],
        ([enabled]) => ({
          queryKey: ['todos', 'same-key'] as const,
          queryFn,
          enabled,
          staleTime: Infinity,
        }),
        (query) => toQueryValue(query),
      );
    });

    try {
      const stop = runtime.watchSubscription(['query/enabled'], () => {});
      await settleQuery(runtime);
      expect(queryFn).not.toHaveBeenCalled();

      runtime.dispatchSync(['query/enable']);
      await settleQuery(runtime);

      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(runtime.getSubscriptionValue(['query/enabled'])).toEqual({
        kind: 'ready',
        data: todo,
      });
      stop();
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('reads a cached destination during a dependency-driven query-key switch', async () => {
    const first = { id: 8, title: 'Initial key' } satisfies Todo;
    const second = { id: 9, title: 'Cached destination' } satisfies Todo;
    const queryFns = new Map<boolean, jest.Mock<Promise<Todo>, []>>();
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      registrar.regRootSub('query/enabled-input', 'queryEnabled');
      registrar.regEvent('query/enable', ({ draftState }) => {
        draftState.queryEnabled = true;
      });
      regQuerySub(
        registrar,
        queryClient,
        'query/enabled',
        () => [['query/enabled-input']],
        ([enabled]) => {
          const queryFn = queryFns.get(enabled) ?? jest.fn(async () => (enabled ? second : first));
          queryFns.set(enabled, queryFn);
          return {
            queryKey: ['todos', 'switch', enabled] as const,
            queryFn,
            staleTime: Infinity,
          };
        },
        (query) => toQueryValue(query),
      );
    });
    queryClient.setQueryData(['todos', 'switch', false], first);
    queryClient.setQueryData(['todos', 'switch', true], second);

    try {
      const stop = runtime.watchSubscription(['query/enabled'], () => {});
      expect(runtime.getSubscriptionValue(['query/enabled'])).toEqual({
        kind: 'ready',
        data: first,
      });
      const beforeSwitch = runtime.getStateRevisions();

      runtime.dispatchSync(['query/enable']);
      await settleQuery(runtime);

      expect(runtime.getSubscriptionValue(['query/enabled'])).toEqual({
        kind: 'ready',
        data: second,
      });
      expect(queryFns.get(true)).toBeDefined();
      expect(queryFns.get(true)!).not.toHaveBeenCalled();
      expect(runtime.getStateRevisions().committedRevision).toBe(
        beforeSwitch.committedRevision + 1,
      );
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 'switch', false] })
          ?.getObserversCount(),
      ).toBe(0);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 'switch', true] })
          ?.getObserversCount(),
      ).toBe(1);
      stop();
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('keeps parameterized vectors isolated while releasing only the final vector', async () => {
    const queryFns = new Map<number, jest.Mock<Promise<Todo>, []>>();
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/item',
        () => [],
        (_signals, id: number) => {
          const queryFn = queryFns.get(id) ?? jest.fn(async () => ({ id, title: `Item ${id}` }));
          queryFns.set(id, queryFn);
          return {
            queryKey: ['todos', 'item', id] as const,
            queryFn,
            staleTime: Infinity,
          };
        },
        (query) => toQueryValue(query),
      );
    });

    try {
      const stopFirst = runtime.watchSubscription(['query/item', 1], () => {});
      const stopSecond = runtime.watchSubscription(['query/item', 2], () => {});
      await settleQuery(runtime);

      expect(runtime.getSubscriptionValue(['query/item', 1])).toEqual({
        kind: 'ready',
        data: { id: 1, title: 'Item 1' },
      });
      expect(runtime.getSubscriptionValue(['query/item', 2])).toEqual({
        kind: 'ready',
        data: { id: 2, title: 'Item 2' },
      });
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 'item', 1] })
          ?.getObserversCount(),
      ).toBe(1);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 'item', 2] })
          ?.getObserversCount(),
      ).toBe(1);

      stopFirst();
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 'item', 1] })
          ?.getObserversCount(),
      ).toBe(0);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 'item', 2] })
          ?.getObserversCount(),
      ).toBe(1);
      stopSecond();
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 'item', 2] })
          ?.getObserversCount(),
      ).toBe(0);

      queryClient.setQueryData(['todos', 'item', 1], { id: 1, title: 'Cached again' });
      expect(runtime.getSubscriptionValue(['query/item', 1])).toEqual({
        kind: 'ready',
        data: { id: 1, title: 'Cached again' },
      });
      expect(queryFns.get(1)).toHaveBeenCalledTimes(1);
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('coalesces a reentrant cache invalidation burst at the final value', async () => {
    const queryKey = ['todos', 'burst'] as const;
    const queryFn = jest.fn(async () => ({ id: 20, title: 'Query function' }) satisfies Todo);
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/cached',
        () => [],
        () => ({ queryKey, queryFn, staleTime: Infinity }),
        (query) => toQueryValue(query),
      );
    });
    queryClient.setQueryData(queryKey, { id: 20, title: 'Initial' } satisfies Todo);
    const beforeRevisions = runtime.getStateRevisions();

    try {
      let burstIssued = false;
      const updates: QueryValue<Todo>[] = [];
      const stop = runtime.watchSubscription(['query/cached'], (value) => {
        updates.push(value);
        if (burstIssued || value.kind !== 'ready' || value.data.title !== 'Value 1') return;
        burstIssued = true;
        for (let value = 2; value <= 32; value++) {
          queryClient.setQueryData(queryKey, { id: 20, title: `Value ${value}` } satisfies Todo);
        }
      });

      queryClient.setQueryData(queryKey, { id: 20, title: 'Value 1' } satisfies Todo);
      await settleQuery(runtime);

      expect(burstIssued).toBe(true);
      expect(runtime.getSubscriptionValue(['query/cached'])).toEqual({
        kind: 'ready',
        data: { id: 20, title: 'Value 32' },
      });
      expect(updates.at(-1)).toEqual({
        kind: 'ready',
        data: { id: 20, title: 'Value 32' },
      });
      expect(queryFn).not.toHaveBeenCalled();
      expect(runtime.getStateRevisions()).toEqual(beforeRevisions);
      stop();
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('releases rapidly churned vectors while retaining results only in TanStack cache', async () => {
    const queryFns = new Map<number, jest.Mock<Promise<Todo>, []>>();
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/item',
        () => [],
        (_signals, id: number) => {
          const queryFn = queryFns.get(id) ?? jest.fn(async () => ({ id, title: `Fetched ${id}` }));
          queryFns.set(id, queryFn);
          return {
            queryKey: ['todos', 'churn', id] as const,
            queryFn,
            staleTime: Infinity,
          };
        },
        (query) => toQueryValue(query),
      );
    });
    const beforeRevisions = runtime.getStateRevisions();

    try {
      for (let id = 0; id < 32; id++) {
        const queryKey = ['todos', 'churn', id] as const;
        const todo = { id, title: `Cached ${id}` } satisfies Todo;
        queryClient.setQueryData(queryKey, todo);
        const stop = runtime.watchSubscription(['query/item', id], () => {});

        expect(runtime.getSubscriptionValue(['query/item', id])).toEqual({
          kind: 'ready',
          data: todo,
        });
        stop();
      }
      await settleQuery(runtime);

      expect(runtime.getSubscriptionDiagnostics()).toEqual([]);
      expect(runtime.getStateRevisions()).toEqual(beforeRevisions);
      for (let id = 0; id < 32; id++) {
        const queryKey = ['todos', 'churn', id] as const;
        expect(queryClient.getQueryData(queryKey)).toEqual({ id, title: `Cached ${id}` });
        expect(queryClient.getQueryCache().find({ queryKey })?.getObserversCount()).toBe(0);
        expect(queryFns.get(id)).not.toHaveBeenCalled();
      }
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('keeps query-result changes outside Uklad state revisions', async () => {
    const initial = { id: 4, title: 'Initial' } satisfies Todo;
    const next = { id: 4, title: 'Next' } satisfies Todo;
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/cached',
        () => [],
        () => ({
          queryKey: ['todos', 4] as const,
          queryFn: async () => initial,
          staleTime: Infinity,
        }),
        (query) => toQueryValue(query),
      );
    });
    queryClient.setQueryData(['todos', 4], initial);

    try {
      const stop = runtime.watchSubscription(['query/cached'], () => {});
      const beforeUpdate = runtime.getStateRevisions();
      queryClient.setQueryData(['todos', 4], next);
      await settleQuery(runtime);

      expect(runtime.getSubscriptionValue(['query/cached'])).toEqual({
        kind: 'ready',
        data: next,
      });
      expect(runtime.getStateRevisions()).toEqual(beforeUpdate);
      expect(runtime.getState()).toEqual({ queryEnabled: false });
      stop();
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('retains mapper failures as subscription errors and recovers on a later cache update', async () => {
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/failing',
        () => [],
        () => ({
          queryKey: ['todos', 'failing'] as const,
          queryFn: async () => ({ id: 5, title: 'valid' }) satisfies Todo,
          staleTime: Infinity,
        }),
        (query) => {
          if (query.data?.title === 'bad') throw new Error('mapper failed');
          return toQueryValue(query);
        },
      );
    });
    queryClient.setQueryData(['todos', 'failing'], { id: 5, title: 'valid' } satisfies Todo);

    try {
      const updates: QueryValue<Todo>[] = [];
      const stop = runtime.watchSubscription(['query/failing'], (value) => updates.push(value));
      queryClient.setQueryData(['todos', 'failing'], { id: 5, title: 'bad' } satisfies Todo);
      await settleQuery(runtime);

      expect(runtime.getSubscriptionDiagnostics()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: JSON.stringify(['query/failing']),
            kind: 'external',
            status: 'error',
            error: 'mapper failed',
          }),
        ]),
      );

      queryClient.setQueryData(['todos', 'failing'], { id: 5, title: 'recovered' } satisfies Todo);
      await settleQuery(runtime);
      expect(runtime.getSubscriptionValue(['query/failing'])).toEqual({
        kind: 'ready',
        data: { id: 5, title: 'recovered' },
      });
      expect(updates.at(-1)).toEqual({
        kind: 'ready',
        data: { id: 5, title: 'recovered' },
      });
      stop();
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('only publishes lifecycle fields when they are explicitly observed', async () => {
    const initial = { id: 6, title: 'Initial' } satisfies Todo;
    let resolveRefresh!: (value: Todo) => void;
    const refreshed = new Promise<Todo>((resolve) => {
      resolveRefresh = resolve;
    });
    const queryFn = jest.fn(() => refreshed);
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/lifecycle',
        () => [],
        () => ({
          queryKey: ['todos', 'lifecycle'] as const,
          queryFn,
          staleTime: 30_000,
        }),
        (query) => ({ data: query.data, refreshing: query.isFetching }),
      );
    });
    queryClient.setQueryData(['todos', 'lifecycle'], initial);

    try {
      const updates: Array<{ data: Todo | undefined; refreshing: boolean }> = [];
      const stop = runtime.watchSubscription(['query/lifecycle'], (value) => updates.push(value));
      queryClient.invalidateQueries({ queryKey: ['todos', 'lifecycle'] });
      await settleQuery(runtime);

      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(runtime.getSubscriptionValue(['query/lifecycle'])).toEqual({
        data: initial,
        refreshing: false,
      });
      expect(updates).toHaveLength(1);

      resolveRefresh({ id: 6, title: 'Refreshed' });
      await settleQuery(runtime);
      expect(runtime.getSubscriptionValue(['query/lifecycle'])).toEqual({
        data: { id: 6, title: 'Refreshed' },
        refreshing: false,
      });
      stop();
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });

  it('observes opt-in lifecycle fields and disposes the observer after the final consumer', async () => {
    const initial = { id: 7, title: 'Initial' } satisfies Todo;
    let resolveRefresh!: (value: Todo) => void;
    const refreshed = new Promise<Todo>((resolve) => {
      resolveRefresh = resolve;
    });
    const queryFn = jest.fn(() => refreshed);
    const { runtime, queryClient, detach } = install((registrar, queryClient) => {
      regQuerySub(
        registrar,
        queryClient,
        'query/lifecycle',
        () => [],
        () => ({
          queryKey: ['todos', 'lifecycle-opt-in'] as const,
          queryFn,
          staleTime: 30_000,
        }),
        (query) => ({ data: query.data, refreshing: query.isFetching }),
        { observe: ['data', 'error', 'isFetching'] },
      );
    });
    queryClient.setQueryData(['todos', 'lifecycle-opt-in'], initial);

    try {
      const updates: Array<{ data: Todo | undefined; refreshing: boolean }> = [];
      const stop = runtime.watchSubscription(['query/lifecycle'], (value) => updates.push(value));
      queryClient.invalidateQueries({ queryKey: ['todos', 'lifecycle-opt-in'] });
      await settleQuery(runtime);

      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(updates).toContainEqual({ data: initial, refreshing: true });
      expect(runtime.getSubscriptionValue(['query/lifecycle'])).toEqual({
        data: initial,
        refreshing: true,
      });

      resolveRefresh({ id: 7, title: 'Refreshed' });
      await settleQuery(runtime);
      expect(runtime.getSubscriptionValue(['query/lifecycle'])).toEqual({
        data: { id: 7, title: 'Refreshed' },
        refreshing: false,
      });
      stop();
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 'lifecycle-opt-in'] })
          ?.getObserversCount(),
      ).toBe(0);
    } finally {
      dispose(runtime, detach, queryClient);
    }
  });
});
