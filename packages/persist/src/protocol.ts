import type { StagedEntry } from './codec';
import { PERSIST_IDS } from './ids';
import type { PersistDiagnostic, PersistKeyConfig, PersistStatus } from './types';

export type RawByKey = Record<string, string | null>;
export type TerminalStatus = Extract<PersistStatus, 'hydrated' | 'failed'>;

export interface HydrationSnapshot {
  readonly rawByKey: RawByKey;
  readonly diagnostics: readonly PersistDiagnostic[];
}

export interface CompletionPayload {
  readonly status: TerminalStatus;
  readonly generation: number;
}

export interface PurgeCompletionPayload {
  readonly status: TerminalStatus;
  readonly diagnostics: readonly PersistDiagnostic[];
}

export function isHydrationGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
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
  return (
    (status === 'hydrated' || status === 'failed') &&
    isHydrationGeneration(Reflect.get(value, 'generation'))
  );
}

export function isPurgeCompletionPayload(value: unknown): value is PurgeCompletionPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Reflect.get(value, 'status') === 'hydrated' || Reflect.get(value, 'status') === 'failed') &&
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
