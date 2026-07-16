import type { EventVector } from '../types';

/**
 * Validate an event at an untyped runtime boundary.
 *
 * Effects, JavaScript consumers, persisted data, and devtools can bypass the
 * TypeScript event contract, so routers and effect handlers share this guard.
 */
export function isEventVector(value: unknown): value is EventVector {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string';
}
