import type { EventVector } from './types';

/**
 * Validate an event at a runtime boundary.
 *
 * TypeScript callers normally cannot construct an invalid event vector, but
 * effects, JavaScript consumers, persisted data, and devtools all cross
 * untyped boundaries. Keeping the guard in one dependency-free module avoids
 * subtly different checks in the router and effect runtime.
 */
export function isEventVector(value: unknown): value is EventVector {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string';
}
