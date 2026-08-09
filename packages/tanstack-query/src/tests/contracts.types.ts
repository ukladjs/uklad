import { createUkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladContracts } from '@ukladjs/core/vanilla';

import { QueryClient, readQueryData, regQuerySub } from '../index';

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
  };
}

const queryClient = new QueryClient();
const runtime = createUkladRuntime<AppContracts>({
  initialState: { todosStateDetail: undefined, todoById: {} },
});
runtime.registerModule((registrar) => {
  registrar.regRootSub('todos/state-detail', 'todosStateDetail');
  regQuerySub(
    registrar,
    queryClient,
    'todos/state-detail',
    { stateKey: 'todosStateDetail', update: (_current, value) => value },
    () => [],
    () => ({
      queryKey: ['todos', 1] as const,
      queryFn: async (): Promise<Todo> => ({ id: 1, title: 'Typed through state' }),
    }),
    (query) => query.data,
  );

  registrar.regRootSub('todos/by-id-state', 'todoById');
  registrar.regSub(
    'todos/by-id',
    () => [['todos/by-id-state']],
    ([todoById], id) => todoById[id],
  );
  regQuerySub(
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
});

const cachedTodo: Todo | undefined = readQueryData<Todo>(queryClient, ['todos', 1]);
void cachedTodo;
