import { createUkladRuntimeForTests as createUkladRuntime } from '@ukladjs/core/internal';
import type { QueryState } from '@tanstack/query-core';
import type { UkladContracts } from '@ukladjs/core/vanilla';

import { attachQueryClient, QueryClient, readQueryData, readQueryState } from '../index';

interface Todo {
  readonly id: number;
  readonly title: string;
}

interface CacheContracts extends UkladContracts {
  readonly state: {
    readonly cachedTodos: Todo[] | undefined;
    readonly cachedTodo: Todo | undefined;
    readonly cachedState: Readonly<QueryState<Todo>> | undefined;
    readonly eventName: string | undefined;
  };
  readonly events: {
    readonly 'cache/read-list': [];
    readonly 'cache/read-item': [id: number];
    readonly 'cache/read-state': [];
    readonly 'cache/read-missing': [];
  };
  readonly coeffects: {
    readonly 'todos/cached-list': {
      readonly arg: void;
      readonly value: readonly Todo[] | undefined;
    };
    readonly 'todos/cached-item': {
      readonly arg: number;
      readonly value: Todo | undefined;
    };
    readonly 'todos/cached-state': {
      readonly arg: void;
      readonly value: Readonly<QueryState<Todo>> | undefined;
    };
    readonly 'todos/event-read': {
      readonly arg: void;
      readonly value: Todo | undefined;
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

function createRuntime(
  initialState: CacheContracts['state'] = {
    cachedTodos: undefined,
    cachedTodo: undefined,
    cachedState: undefined,
    eventName: undefined,
  },
) {
  return createUkladRuntime<CacheContracts>({
    initialState,
    runtimeId: `cache-coeffects-${++runtimeSequence}`,
  });
}

describe('attachment-managed TanStack cache coeffects', () => {
  it('registers synchronous data and state readers with typed arguments', () => {
    const queryClient = createQueryClient();
    const todo = { id: 1, title: 'Cached' } satisfies Todo;
    queryClient.setQueryData(['todos', 'list'], [todo]);
    queryClient.setQueryData(['todos', 1], todo);
    const runtime = createRuntime({
      cachedTodos: undefined,
      cachedTodo: undefined,
      cachedState: undefined,
      eventName: undefined,
    });

    const detach = attachQueryClient(runtime, queryClient, {
      cacheCoeffects: [
        {
          id: 'todos/cached-list',
          read: (cache) => cache.getData<readonly Todo[]>(['todos', 'list']),
        },
        {
          id: 'todos/cached-item',
          read: (cache, id) => cache.getData<Todo>(['todos', id]),
        },
        {
          id: 'todos/cached-state',
          read: (cache) => cache.getState<Todo>(['todos', 1]),
        },
      ],
    });

    runtime.registerModule((registrar) => {
      registrar.regEvent(
        'cache/read-list',
        ({ draftState, coeffects: { cachedTodos } }) => {
          draftState.cachedTodos = cachedTodos === undefined ? undefined : [...cachedTodos];
        },
        { coeffects: { cachedTodos: 'todos/cached-list' } },
      );
      registrar.regEvent(
        'cache/read-item',
        ({ draftState, coeffects: { cachedTodo } }) => {
          draftState.cachedTodo = cachedTodo;
        },
        { coeffects: { cachedTodo: ['todos/cached-item', 1] } },
      );
      registrar.regEvent(
        'cache/read-state',
        ({ draftState, coeffects: { cachedState } }) => {
          draftState.cachedState = cachedState;
        },
        { coeffects: { cachedState: 'todos/cached-state' } },
      );
    });

    try {
      runtime.dispatchSync(['cache/read-list']);
      runtime.dispatchSync(['cache/read-item', 1]);
      runtime.dispatchSync(['cache/read-state']);

      expect(runtime.getState().cachedTodos).toEqual([todo]);
      expect(runtime.getState().cachedTodo).toEqual(todo);
      expect(runtime.getState().cachedState).toMatchObject({
        data: todo,
        status: 'success',
      });
      expect(Object.isFrozen(runtime.getState().cachedState)).toBe(true);
      expect(readQueryData<readonly Todo[]>(queryClient, ['todos', 'list'])).toEqual([todo]);
      expect(readQueryState<Todo>(queryClient, ['todos', 1])).toEqual(
        runtime.getState().cachedState,
      );
    } finally {
      detach();
      runtime.dispose();
      queryClient.clear();
    }
  });

  it('passes a frozen narrow reader and event context to domain projections', () => {
    const queryClient = createQueryClient();
    const todo = { id: 7, title: 'From event context' } satisfies Todo;
    queryClient.setQueryData(['todos', 7], todo);
    const runtime = createRuntime({
      cachedTodos: undefined,
      cachedTodo: undefined,
      cachedState: undefined,
      eventName: undefined,
    });
    let readerKeys: string[] = [];
    let contextEvent: string | undefined;

    const detach = attachQueryClient(runtime, queryClient, {
      cacheCoeffects: [
        {
          id: 'todos/event-read',
          read: (cache, _arg, context) => {
            readerKeys = Object.keys(cache).sort();
            contextEvent = context.event[0];
            expect(Object.isFrozen(cache)).toBe(true);
            expect(cache).not.toHaveProperty('fetchQuery');
            expect(cache).not.toHaveProperty('invalidateQueries');
            return cache.getData<Todo>(['todos', context.event[1] as number]);
          },
        },
      ],
    });

    runtime.registerModule((registrar) => {
      registrar.regEvent(
        'cache/read-item',
        ({ draftState, coeffects: { cachedTodo } }) => {
          draftState.cachedTodo = cachedTodo;
        },
        { coeffects: { cachedTodo: 'todos/event-read' } },
      );
    });

    try {
      runtime.dispatchSync(['cache/read-item', 7]);

      expect(runtime.getState().cachedTodo).toEqual(todo);
      expect(readerKeys).toEqual(['getData', 'getState']);
      expect(contextEvent).toBe('cache/read-item');
    } finally {
      detach();
      runtime.dispose();
      queryClient.clear();
    }
  });

  it('injects a cache miss as undefined without aborting the event', () => {
    const queryClient = createQueryClient();
    const runtime = createRuntime({
      cachedTodos: undefined,
      cachedTodo: { id: 3, title: 'Previous' },
      cachedState: undefined,
      eventName: undefined,
    });
    const detach = attachQueryClient(runtime, queryClient, {
      cacheCoeffects: [
        {
          id: 'todos/cached-list',
          read: (cache) => cache.getData<readonly Todo[]>(['todos', 'missing']),
        },
      ],
    });

    runtime.registerModule((registrar) => {
      registrar.regEvent(
        'cache/read-missing',
        ({ draftState, coeffects: { cachedTodos } }) => {
          draftState.cachedTodos = cachedTodos === undefined ? undefined : [...cachedTodos];
          draftState.eventName = cachedTodos === undefined ? 'miss' : 'hit';
        },
        { coeffects: { cachedTodos: 'todos/cached-list' } },
      );
    });

    try {
      runtime.dispatchSync(['cache/read-missing']);
      expect(runtime.getState()).toMatchObject({ cachedTodos: undefined, eventName: 'miss' });
    } finally {
      detach();
      runtime.dispose();
      queryClient.clear();
    }
  });

  it('aborts the event when a configured reader throws', () => {
    const queryClient = createQueryClient();
    const runtime = createRuntime({
      cachedTodos: undefined,
      cachedTodo: undefined,
      cachedState: undefined,
      eventName: undefined,
    });
    const detach = attachQueryClient(runtime, queryClient, {
      cacheCoeffects: [
        {
          id: 'todos/cached-list',
          read: () => {
            throw new Error('reader failed');
          },
        },
      ],
    });

    runtime.registerModule((registrar) => {
      registrar.regEvent(
        'cache/read-list',
        ({ draftState }) => {
          draftState.eventName = 'called';
        },
        { coeffects: { cachedTodos: 'todos/cached-list' } },
      );
    });

    try {
      expect(() => runtime.dispatchSync(['cache/read-list'])).toThrow('reader failed');
      expect(runtime.getState().eventName).toBeUndefined();
    } finally {
      detach();
      runtime.dispose();
      queryClient.clear();
    }
  });

  it('removes attachment registrations on disposal', () => {
    const queryClient = createQueryClient();
    const runtime = createRuntime();
    const detach = attachQueryClient(runtime, queryClient, {
      cacheCoeffects: [
        {
          id: 'todos/cached-list',
          read: () => [],
        },
      ],
    });

    expect(runtime.getHandlers().cofx['todos/cached-list']).toEqual(expect.any(Function));
    detach();
    expect(runtime.getHandlers().cofx['todos/cached-list']).toBeUndefined();

    runtime.dispose();
    queryClient.clear();
  });

  it('rolls back partial coeffect installation and rejects collisions', () => {
    const queryClient = createQueryClient();
    const mount = jest.spyOn(queryClient, 'mount');
    const unmount = jest.spyOn(queryClient, 'unmount');
    const runtime = createRuntime();

    expect(() =>
      attachQueryClient(runtime, queryClient, {
        cacheCoeffects: [
          { id: 'todos/cached-list', read: () => [] },
          { id: 'todos/cached-list', read: () => [] },
        ],
      }),
    ).toThrow('already registered');

    expect(mount).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
    expect(runtime.getHandlers().cofx['todos/cached-list']).toBeUndefined();

    const detach = attachQueryClient(runtime, queryClient, {
      cacheCoeffects: [{ id: 'todos/cached-list', read: () => [] }],
    });
    expect(mount).toHaveBeenCalledTimes(1);
    detach();
    expect(unmount).toHaveBeenCalledTimes(1);

    runtime.dispose();
    queryClient.clear();
  });
});
