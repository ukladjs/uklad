import isEqual from 'fast-deep-equal';
import isEqualEs6 from 'fast-deep-equal/es6/index.js';
import {
  current as immerCurrent,
  enableMapSet as immerEnableMapSet,
  enablePatches as immerEnablePatches,
  isDraft,
  original as immerOriginal,
  type Draft,
} from 'immer';

import { replaceDefaultEqualityCheck } from './equality';

let patchesPluginEnabled = false;

/** Return a draft's underlying base value, or pass a non-draft through unchanged. */
export function original<T>(value: T): T {
  return isDraft(value) ? (immerOriginal(value as Draft<T>)! as T) : value;
}

/** Return a non-draft snapshot of a draft's current state, or pass a non-draft through. */
export function current<T>(value: T): T {
  return isDraft(value) ? (immerCurrent(value as Draft<T>) as T) : value;
}

/**
 * Enable Immer support for `Map` and `Set` values.
 *
 * When Reflex still uses its default equality function, this also selects the
 * ES6-aware comparer. A user-installed equality function is left untouched.
 */
export function enableMapSet(): void {
  immerEnableMapSet();
  // The fallback is process-wide because Immer's Map/Set plugin is process-wide,
  // but runtime-local equality overrides must remain untouched. Do not consult
  // the compatibility runtime here: its override must not decide whether other
  // runtimes receive the ES6-aware framework fallback.
  replaceDefaultEqualityCheck(isEqual, isEqualEs6);
}

/** Idempotently enable Immer patch generation for event tracing. */
export function ensurePatchesEnabled(): void {
  if (patchesPluginEnabled) return;
  immerEnablePatches();
  patchesPluginEnabled = true;
}
