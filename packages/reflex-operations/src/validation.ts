import type { EventVector } from '@flexsurfer/reflex';

import { DEFAULT_TIMEOUT_MS, IDENTIFIER_PATTERN, MAX_TIMEOUT_MS } from './limits.js';
import type {
  OperationEffectMode,
  OperationExecutionContext,
  OperationExecutionContextInput,
  OperationOptions,
} from './types.js';
import { clone } from './values.js';

export function assertEvent(event: EventVector): void {
  if (!Array.isArray(event) || event.length === 0 || typeof event[0] !== 'string') {
    throw new Error('[reflex-operations] event must be a non-empty event vector.');
  }
}

export function assertOptions(options: OperationOptions): void {
  const allowed = new Set(['completion', 'timeoutMs', 'idempotencyKey', 'expectedRevision', 'observe', 'executionContext']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(`[reflex-operations] Unknown operation option '${key}'.`);
  }
  if (options.completion !== undefined && options.completion !== 'cascade-published') {
    throw new Error("[reflex-operations] completion must be 'cascade-published'.");
  }
  normalizeTimeout(options.timeoutMs);
  if (options.idempotencyKey !== undefined) validateIdentifier(options.idempotencyKey, 'idempotencyKey');
  if (options.expectedRevision !== undefined && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)) {
    throw new Error('[reflex-operations] expectedRevision must be a non-negative safe integer.');
  }
  if (options.observe && options.observe.length > 64) {
    throw new Error('[reflex-operations] observe accepts at most 64 subscription queries.');
  }
}

export function validateInput(event: EventVector, options: OperationOptions): void {
  try {
    clone({ event, observations: options.observe ?? [], executionContext: options.executionContext ?? null });
  } catch (error: unknown) {
    throw new Error(
      '[reflex-operations] Tracked operation input must be structured-cloneable so its evidence is immutable.',
      { cause: error },
    );
  }
  if (options.idempotencyKey !== undefined) assertJsonInput(fingerprintInput(event, options));
}

export function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > MAX_TIMEOUT_MS) {
    throw new Error(`[reflex-operations] timeoutMs must be between 0 and ${MAX_TIMEOUT_MS}.`);
  }
  return timeout;
}

export function normalizeExecutionContext(
  value: OperationExecutionContextInput | undefined,
): OperationExecutionContext {
  return {
    profile: value?.profile ?? 'runtime',
    source: value ? 'caller-declared' : 'runtime-default',
    enforced: false,
    defaultEffectMode: value?.defaultEffectMode ?? 'runtime-defined',
    ...(value?.effectModes ? { effectModes: { ...value.effectModes } } : {}),
    ...(value?.fixtureSetId ? { fixtureSetId: value.fixtureSetId } : {}),
    ...(value?.metadata ? { metadata: clone(value.metadata) } : {}),
  };
}

export function getEffectMode(context: OperationExecutionContext, type: string): OperationEffectMode {
  return context.effectModes?.[type] ?? context.defaultEffectMode ?? 'runtime-defined';
}

export function fingerprintOperation(event: EventVector, options: OperationOptions): string {
  return JSON.stringify(fingerprintInput(event, options));
}

function fingerprintInput(event: EventVector, options: OperationOptions): unknown {
  return {
    event,
    completion: options.completion ?? 'cascade-published',
    expectedRevision: options.expectedRevision ?? null,
    observations: options.observe ?? [],
    executionContext: options.executionContext ?? null,
  };
}

function assertJsonInput(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return;
    if (typeof item !== 'object') throw new Error('[reflex-operations] Idempotent operation input must be JSON-compatible.');
    if (seen.has(item)) throw new Error('[reflex-operations] Idempotent operation input must not contain cycles.');
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('[reflex-operations] Idempotent operation input must use JSON arrays and plain objects.');
      }
      for (const child of Object.values(item)) visit(child);
    }
    seen.delete(item);
  };
  visit(value);
}

function validateIdentifier(value: string, field: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`[reflex-operations] ${field} must be 1-256 characters and contain only letters, numbers, dot, underscore, colon, or hyphen.`);
  }
}
