import type {
  ContractState,
  ContractEventPayloads,
  ContractSubscriptionPayloads,
  UkladContracts,
} from '@ukladjs/core/vanilla';

import type { PERSIST_IDS } from './ids';

export type PersistStatus = 'idle' | 'hydrating' | 'hydrated' | 'failed';

/** Storage whose methods are guaranteed to finish before returning. */
export interface SyncPersistStorage {
  readonly sync: true;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Promise-based string key-value storage used by React Native and Expo. */
export interface AsyncPersistStorage {
  readonly sync?: false;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Structural adapter input accepted by `asyncStorageAdapter()`. */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Structural adapter input accepted by `syncStorageAdapter()`. */
export interface SyncStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Sync-method shape exposed by Expo SQLite's key-value store. */
export interface SyncMethodsStorageLike {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
  removeItemSync(key: string): void;
}

export type PersistStorage = SyncPersistStorage | AsyncPersistStorage;

/** JSON data accepted from synchronous serializers and migrations. */
export type PersistData =
  | null
  | string
  | number
  | boolean
  | readonly PersistData[]
  | { readonly [key: string]: PersistData };

/** A configured state root, optionally with value transforms. */
export interface PersistKeyConfig<TKey extends string = string, TValue = unknown> {
  readonly key: TKey;
  /** App-state value to JSON-compatible stored data. Must be synchronous. */
  readonly serialize?: (value: TValue) => PersistData;
  /** JSON-parsed stored data to an state value. Must be synchronous. */
  readonly deserialize?: (data: unknown) => TValue;
}

export type AnyState = Record<string, any>;
type StateStringKey<TState extends AnyState> = Extract<keyof TState, string>;
type PersistKeyConfigForState<TState extends AnyState> = {
  [TKey in StateStringKey<TState>]: PersistKeyConfig<TKey, TState[TKey]>;
}[StateStringKey<TState>];

export type PersistKey<TState extends AnyState = AnyState> =
  StateStringKey<TState> | PersistKeyConfigForState<TState>;

export type PersistErrorPhase =
  | 'read'
  | 'parse'
  | 'validate'
  | 'migrate'
  | 'deserialize'
  | 'serialize'
  | 'write'
  | 'purge'
  | 'lifecycle';

export type PersistErrorCode =
  | 'storage-read-failed'
  | 'invalid-storage-value'
  | 'sync-contract-violation'
  | 'invalid-json'
  | 'invalid-envelope'
  | 'invalid-version'
  | 'future-version'
  | 'migration-required'
  | 'migration-failed'
  | 'deserialize-failed'
  | 'serialize-failed'
  | 'storage-write-failed'
  | 'storage-remove-failed'
  | 'invalid-completion'
  | 'event-queue-failed'
  | 'purge-during-hydration';

/** Sanitized failure metadata. It intentionally contains no error cause or stored value. */
export interface PersistDiagnostic {
  readonly code: PersistErrorCode;
  readonly phase: PersistErrorPhase;
  readonly key?: string;
}

interface PersistBaseOptions<TState extends AnyState> {
  /** Non-empty list of state root keys to persist. */
  readonly keys: readonly PersistKey<TState>[];
  /** Positive safe-integer schema version written into every entry. Default 1. */
  readonly version?: number;
  /** Migrates serialized data from an older version. Must be synchronous and pure. */
  readonly migrate?: (key: string, data: unknown, fromVersion: number) => PersistData;
  /** Storage namespace. Entries live at `<prefix>/<encoded-root-key>`. Default `uklad`. */
  readonly prefix?: string;
  /** Receives sanitized diagnostics after the causing event commits. */
  readonly onError?: (diagnostic: PersistDiagnostic) => void;
}

/**
 * Persistence configuration. Both synchronous and ordered asynchronous storage
 * are supported. `experimentalAsync` is retained as a source-compatible no-op
 * for applications that opted into the original prototype.
 */
export type PersistOptions<TState extends AnyState = AnyState> = PersistBaseOptions<TState> &
  (
    | {
        readonly storage: SyncPersistStorage;
        readonly experimentalAsync?: never;
      }
    | {
        readonly storage: AsyncPersistStorage;
        /** @deprecated Async storage is now supported without an opt-in. */
        readonly experimentalAsync?: true;
      }
  );

export interface PersistHandle {
  /** Start hydration. Repeated calls are idempotent while active or hydrated. */
  hydrate(): void;
  /** Wait for hydration; gate events that change persisted roots on its resolution. */
  whenHydrated(): Promise<void>;
  /** Remove configured entries and reopen writes from the current state on success. */
  purge(): Promise<void>;
  /** Wait for accepted writes to settle durably; failures remain visible until superseded. */
  flush(): Promise<void>;
  /** Detach the module and wait until active storage work can no longer outlive ownership. */
  dispose(): Promise<void>;
}

/** Optional state field contributed by persistence to a strict runtime contract. */
export interface PersistContractState {
  readonly [PERSIST_IDS.STATUS]?: PersistStatus;
}

/** Public control events contributed by persistence to a strict runtime contract. */
export interface PersistEventPayloads {
  readonly [PERSIST_IDS.HYDRATE]: [];
  readonly [PERSIST_IDS.PURGE]: [];
}

/** Public status subscription contributed by persistence to a strict runtime contract. */
export interface PersistSubscriptionPayloads {
  readonly [PERSIST_IDS.STATUS]: { readonly params: []; readonly result: PersistStatus };
}

/** Add the public persistence protocol to an existing strict runtime contract. */
export type PersistContracts<TContracts extends UkladContracts> = Omit<
  TContracts,
  'state' | 'events' | 'subscriptions'
> & {
  readonly state: ContractState<TContracts> & PersistContractState;
  readonly events: ContractEventPayloads<TContracts> & PersistEventPayloads;
  readonly subscriptions: ContractSubscriptionPayloads<TContracts> & PersistSubscriptionPayloads;
};
