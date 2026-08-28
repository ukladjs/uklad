const assert = require('node:assert/strict');

const { createUkladRuntime } = require('@ukladjs/core/vanilla');
const { createUkladTestHarness } = require('@ukladjs/core/testing');
const { QueryClient: HostQueryClient } = require('@tanstack/query-core');
const {
  QueryClient,
  attachQueryClient,
  readQueryData,
  readQueryState,
  regQueryProjection,
  regQuerySub,
} = require('@ukladjs/tanstack-query');

assert.equal(QueryClient, HostQueryClient, 'the adapter must use the application Query Core peer');

const queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: Infinity, retry: false } },
});
const runtime = createUkladRuntime({
  initialState: { packedTodo: undefined, packedMappedTodo: undefined, packedCached: undefined },
});
const testHarness = createUkladTestHarness(runtime);
const detachQueryClient = attachQueryClient(runtime, queryClient, {
  cacheCoeffects: [
    {
      id: 'packed/cached',
      read: (cache) => cache.getData(queryKeyForPackedTodo()),
    },
  ],
});
runtime.registerModule((registrar) => {
  registrar.regEvent(
    'packed/read-cache',
    ({ draftState, coeffects: { cached } }) => {
      draftState.packedCached = cached;
    },
    { coeffects: { cached: 'packed/cached' } },
  );
  registrar.regRootSub('packed/todo', 'packedTodo');
  regQueryProjection(
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
  regQueryProjection(
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
  regQuerySub(
    registrar,
    queryClient,
    'packed/external',
    () => [],
    () => ({
      queryKey: ['packed/external'],
      queryFn: async () => ({ id: 3, title: 'External' }),
      staleTime: Infinity,
    }),
    (query) => query.data,
  );
});

function queryKeyForPackedTodo() {
  return ['packed/todo', 2];
}

async function main() {
  queryClient.setQueryData(['packed/todo', 2], { id: 2, title: 'Cached' });
  testHarness.dispatchSync(['packed/read-cache']);
  assert.equal(testHarness.getState().packedCached.title, 'Cached');
  const unsubscribeTodo = testHarness.watchSubscription(['packed/todo'], () => {});
  const unsubscribeMappedTodo = testHarness.watchSubscription(['packed/mapped-todo'], () => {});
  queryClient.setQueryData(['packed/external'], { id: 3, title: 'External' });
  const unsubscribeExternal = testHarness.watchSubscription(['packed/external'], () => {});
  await new Promise((resolve) => setTimeout(resolve, 24));
  await testHarness.flush();

  assert.equal(testHarness.getSubscriptionValue(['packed/todo']).title, 'Cached');
  assert.equal(readQueryData(queryClient, ['packed/todo', 2]).title, 'Cached');
  assert.equal(readQueryState(queryClient, ['packed/todo', 2]).data.title, 'Cached');
  assert.equal(testHarness.getSubscriptionValue(['packed/mapped-todo']).title, 'Cached');
  assert.equal(testHarness.getSubscriptionValue(['packed/external']).title, 'External');

  unsubscribeExternal();
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
