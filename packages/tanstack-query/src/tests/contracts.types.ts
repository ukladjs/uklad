import { createUkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladContracts } from '@ukladjs/core/vanilla';

import {
  attachQueryClient,
  QueryClient,
  readQueryData,
  regQueryProjection,
  regQuerySub,
} from '../index';
import type { QuerySnapshot } from '../index';

interface Todo {
  readonly id: number;
  readonly title: string;
}

interface AppContracts extends UkladContracts {
  readonly state: {
    readonly todosStateDetail: Todo | undefined;
    readonly todoById: Readonly<Partial<Record<number, Todo>>>;
  };
  readonly subscriptions: {
    readonly 'todos/state-detail': {
      readonly params: [];
      readonly result: Todo | undefined;
    };
    readonly 'todos/by-id-state': {
      readonly params: [];
      readonly result: Readonly<Partial<Record<number, Todo>>>;
    };
    readonly 'todos/by-id': {
      readonly params: [id: number];
      readonly result: Todo | undefined;
    };
    readonly 'todos/external-by-id': {
      readonly params: [id: number];
      readonly result: Todo | undefined;
    };
  };
}

const queryClient = new QueryClient();
const runtime = createUkladRuntime<AppContracts>({
  initialState: { todosStateDetail: undefined, todoById: {} },
});
runtime.registerModule((registrar) => {
  registrar.regRootSub('todos/state-detail', 'todosStateDetail');
  regQueryProjection(
    registrar,
    queryClient,
    'todos/state-detail',
    { stateKey: 'todosStateDetail', update: (_current, value) => value },
    () => [],
    () => ({
      queryKey: ['todos', 1] as const,
      queryFn: async (): Promise<Todo> => ({ id: 1, title: 'Typed through state' }),
    }),
    (query: QuerySnapshot<Todo>) => query.data,
  );

  registrar.regRootSub('todos/by-id-state', 'todoById');
  registrar.regSub(
    'todos/by-id',
    () => [['todos/by-id-state']],
    ([todoById], id) => todoById[id],
  );
  regQueryProjection(
    registrar,
    queryClient,
    'todos/by-id',
    {
      stateKey: 'todoById',
      update: (todoById, value, id) => ({ ...todoById, [id]: value }),
    },
    () => [],
    (_signals, id) => ({
      queryKey: ['todos', id] as const,
      queryFn: async (): Promise<Todo> => ({ id, title: `Todo ${id}` }),
    }),
    (query) => query.data,
  );

  regQuerySub(
    registrar,
    queryClient,
    'todos/external-by-id',
    () => [],
    (_signals, id) => ({
      queryKey: ['todos', 'external', id] as const,
      queryFn: async (): Promise<Todo> => ({ id, title: `Typed external ${id}` }),
    }),
    (query) => query.data,
  );

  regQuerySub(
    registrar,
    queryClient,
    'todos/external-by-id',
    // @ts-expect-error The public regQuerySub API is cache-owned and has no state target.
    { stateKey: 'todosStateDetail', update: (_current, value) => value },
    () => [],
    () => ({
      queryKey: ['todos', 'external', 1] as const,
      queryFn: async (): Promise<Todo> => ({ id: 1, title: 'Invalid target' }),
    }),
    (query: QuerySnapshot<Todo>) => query.data,
  );
});

const cachedTodo: Todo | undefined = readQueryData<Todo>(queryClient, ['todos', 1]);
void cachedTodo;

interface CacheContracts extends UkladContracts {
  readonly coeffects: {
    readonly 'todos/cached-list': {
      readonly arg: void;
      readonly value: readonly Todo[] | undefined;
    };
    readonly 'todos/cached-item': {
      readonly arg: number;
      readonly value: Todo | undefined;
    };
  };
}

const cacheRuntime = createUkladRuntime<CacheContracts>({ initialState: {} });
const cacheClient = new QueryClient();
const detachCache = attachQueryClient(cacheRuntime, cacheClient, {
  cacheCoeffects: [
    {
      id: 'todos/cached-list',
      read: (cache) => cache.getData<readonly Todo[]>(['todos']),
    },
    {
      id: 'todos/cached-item',
      read: (cache, id) => cache.getData<Todo>(['todos', id]),
    },
  ],
});
void detachCache;

attachQueryClient(cacheRuntime, new QueryClient(), {
  cacheCoeffects: [
    {
      // @ts-expect-error The cache coeffect id must be declared in the contract.
      id: 'todos/unknown',
      read: () => undefined,
    },
  ],
});

attachQueryClient(cacheRuntime, new QueryClient(), {
  cacheCoeffects: [
    {
      id: 'todos/cached-item',
      // @ts-expect-error A required coeffect argument is a number.
      read: (cache, id: string) => cache.getData<Todo>(['todos', id]),
    },
  ],
});

attachQueryClient(cacheRuntime, new QueryClient(), {
  cacheCoeffects: [
    {
      id: 'todos/cached-item',
      // @ts-expect-error The reader result must match the declared value.
      read: () => 'not-a-todo',
    },
  ],
});
