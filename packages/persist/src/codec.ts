import type {
  PersistData,
  PersistDiagnostic,
  PersistErrorCode,
  PersistErrorPhase,
  PersistKeyConfig,
} from './types';

interface Envelope {
  readonly v: number;
  readonly data: unknown;
}

/** A decoded configured root ready to be applied to state. */
export interface StagedEntry {
  readonly key: string;
  readonly value: unknown;
  readonly migrated: boolean;
}

/** Dependencies of the pure per-entry decode operation. */
export interface StageEntryOptions {
  readonly version: number;
  readonly migrate?: (key: string, data: unknown, fromVersion: number) => PersistData;
  readonly diagnostic: (
    code: PersistErrorCode,
    phase: PersistErrorPhase,
    key?: string,
  ) => PersistDiagnostic;
}

/** Decode, validate, migrate, and deserialize one stored envelope. */
export function stageEntry(
  config: PersistKeyConfig<string, any>,
  raw: string,
  { version, migrate, diagnostic }: StageEntryOptions,
): StagedEntry | PersistDiagnostic {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return diagnostic('invalid-json', 'parse', config.key);
  }

  if (!isEnvelopeRecord(parsed)) {
    return diagnostic('invalid-envelope', 'validate', config.key);
  }
  if (!Number.isSafeInteger(parsed.v) || parsed.v < 1) {
    return diagnostic('invalid-version', 'validate', config.key);
  }
  if (parsed.v > version) {
    return diagnostic('future-version', 'validate', config.key);
  }

  let data = parsed.data;
  const migrated = parsed.v < version;
  if (migrated) {
    if (!migrate) return diagnostic('migration-required', 'migrate', config.key);
    try {
      data = migrate(config.key, data, parsed.v);
      if (isThenable(data)) {
        ignoreThenable(data);
        return diagnostic('sync-contract-violation', 'migrate', config.key);
      }
      if (!isPersistDataValue(data)) {
        return diagnostic('migration-failed', 'migrate', config.key);
      }
    } catch {
      return diagnostic('migration-failed', 'migrate', config.key);
    }
  }

  try {
    const value = config.deserialize ? config.deserialize(data) : data;
    if (isThenable(value)) {
      ignoreThenable(value);
      return diagnostic('sync-contract-violation', 'deserialize', config.key);
    }
    if (value === undefined) {
      return diagnostic('deserialize-failed', 'deserialize', config.key);
    }
    return { key: config.key, value, migrated };
  } catch {
    return diagnostic('deserialize-failed', 'deserialize', config.key);
  }
}

/** Encode a validated JSON value into the versioned storage envelope. */
export function encodeEnvelope(version: number, data: unknown): string | undefined {
  try {
    // Validation inspects user-owned objects and may encounter throwing proxy
    // traps or accessors. Keep the codec total so every invalid value follows
    // the caller's sanitized serialize-failed path.
    if (!isPersistDataValue(data)) return undefined;
    const encoded = JSON.stringify({ v: version, data } satisfies Envelope);
    const parsed = JSON.parse(encoded) as unknown;
    return isEnvelopeRecord(parsed) && parsed.v === version && isPersistDataValue(parsed.data)
      ? encoded
      : undefined;
  } catch {
    return undefined;
  }
}

/** Runtime validation for the recursively JSON-only persistence contract. */
export function isPersistDataValue(
  value: unknown,
  ancestors: Set<object> = new Set<object>(),
): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;

  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (typeof Reflect.get(value, 'toJSON') === 'function') return false;
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) return false;
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
        if (!isPersistDataValue(value[index], ancestors)) return false;
      }
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return false;
      if (!isPersistDataValue(descriptor.value, ancestors)) return false;
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
  try {
    return typeof Reflect.get(value, 'then') === 'function';
  } catch {
    return true;
  }
}

export function ignoreThenable(value: PromiseLike<unknown>): void {
  void Promise.resolve(value).catch(() => {});
}

function isEnvelopeRecord(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    Object.prototype.hasOwnProperty.call(value, 'v') &&
    Object.prototype.hasOwnProperty.call(value, 'data')
  );
}
