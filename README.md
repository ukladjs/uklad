# Reflex monorepo

This repository contains the Reflex runtime, its developer tools, the MCP bridge, and the applications used to develop and verify them together.

## Workspaces

- [`@flexsurfer/reflex`](packages/reflex) — the published state-management runtime.
- [`@flexsurfer/reflex-devtools`](packages/reflex-devtools) — the published SDK, server, and CLI.
- [`@flexsurfer/reflex-devtools-mcp`](packages/reflex-devtools-mcp) — the published MCP bridge.
- [`@flexsurfer/reflex-devtools-ui`](packages/reflex-devtools-ui) — the private dashboard embedded in the DevTools package.
- [`TodoMVC`](examples/todomvc) and [`DevTools playground`](examples/devtools-playground) — private example applications.

## Development

Use Node.js `^22.18.0` or `>=24.11.0` and the pnpm version pinned in `package.json`.

```sh
pnpm install
pnpm build
pnpm check
```

Targeted development commands are available for the runtime, dashboard, DevTools server, playground, and MCP bridge through the root `package.json`.

The DevTools source was imported as a snapshot of `flexsurfer/reflex-devtools` commit `9d3d14add591be751c2ad5b9a03d2f0a0941ff00`.
