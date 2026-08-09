# TodoMVC with Uklad and TanStack Query

Run the example with:

```sh
pnpm --filter todomvc-query dev
```

It starts an in-memory Todo API on `127.0.0.1:8787` and Vite on
`http://localhost:5174`. The API data resets when the process restarts. Use
`TODO_API_PORT=9000` or `TODO_VITE_PORT=5175` to choose different ports.

For runtime inspection, start the DevTools server in another terminal:

```sh
pnpm dev:server:mcp
```

The root server script explicitly permits the query example's default origin
`http://localhost:5174`. If you choose another Vite port, add that exact origin
to the DevTools server command as well.

By default the client connects to `127.0.0.1:4000`. For another local DevTools
port, set `VITE_UKLAD_DEVTOOLS_SERVER_URL`, for example
`VITE_UKLAD_DEVTOOLS_SERVER_URL=127.0.0.1:4001 pnpm dev:todomvc-query`.

## Data ownership

- TanStack Query owns one canonical `['todos', 'list']` cache entry.
- `todos/query` is an ordinary Uklad root subscription over the `todosQuery`
  state field. The selected platform's `effects.ts` registers `regQuerySub`,
  attaches its lifecycle-managed TanStack `QueryObserver`, and projects it into
  the feature's clean `loading | ready | error` read model.
- `todosQuery` stores only that projected result, never the complete TanStack
  observer snapshot. `todosShowing` remains the local UI filter.
- Its `visible`, `all-complete`, and footer-count subscriptions derive from
  the clean `todos/query` result.
- Views use `useSubscription`, not `QueryClientProvider` or `useQuery`.
- Uklad events route user intent to effects. The effects execute TanStack
  `MutationObserver`s; successful mutations invalidate the canonical list key.

The bridge observes `data` and `error` by default. An invalidation therefore
does not create Uklad updates for TanStack's intermediate `stale` and
`fetching` states, and a structurally equal server response produces no Uklad
update at all. A query that wants to expose `isFetching` can opt into it in its
`regQuerySub` configuration.

The `All`, `Active`, and `Completed` filters do **not** create three remote
queries. They are cheap projections of a small, fully loaded collection and
therefore share one cache and one invalidation path. Introduce filtered query
keys only when filtering/pagination belongs on the server or when each subset
has a distinct lifecycle.
