/**
 * @ukladjs/persist — persistence as Uklad primitives.
 *
 * The package exposes one stable root entrypoint. Implementation modules stay
 * private so storage engines and lifecycle internals can evolve without
 * creating a public subpath API during the initial release.
 */

export {
  asyncStorageAdapter,
  localStorageAdapter,
  memoryStorageAdapter,
  syncStorageAdapter,
} from './adapters';
export { PERSIST_IDS } from './ids';
export { persist } from './persist';
export type {
  AsyncPersistStorage,
  AsyncStorageLike,
  PersistContractState,
  PersistContracts,
  PersistData,
  PersistDiagnostic,
  PersistErrorCode,
  PersistErrorPhase,
  PersistEventPayloads,
  PersistHandle,
  PersistKey,
  PersistKeyConfig,
  PersistOptions,
  PersistStatus,
  PersistStorage,
  PersistSubscriptionPayloads,
  SyncPersistStorage,
  SyncMethodsStorageLike,
  SyncStorageLike,
} from './types';
