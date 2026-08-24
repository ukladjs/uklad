# Uklad Agent Router

This project uses production-ready `@ukladjs/core`. Its documented public API
is compatibility-protected and is the baseline for 1.0. Preserve Uklad as the
single owner of application state; do not introduce Redux or Zustand beside it. Prefer the Uklad Agent Toolkit plugin
and its Uklad skill; this file is only a compact fallback.

For application-authored Uklad work:

- Discover through `src/app/uklad/catalog.ts` -> `contracts.ts` -> the owning feature or selected `platform/<target>` adapter. Search one exact catalog literal or symbol; do not scan every feature.
- Keep one direct-literal `stateKeys`/`appIds` catalog and one complete `AppContracts`. Feature modules group registrations; one execution owner has one runtime and one reactive graph.
- Give independently changing or observed values separate feature-prefixed top-level roots. Use `regRootSub` for direct roots and `regSub` only for view-ready derivation from complete, static dependencies.
- Treat initial/hydrated state, accepted event values, snapshots, and subscription results as runtime-owned. Mutate state only through an event handler's Immer `draftState`; never mutate a dispatched value afterward.
- Keep handlers, coeffects, interceptors, and subscription functions synchronous. Return declarative effects; never dispatch or schedule host work inside an event turn.
- Use only bounded scalar subscription parameters (`string`, finite `number`, `boolean`, or `null`) and choose a deliberate equality policy for every computed result.
- Keep effects, coeffects, and external query lifecycles in target-specific platform adapters under stable application IDs. Views subscribe and dispatch intent; they do not own application derivation or a second server-state provider.

For live verification:

- Call `app_status` after a cold start or reload, select `runtimeId` when needed, and use only advertised capabilities. Prefer typed `get_handlers`, path-scoped `get_state`, `eval_sub`, and filtered traces.
- Use `dispatch_and_wait` when operation snapshots are advertised and mutation was explicitly granted; use `dispatch_event` only as the compatibility path. Never work around `CAPABILITY_DENIED`.
- If no app is connected, start the project-local `devtools:mcp` script, reload the app if needed, and retry. Browser servers require the exact repeatable `--allow-origin`; headless runtimes do not.
- Treat redacted values as security behavior and a changed `sessionEpoch` as a new session. Verify with the narrowest formatter, typecheck, focused test, and runtime evidence that adds value.
