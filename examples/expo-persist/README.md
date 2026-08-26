# Expo persistence fixture

This managed Expo app uses `expo-sqlite/kv-store` through
`syncStorageAdapter()` and exercises synchronous hydration, writes, and
`purge()` against a real native SQLite-backed key-value store.

Run it from the workspace after building the package:

```sh
pnpm install
pnpm --filter @ukladjs/persist build
pnpm --filter @ukladjs/expo-persist-demo typecheck
pnpm --filter @ukladjs/expo-persist-demo start
```

The fixture imports the default `Storage` object from `expo-sqlite/kv-store`.
`syncStorageAdapter()` accepts its
`getItemSync`/`setItemSync`/`removeItemSync` methods, so hydration and writes
finish before their Uklad event/effect returns. The AsyncStorage counterpart is
the bare React Native fixture in `../react-native-persist`. The screen renders a
status/recovery gate until persistence is hydrated, so domain actions never run
while configured-root writes are closed.
