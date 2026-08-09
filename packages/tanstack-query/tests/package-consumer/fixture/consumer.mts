import { createUkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladContracts } from '@ukladjs/core/vanilla';
import { QueryClient, attachQueryClient, regQuerySub } from '@ukladjs/tanstack-query';
import type { QuerySnapshot } from '@ukladjs/tanstack-query';

interface Todo {
  readonly id: number;
  readonly title: string;
}

interface AppContracts extends UkladContracts {
  readonly state: {
    readonly todoDetail: Todo | undefined;
    readonly selectedTodo: Todo | undefined;
  };
  readonly subscriptions: {
    readonly 'todos/detail': {
      readonly params: [];
      readonly result: Todo | undefined;
    };
    readonly 'todos/selected': {
      readonly params: [];
      readonly result: Todo | undefined;
    };
  };
}

const queryClient = new QueryClient();
const runtime = createUkladRuntime<AppContracts>({
  initialState: { todoDetail: undefined, selectedTodo: undefined },
});
const detachQueryClient = attachQueryClient(runtime, queryClient);
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
      queryFn: async (): Promise<Todo> => ({ id: 1, title: 'Packed' }),
    }),
    (query) => query.data,
  );
  registrar.regRootSub('todos/selected', 'selectedTodo');
  regQuerySub(
    registrar,
    queryClient,
    'todos/selected',
    { stateKey: 'selectedTodo', update: (_current, value) => value },
    () => [],
    () => ({
      queryKey: ['todos', 1] as const,
      queryFn: async (): Promise<Todo> => ({ id: 1, title: 'Mapped from package' }),
    }),
    (query) => query.data,
  );
});

const snapshot: QuerySnapshot<Todo> | undefined = undefined;
void snapshot;

detachQueryClient();
runtime.dispose();
queryClient.clear();
