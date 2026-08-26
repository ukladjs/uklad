# React Native persistence fixture

This is the bare React Native counterpart to the Expo fixture. It uses
`@react-native-async-storage/async-storage` through `asyncStorageAdapter()` and
exercises asynchronous hydration, per-key write ordering, `purge()`, and
`flush()` when the app backgrounds.

The screen gates domain actions until the persistence status is `hydrated`.
Failed hydration exposes explicit retry and purge recovery controls, preventing
user changes from being replaced by a late AsyncStorage snapshot.

This is a complete bare React Native shell, including the generated `android/`
and `ios/` projects. Install the workspace dependencies, then run it on a
simulator or device:

```sh
pnpm install
pnpm --filter @ukladjs/persist build
pnpm --filter @ukladjs/react-native-persist-demo typecheck
pnpm --filter @ukladjs/react-native-persist-demo start
```

Run `pnpm --filter @ukladjs/react-native-persist-demo android` or `ios`; iOS
requires CocoaPods (`cd ios && bundle exec pod install`) before the first run.
The Expo-managed equivalent is in
`../expo-persist`.
