import { PERSIST_IDS } from './ids';
import type {
  AnyState,
  PersistData,
  PersistDiagnostic,
  PersistKeyConfig,
  PersistOptions,
  PersistStorage,
} from './types';

/** Internal, validated attachment configuration. */
export interface NormalizedOptions {
  readonly storage: PersistStorage;
  readonly keyConfigs: readonly PersistKeyConfig<string, any>[];
  readonly version: number;
  readonly prefix: string;
  readonly migrate?: (key: string, data: unknown, fromVersion: number) => PersistData;
  readonly onError?: (diagnostic: PersistDiagnostic) => void;
}

/** Validate and freeze one persistence attachment's static configuration. */
export function normalizeOptions(options: PersistOptions<AnyState>): NormalizedOptions {
  if (typeof options !== 'object' || options === null) {
    throw new Error('[uklad-persist] options must be an object.');
  }
  if (typeof options.storage !== 'object' || options.storage === null) {
    throw new Error('[uklad-persist] storage must be an object.');
  }
  if (
    typeof options.storage.getItem !== 'function' ||
    typeof options.storage.setItem !== 'function' ||
    typeof options.storage.removeItem !== 'function'
  ) {
    throw new Error(
      '[uklad-persist] storage must implement getItem(), setItem(), and removeItem().',
    );
  }
  if (
    options.storage.sync !== undefined &&
    options.storage.sync !== true &&
    options.storage.sync !== false
  ) {
    throw new Error('[uklad-persist] storage.sync must be true, false, or undefined.');
  }
  // Async storage is now supported. Keep the former opt-in accepted by the
  // source-compatible option union, but do not require it for native callers.
  if (options.storage.sync === true && options.experimentalAsync !== undefined) {
    throw new Error('[uklad-persist] experimentalAsync is only valid for async storage.');
  }
  if (!Array.isArray(options.keys) || options.keys.length === 0) {
    throw new Error('[uklad-persist] keys must be a non-empty array.');
  }

  const seen = new Set<string>();
  const keyConfigs = options.keys.map((candidate): PersistKeyConfig<string, any> => {
    const config =
      typeof candidate === 'string'
        ? { key: candidate }
        : (candidate as PersistKeyConfig<string, any>);
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new Error('[uklad-persist] every key must be a string or key configuration.');
    }
    if (typeof config.key !== 'string' || config.key.length === 0) {
      throw new Error('[uklad-persist] configured keys must be non-empty strings.');
    }
    if (config.key === PERSIST_IDS.STATUS) {
      throw new Error(`[uklad-persist] '${PERSIST_IDS.STATUS}' is a reserved state root.`);
    }
    if (seen.has(config.key)) {
      throw new Error(`[uklad-persist] Duplicate configured key '${config.key}'.`);
    }
    if (config.serialize !== undefined && typeof config.serialize !== 'function') {
      throw new Error(`[uklad-persist] serialize for '${config.key}' must be a function.`);
    }
    if (config.deserialize !== undefined && typeof config.deserialize !== 'function') {
      throw new Error(`[uklad-persist] deserialize for '${config.key}' must be a function.`);
    }
    seen.add(config.key);
    return Object.freeze({
      key: config.key,
      ...(config.serialize === undefined ? {} : { serialize: config.serialize }),
      ...(config.deserialize === undefined ? {} : { deserialize: config.deserialize }),
    });
  });

  const version = options.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('[uklad-persist] version must be a positive safe integer.');
  }
  const prefix = options.prefix ?? 'uklad';
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new Error('[uklad-persist] prefix must be a non-empty string.');
  }
  if (options.migrate !== undefined && typeof options.migrate !== 'function') {
    throw new Error('[uklad-persist] migrate must be a function.');
  }
  if (options.onError !== undefined && typeof options.onError !== 'function') {
    throw new Error('[uklad-persist] onError must be a function.');
  }

  return {
    storage: options.storage,
    keyConfigs: Object.freeze(keyConfigs),
    version,
    prefix,
    ...(options.migrate === undefined ? {} : { migrate: options.migrate }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  };
}
