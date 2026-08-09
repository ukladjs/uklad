import { createUkladRuntimeForTests as createUkladRuntime } from '@ukladjs/core/internal';

import { QueryClient, attachQueryClient, readQueryData, regQuerySub } from '../index';

interface Todo {
  readonly id: number;
  readonly title: string;
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

async function waitForExtensionPublication(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 24));
  await Promise.resolve();
}

async function waitForQueryState(runtime: { flush(): Promise<void> }): Promise<void> {
  // A state-backed query crosses two normal runtime boundaries:
  // extension lifecycle → internal event → state publication.
  for (let index = 0; index < 4; index++) {
    await waitForExtensionPublication();
    await runtime.flush();
  }
}

describe('@ukladjs/tanstack-query', () => {
  it('routes observer updates through managed Uklad state and switch-maps declared dependencies', async () => {
    const queryClient = createQueryClient();
    const queryFns = new Map<number, jest.Mock<Promise<Todo>, []>>();
    const runtime = createUkladRuntime({
      initialState: { selectedId: 1, selectedTodo: undefined as Todo | undefined },
      runtimeId: `query-state-bridge-${++runtimeSequence}`,
    });
    const detachClient = attachQueryClient(runtime, queryClient);
    runtime.registerModule((registrar) => {
      registrar.regEvent('todos/select', ({ draftState }, id: number) => {
        draftState.selectedId = id;
      });
      registrar.regRootSub('todos/selected-id', 'selectedId');
      registrar.regRootSub('todos/selected', 'selectedTodo');
      regQuerySub(
        registrar,
        queryClient,
        'todos/selected',
        { stateKey: 'selectedTodo', update: (_current, value) => value },
        () => [['todos/selected-id']],
        ([id]) => {
          const queryFn =
            queryFns.get(id) ?? jest.fn(async () => ({ id, title: `Todo ${id}` }) satisfies Todo);
          queryFns.set(id, queryFn);
          return {
            queryKey: ['todos', id] as const,
            queryFn,
          };
        },
        (query) => query.data,
      );
    });

    try {
      expect(runtime.getSubscriptionValue(['todos/selected'])).toBeUndefined();
      expect(queryFns.get(1)).toBeUndefined();

      const observed: unknown[] = [];
      const unsubscribe = runtime.watchSubscription(['todos/selected'], (snapshot) => {
        observed.push(snapshot);
      });
      await waitForQueryState(runtime);
      expect(queryFns.get(1)).toHaveBeenCalledTimes(1);
      expect(
        runtime.getSubscriptionDiagnostics().find((item) => item.query[0] === 'todos/selected')
          ?.kind,
      ).toBe('root');
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 1] })
          ?.getObserversCount(),
      ).toBe(1);

      runtime.dispatchSync(['todos/select', 2]);
      await waitForQueryState(runtime);
      expect(queryFns.get(2)).toHaveBeenCalledTimes(1);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 1] })
          ?.getObserversCount(),
      ).toBe(0);

      queryClient.setQueryData(['todos', 2], {
        id: 2,
        title: 'Selected through state',
      } satisfies Todo);
      await waitForQueryState(runtime);
      expect(observed.at(-1)).toEqual({ id: 2, title: 'Selected through state' });
      expect(runtime.getState()).toMatchObject({
        selectedTodo: { id: 2, title: 'Selected through state' },
      });
      expect(runtime.getState()).not.toHaveProperty('__ukladjs/query');
      expect(runtime.getSubscriptionValue(['todos/selected'])).toEqual({
        id: 2,
        title: 'Selected through state',
      });

      unsubscribe();
      await runtime.flush();
    } finally {
      detachClient();
      runtime.dispose();
      queryClient.clear();
    }
  });

  it('stores parameterized derived queries in an explicit backing root', async () => {
    const queryClient = createQueryClient();
    const runtime = createUkladRuntime({
      initialState: { todoById: {} as Record<number, Todo | undefined> },
      runtimeId: `query-parameterized-root-${++runtimeSequence}`,
    });
    const detachClient = attachQueryClient(runtime, queryClient);
    runtime.registerModule((registrar) => {
      registrar.regRootSub('todos/by-id-state', 'todoById');
      registrar.regSub(
        'todos/by-id',
        () => [['todos/by-id-state']],
        ([todoById], id: number) => todoById[id],
      );
      regQuerySub(
        registrar,
        queryClient,
        'todos/by-id',
        {
          stateKey: 'todoById',
          update: (todoById, value, id: number) =>
            Object.is(todoById[id], value) ? todoById : { ...todoById, [id]: value },
        },
        () => [],
        (_signals, id: number) => ({
          queryKey: ['todos', id] as const,
          queryFn: async () => ({ id, title: `Todo ${id}` }) satisfies Todo,
        }),
        (query) => query.data,
      );
    });

    try {
      const stopFirst = runtime.watchSubscription(['todos/by-id', 1], () => {});
      const stopSecond = runtime.watchSubscription(['todos/by-id', 2], () => {});
      await waitForQueryState(runtime);

      expect(runtime.getSubscriptionValue(['todos/by-id', 1])).toEqual({
        id: 1,
        title: 'Todo 1',
      });
      expect(runtime.getSubscriptionValue(['todos/by-id', 2])).toEqual({
        id: 2,
        title: 'Todo 2',
      });
      expect(runtime.getState()).toMatchObject({
        todoById: {
          1: { id: 1, title: 'Todo 1' },
          2: { id: 2, title: 'Todo 2' },
        },
      });
      expect(
        runtime.getSubscriptionDiagnostics().find((item) => item.query[0] === 'todos/by-id')?.kind,
      ).toBe('computed');

      stopFirst();
      await runtime.flush();
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 1] })
          ?.getObserversCount(),
      ).toBe(0);
      expect(
        queryClient
          .getQueryCache()
          .find({ queryKey: ['todos', 2] })
          ?.getObserversCount(),
      ).toBe(1);
      stopSecond();
      await runtime.flush();
    } finally {
      detachClient();
      runtime.dispose();
      queryClient.clear();
    }
  });

  it('does not cross the Uklad state boundary for a structurally equal refetch', async () => {
    const queryClient = createQueryClient();
    let title = 'Unchanged';
    const queryFn = jest.fn(async () => [{ id: 1, title }] satisfies Todo[]);
    const runtime = createUkladRuntime({
      initialState: { todosList: undefined as Todo[] | undefined },
      runtimeId: `query-data-dedup-${++runtimeSequence}`,
    });
    const detachClient = attachQueryClient(runtime, queryClient);
    runtime.registerModule((registrar) => {
      registrar.regRootSub('todos/list', 'todosList');
      regQuerySub(
        registrar,
        queryClient,
        'todos/list',
        { stateKey: 'todosList', update: (_current, value) => value },
        () => [],
        () => ({
          queryKey: ['todos'] as const,
          queryFn,
          staleTime: 30_000,
        }),
        (query) => query.data,
      );
    });

    try {
      const unsubscribe = runtime.watchSubscription(['todos/list'], () => {});
      await waitForQueryState(runtime);
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(runtime.getSubscriptionValue(['todos/list'])).toEqual([{ id: 1, title: 'Unchanged' }]);

      const beforeEqualRefetch = runtime.getStateRevisions();
      await queryClient.invalidateQueries({ queryKey: ['todos'] });
      await waitForQueryState(runtime);

      expect(queryFn).toHaveBeenCalledTimes(2);
      expect(runtime.getStateRevisions()).toEqual(beforeEqualRefetch);

      title = 'Changed';
      await queryClient.invalidateQueries({ queryKey: ['todos'] });
      await waitForQueryState(runtime);

      expect(queryFn).toHaveBeenCalledTimes(3);
      expect(runtime.getStateRevisions().committedRevision).toBe(
        beforeEqualRefetch.committedRevision + 1,
      );
      expect(runtime.getSubscriptionValue(['todos/list'])).toEqual([{ id: 1, title: 'Changed' }]);
      unsubscribe();
      await runtime.flush();
    } finally {
      detachClient();
      runtime.dispose();
      queryClient.clear();
    }
  });

  it('publishes lifecycle state only when the mapper explicitly observes it', async () => {
    const queryClient = createQueryClient();
    const initialTodo = { id: 1, title: 'Cached' } satisfies Todo;
    const refreshed = createDeferred<Todo>();
    const queryFn = jest.fn(() => refreshed.promise);
    queryClient.setQueryData(['todos', 1], initialTodo);
    const runtime = createUkladRuntime({
      initialState: {
        todoDetail: undefined as
          { readonly todo: Todo | undefined; readonly refreshing: boolean } | undefined,
      },
      runtimeId: `query-lifecycle-opt-in-${++runtimeSequence}`,
    });
    const detachClient = attachQueryClient(runtime, queryClient);
    runtime.registerModule((registrar) => {
      registrar.regRootSub('todos/detail', 'todoDetail');
      regQuerySub(
        registrar,
        queryClient,
        'todos/detail',
        { stateKey: 'todoDetail', update: (_current, value) => value },
        () => [],
        () => ({
          queryKey: ['todos', 1] as const,
          queryFn,
          staleTime: 30_000,
        }),
        (query) => ({ todo: query.data, refreshing: query.isFetching }),
        { observe: ['data', 'error', 'isFetching'] },
      );
    });

    try {
      const unsubscribe = runtime.watchSubscription(['todos/detail'], () => {});
      await waitForQueryState(runtime);
      expect(queryFn).not.toHaveBeenCalled();
      const beforeRefetch = runtime.getStateRevisions();

      const refetch = queryClient.invalidateQueries({ queryKey: ['todos', 1] });
      await waitForQueryState(runtime);

      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(runtime.getSubscriptionValue(['todos/detail'])).toEqual({
        todo: initialTodo,
        refreshing: true,
      });
      expect(runtime.getStateRevisions().committedRevision).toBe(
        beforeRefetch.committedRevision + 1,
      );

      refreshed.resolve(initialTodo);
      await refetch;
      await waitForQueryState(runtime);

      expect(runtime.getSubscriptionValue(['todos/detail'])).toEqual({
        todo: initialTodo,
        refreshing: false,
      });
      expect(runtime.getStateRevisions().committedRevision).toBe(
        beforeRefetch.committedRevision + 2,
      );
      unsubscribe();
      await runtime.flush();
    } finally {
      detachClient();
      runtime.dispose();
      queryClient.clear();
    }
  });

  it('owns QueryClient mount and unmount through the Uklad module lifecycle', () => {
    const queryClient = createQueryClient();
    const mount = jest.spyOn(queryClient, 'mount');
    const unmount = jest.spyOn(queryClient, 'unmount');
    const runtime = createUkladRuntime({
      initialState: {},
      runtimeId: `query-client-lifecycle-${++runtimeSequence}`,
    });

    const detach = attachQueryClient(runtime, queryClient);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(() => attachQueryClient(runtime, queryClient)).toThrow('already attached');

    detach();
    expect(unmount).toHaveBeenCalledTimes(1);

    const reattach = attachQueryClient(runtime, queryClient);
    expect(mount).toHaveBeenCalledTimes(2);
    reattach();
    expect(unmount).toHaveBeenCalledTimes(2);
    runtime.dispose();
    queryClient.clear();
  });

  it('provides a narrow synchronous cache read for coeffects', () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(['todos', 3], { id: 3, title: 'Cached' } satisfies Todo);

    expect(readQueryData<Todo>(queryClient, ['todos', 3])).toEqual({ id: 3, title: 'Cached' });
    expect(readQueryData<Todo>(queryClient, ['todos', 4])).toBeUndefined();
    queryClient.clear();
  });
});

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve: (value) => resolve!(value),
  };
}
