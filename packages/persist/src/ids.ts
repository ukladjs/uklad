/** IDs owned by one persistence attachment. HYDRATE and PURGE are the public control events. */
export const PERSIST_IDS = {
  /** Status root key and subscription id. */
  STATUS: 'reflex-persist',
  /** Internal event publishing the attachment's initial idle status. */
  ATTACH: 'reflex-persist/attach',
  /** Public event that starts the attachment's one hydration attempt. */
  HYDRATE: 'reflex-persist/hydrate',
  /** Internal async read-completion event. */
  LOADED: 'reflex-persist/loaded',
  /** Internal async read-failure event. */
  FAILED: 'reflex-persist/failed',
  /** Public event that removes every configured storage entry. */
  PURGE: 'reflex-persist/purge',
  /** Internal purge-completion event. */
  PURGED: 'reflex-persist/purged',
  /** Global interceptor contributing writes for changed configured roots. */
  WRITER: 'reflex-persist/writer',
  /** Effect serializing one configured root from the committed state. */
  WRITE: 'reflex-persist/write',
  /** Internal async read effect. */
  READ: 'reflex-persist/read',
  /** Internal purge effect. */
  REMOVE: 'reflex-persist/remove',
  /** Sync-storage coeffect injecting a read snapshot. */
  SNAPSHOT: 'reflex-persist/snapshot',
  /** Internal effect completing a hydration transition post-commit. */
  COMPLETE: 'reflex-persist/complete',
  /** Internal effect completing a purge transition post-commit. */
  COMPLETE_PURGE: 'reflex-persist/complete-purge',
  /** Internal effect settling already-terminal hydration waiters. */
  SETTLE: 'reflex-persist/settle',
  /** Internal effect rejecting a purge request that could not start. */
  REJECT_PURGE: 'reflex-persist/reject-purge',
  /** Internal effect publishing a sanitized diagnostic. */
  REPORT: 'reflex-persist/report',
} as const;
