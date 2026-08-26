/** IDs owned by one persistence attachment. HYDRATE and PURGE are the public control events. */
export const PERSIST_IDS = {
  /** Status root key and subscription id. */
  STATUS: 'uklad-persist',
  /** Internal event publishing the attachment's initial idle status. */
  ATTACH: 'uklad-persist/attach',
  /** Public event that starts (or retries after failure) a hydration attempt. */
  HYDRATE: 'uklad-persist/hydrate',
  /** Internal async read-completion event. */
  LOADED: 'uklad-persist/loaded',
  /** Internal async read-failure event. */
  FAILED: 'uklad-persist/failed',
  /** Public event that removes every configured storage entry. */
  PURGE: 'uklad-persist/purge',
  /** Internal purge-completion event. */
  PURGED: 'uklad-persist/purged',
  /** Global interceptor contributing writes for changed configured roots. */
  WRITER: 'uklad-persist/writer',
  /** Effect serializing one configured root from the committed state. */
  WRITE: 'uklad-persist/write',
  /** Internal async read effect. */
  READ: 'uklad-persist/read',
  /** Internal purge effect. */
  REMOVE: 'uklad-persist/remove',
  /** Sync-storage coeffect injecting a read snapshot. */
  SNAPSHOT: 'uklad-persist/snapshot',
  /** Internal effect completing a hydration transition post-commit. */
  COMPLETE: 'uklad-persist/complete',
  /** Internal effect completing a purge transition post-commit. */
  COMPLETE_PURGE: 'uklad-persist/complete-purge',
  /** Internal effect settling already-terminal hydration waiters. */
  SETTLE: 'uklad-persist/settle',
  /** Internal effect rejecting a purge request that could not start. */
  REJECT_PURGE: 'uklad-persist/reject-purge',
  /** Internal effect publishing a sanitized diagnostic. */
  REPORT: 'uklad-persist/report',
} as const;
