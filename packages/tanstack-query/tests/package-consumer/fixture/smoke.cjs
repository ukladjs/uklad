const assert = require('node:assert/strict');

const { createUkladRuntime } = require('@ukladjs/core/vanilla');
const { createUkladTestHarness } = require('@ukladjs/core/testing');
const { QueryClient: HostQueryClient } = require('@tanstack/query-core');
const {
  QueryClient,
  attachQueryClient,
  readQueryData,
  regQuerySub,
} = require('@ukladjs/tanstack-query');

assert.equal(QueryClient, HostQueryClient, 'the adapter must use the application Query Core peer');

const queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: Infinity, retry: false } },
});
const runtime = createUkladRuntime({
  initialState: { packedTodo: undefined, packedMappedTodo: undefined },
});
const testHarness = createUkladTestHarness(runtime);
const detachQueryClient = attachQueryClient(runtime, queryClient);
runtime.registerModule((registrar) => {
  registrar.regRootSub('packed/todo', 'packedTodo');
  regQuerySub(
    registrar,
    queryClient,
    'packed/todo',
    { stateKey: 'packedTodo', update: (_current, value) => value },
    () => [],
    () => ({
      queryKey: ['packed/todo', 2],
      queryFn: async () => ({ id: 2, title: 'Fetched' }),
      staleTime: Infinity,
    }),
    (query) => query.data,
  );
  registrar.regRootSub('packed/mapped-todo', 'packedMappedTodo');
  regQuerySub(
    registrar,
    queryClient,
    'packed/mapped-todo',
    { stateKey: 'packedMappedTodo', update: (_current, value) => value },
    () => [],
    () => ({
      queryKey: ['packed/todo', 2],
      queryFn: async () => ({ id: 2, title: 'Fetched mapped value' }),
      staleTime: Infinity,
    }),
    (query) => query.data,
  );
});

async function main() {
  queryClient.setQueryData(['packed/todo', 2], { id: 2, title: 'Cached' });
  const unsubscribeTodo = testHarness.watchSubscription(['packed/todo'], () => {});
  const unsubscribeMappedTodo = testHarness.watchSubscription(['packed/mapped-todo'], () => {});
  await new Promise((resolve) => setTimeout(resolve, 24));
  await testHarness.flush();

  assert.equal(testHarness.getSubscriptionValue(['packed/todo']).title, 'Cached');
  assert.equal(readQueryData(queryClient, ['packed/todo', 2]).title, 'Cached');
  assert.equal(testHarness.getSubscriptionValue(['packed/mapped-todo']).title, 'Cached');

  unsubscribeMappedTodo();
  unsubscribeTodo();
  detachQueryClient();
  runtime.dispose();
  queryClient.clear();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
