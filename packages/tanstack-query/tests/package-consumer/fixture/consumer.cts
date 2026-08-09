import uklad = require('@ukladjs/core/vanilla');
import query = require('@ukladjs/tanstack-query');
import type { UkladContracts } from '@ukladjs/core/vanilla';

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

const queryClient = new query.QueryClient();
const runtime = uklad.createUkladRuntime<AppContracts>({
  initialState: { todoDetail: undefined, selectedTodo: undefined },
});
const detachQueryClient = query.attachQueryClient(runtime, queryClient);
runtime.registerModule((registrar) => {
  registrar.regRootSub('todos/detail', 'todoDetail');
  query.regQuerySub(
    registrar,
    queryClient,
    'todos/detail',
    { stateKey: 'todoDetail', update: (_current, value) => value },
    () => [],
    () => ({
      queryKey: ['todos', 1] as const,
      queryFn: async (): Promise<Todo> => ({ id: 1, title: 'Packed' }),
    }),
    (result) => result.data,
  );
  registrar.regRootSub('todos/selected', 'selectedTodo');
  query.regQuerySub(
    registrar,
    queryClient,
    'todos/selected',
    { stateKey: 'selectedTodo', update: (_current, value) => value },
    () => [],
    () => ({
      queryKey: ['todos', 1] as const,
      queryFn: async (): Promise<Todo> => ({ id: 1, title: 'Mapped from package' }),
    }),
    (result) => result.data,
  );
});

const snapshot: query.QuerySnapshot<Todo> | undefined = undefined;
void snapshot;

detachQueryClient();
runtime.dispose();
queryClient.clear();
