import { createUkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladContracts } from '@ukladjs/core/vanilla';
import { attachQueryClient, QueryClient, regQuerySub } from '@ukladjs/tanstack-query';

interface Todo {
  readonly id: number;
  readonly title: string;
}

interface DocsContracts extends UkladContracts {
  readonly coeffects: {
    readonly 'todos/cached-list': {
      readonly arg: void;
      readonly value: readonly Todo[] | undefined;
    };
  };
  readonly state: {
    readonly selectedTodoId: number;
  };
  readonly subscriptions: {
    readonly 'ui/selected-todo-id': {
      readonly params: [];
      readonly result: number;
    };
    readonly 'todos/selected': {
      readonly params: [];
      readonly result: Todo | undefined;
    };
  };
}

const runtime = createUkladRuntime<DocsContracts>({
  initialState: { selectedTodoId: 42 },
});
const queryClient = new QueryClient();

const detachQueryClient = attachQueryClient(runtime, queryClient, {
  cacheCoeffects: [
    {
      id: 'todos/cached-list',
      read: (cache) => cache.getData<readonly Todo[]>(['todos', 'list']),
    },
  ],
});

runtime.registerModule((registrar) => {
  registrar.regRootSub('ui/selected-todo-id', 'selectedTodoId');
  regQuerySub(
    registrar,
    queryClient,
    'todos/selected',
    () => [['ui/selected-todo-id']],
    ([id]) => ({
      queryKey: ['todos', id] as const,
      queryFn: async (): Promise<Todo> => ({ id, title: 'Documented setup' }),
    }),
    (query) => query.data,
  );
  registrar.regEvent(
    'todos/use-cached',
    ({ coeffects: { cachedTodos } }) => {
      void cachedTodos;
    },
    { coeffects: { cachedTodos: 'todos/cached-list' } },
  );
});

void detachQueryClient;
void runtime;
