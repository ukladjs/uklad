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

/**
 * Experimental async storage shape; it is not supported by the initial release.
 *
 * @experimental Async writes are not ordered or durable yet. Passing this
 * shape also requires `experimentalAsync: true`.
 */
export interface AsyncPersistStorage {
  readonly sync?: false;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
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
 * Persistence configuration. The initial-release product contract is the synchronous
 * branch; the async branch requires an explicit experimental opt-in.
 */
export type PersistOptions<TState extends AnyState = AnyState> = PersistBaseOptions<TState> &
  (
    | {
        readonly storage: SyncPersistStorage;
        readonly experimentalAsync?: never;
      }
    | {
        readonly storage: AsyncPersistStorage;
        /** @experimental Async writes are not ordered or durable yet. */
        readonly experimentalAsync: true;
      }
  );

export interface PersistHandle {
  /** Start the one hydration attempt. Repeated calls are idempotent. */
  hydrate(): void;
  /** Wait for hydration; waits for a future attempt when the attachment is idle. */
  whenHydrated(): Promise<void>;
  /** Remove configured entries and reopen writes from the current state on success. */
  purge(): Promise<void>;
  /** Detach the module. Pending barriers reject deterministically. */
  dispose(): void;
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
