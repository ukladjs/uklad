import type { DefaultReflexContracts, ReflexRuntime } from '@flexsurfer/reflex/vanilla';

import type { StagedEntry } from './codec';
import { PERSIST_IDS } from './ids';
import type { PersistDiagnostic, PersistKeyConfig, PersistStatus } from './types';

type Runtime = ReflexRuntime<DefaultReflexContracts>;

export type RawByKey = Record<string, string | null>;
export type TerminalStatus = Extract<PersistStatus, 'hydrated' | 'failed'>;

export interface HydrationSnapshot {
  readonly rawByKey: RawByKey;
  readonly diagnostics: readonly PersistDiagnostic[];
}

export interface CompletionPayload {
  readonly status: TerminalStatus;
}

export interface PurgeCompletionPayload extends CompletionPayload {
  readonly diagnostics: readonly PersistDiagnostic[];
}

/** Reject an attachment when it would overwrite an existing Reflex registration. */
export function assertProtocolAvailable(runtime: Runtime, includeSnapshot: boolean): void {
  const handlers = runtime.getHandlers();
  const collisions: string[] = [];
  const eventIds = [
    PERSIST_IDS.ATTACH,
    PERSIST_IDS.HYDRATE,
    PERSIST_IDS.LOADED,
    PERSIST_IDS.FAILED,
    PERSIST_IDS.PURGE,
    PERSIST_IDS.PURGED,
  ];
  const effectIds = [
    PERSIST_IDS.READ,
    PERSIST_IDS.WRITE,
    PERSIST_IDS.REMOVE,
    PERSIST_IDS.COMPLETE,
    PERSIST_IDS.COMPLETE_PURGE,
    PERSIST_IDS.SETTLE,
    PERSIST_IDS.REJECT_PURGE,
    PERSIST_IDS.REPORT,
  ];

  for (const id of eventIds) if (handlers.event[id] !== undefined) collisions.push(`event:${id}`);
  for (const id of effectIds) if (handlers.fx[id] !== undefined) collisions.push(`effect:${id}`);
  if (includeSnapshot && handlers.cofx[PERSIST_IDS.SNAPSHOT] !== undefined) {
    collisions.push(`coeffect:${PERSIST_IDS.SNAPSHOT}`);
  }
  if (handlers.sub[PERSIST_IDS.STATUS] !== undefined) {
    collisions.push(`subscription:${PERSIST_IDS.STATUS}`);
  }
  if (runtime.getInterceptors().some(({ id }) => id === PERSIST_IDS.WRITER)) {
    collisions.push(`interceptor:${PERSIST_IDS.WRITER}`);
  }
  if (collisions.length > 0) {
    throw new Error(`[reflex-persist] Protocol registration collision: ${collisions.join(', ')}.`);
  }
}

export function isPersistDiagnostic(
  value: StagedEntry | PersistDiagnostic,
): value is PersistDiagnostic {
  return 'code' in value;
}

export function isPersistDiagnosticValue(value: unknown): value is PersistDiagnostic {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.some((key) => key !== 'code' && key !== 'phase' && key !== 'key')) return false;
  if (
    candidate.code !== 'storage-read-failed' &&
    candidate.code !== 'invalid-storage-value' &&
    candidate.code !== 'sync-contract-violation' &&
    candidate.code !== 'invalid-json' &&
    candidate.code !== 'invalid-envelope' &&
    candidate.code !== 'invalid-version' &&
    candidate.code !== 'future-version' &&
    candidate.code !== 'migration-required' &&
    candidate.code !== 'migration-failed' &&
    candidate.code !== 'deserialize-failed' &&
    candidate.code !== 'serialize-failed' &&
    candidate.code !== 'storage-write-failed' &&
    candidate.code !== 'storage-remove-failed' &&
    candidate.code !== 'invalid-completion' &&
    candidate.code !== 'event-queue-failed' &&
    candidate.code !== 'purge-during-hydration'
  ) {
    return false;
  }
  if (
    candidate.phase !== 'read' &&
    candidate.phase !== 'parse' &&
    candidate.phase !== 'validate' &&
    candidate.phase !== 'migrate' &&
    candidate.phase !== 'deserialize' &&
    candidate.phase !== 'serialize' &&
    candidate.phase !== 'write' &&
    candidate.phase !== 'purge' &&
    candidate.phase !== 'lifecycle'
  ) {
    return false;
  }
  return candidate.key === undefined || typeof candidate.key === 'string';
}

export function isPersistDiagnosticArray(value: unknown): value is readonly PersistDiagnostic[] {
  return Array.isArray(value) && value.every(isPersistDiagnosticValue);
}

export function isHydrationSnapshot(
  value: unknown,
  keyConfigs: readonly PersistKeyConfig<string, any>[],
): value is HydrationSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const rawByKey = Reflect.get(value, 'rawByKey') as unknown;
    const diagnostics = Reflect.get(value, 'diagnostics') as unknown;
    if (typeof rawByKey !== 'object' || rawByKey === null || Array.isArray(rawByKey)) return false;
    if (!isPersistDiagnosticArray(diagnostics)) return false;
    for (const { key } of keyConfigs) {
      if (!Object.prototype.hasOwnProperty.call(rawByKey, key)) return false;
      const raw = Reflect.get(rawByKey, key) as unknown;
      if (raw !== null && typeof raw !== 'string') return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isWritePayload(value: unknown): value is { readonly key: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof Reflect.get(value, 'key') === 'string'
  );
}

export function isCompletionPayload(value: unknown): value is CompletionPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const status = Reflect.get(value, 'status') as unknown;
  return status === 'hydrated' || status === 'failed';
}

export function isPurgeCompletionPayload(value: unknown): value is PurgeCompletionPayload {
  return (
    isCompletionPayload(value) &&
    isPersistDiagnosticArray(Reflect.get(value, 'diagnostics') as unknown)
  );
}

export function isPersistProtocolEvent(value: string): boolean {
  return (
    value === PERSIST_IDS.ATTACH ||
    value === PERSIST_IDS.HYDRATE ||
    value === PERSIST_IDS.LOADED ||
    value === PERSIST_IDS.FAILED ||
    value === PERSIST_IDS.PURGE ||
    value === PERSIST_IDS.PURGED
  );
}
