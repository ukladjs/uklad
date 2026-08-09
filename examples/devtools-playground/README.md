# DevTools playground

Run the browser playground with:

```sh
pnpm --filter @ukladjs/devtools-playground dev
```

It starts Vite on [http://localhost:3000](http://localhost:3000) and a local
server-data fixture on `127.0.0.1:8788`. The browser app proxies
`/api/playground` to that fixture and uses `@ukladjs/tanstack-query` to show
three ordinary Uklad subscription patterns: a polling root, a parameterized
derived subscription backed by a shared keyed root, and a query switched by a
passive Uklad signal.

To inspect it, start the DevTools server separately:

```sh
pnpm dev:server:mcp
```

The root server command permits the playground's `http://localhost:3000`
origin. The headless playground remains Node-safe and does not install the
browser query adapter:

```sh
pnpm dev:playground:headless
```
