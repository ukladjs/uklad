/**
 * @flexsurfer/reflex-persist — persistence as Reflex primitives.
 *
 * The package exposes one stable root entrypoint. Implementation modules stay
 * private so storage engines and lifecycle internals can evolve without
 * creating a public subpath API during beta.
 */

export { localStorageAdapter, memoryStorageAdapter } from './adapters';
export { PERSIST_IDS } from './ids';
export { persist } from './persist';
export type {
  AsyncPersistStorage,
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
} from './types';
