/**
 * Safe versions of immer's original and current functions
 * These check if the value is actually a draft before calling the immer functions
 */

import {
  isDraft,
  original as immerOriginal,
  current as immerCurrent,
  enableMapSet as immerEnableMapSet,
  enablePatches as immerEnablePatches,
} from 'immer';
import type { Draft } from 'immer';
import { setGlobalEqualityCheck, getGlobalEqualityCheck } from './settings';
import isEqual from 'fast-deep-equal';
import isEqualEs6 from 'fast-deep-equal/es6/index.js';

/**
 * Safe version of immer's original function
 * Returns the original (frozen) version of a draft if the value is a draft,
 * otherwise returns the value as-is
 */
export function original<T>(value: T): T {
  return isDraft(value) ? (immerOriginal(value as Draft<T>)! as T) : value;
}

/**
 * Safe version of immer's current function
 * Returns the current draft state as a plain object if the value is a draft,
 * otherwise returns the value as-is
 */
export function current<T>(value: T): T {
  return isDraft(value) ? (immerCurrent(value as Draft<T>) as T) : value;
}

/**
 * Enable Map and Set support in Immer
 * This allows Immer to handle Map and Set objects properly in drafts
 * Also updates the global equality check to use fast-deep-equal/es6 for proper Map/Set comparison,
 * but only if the current equality check is still the default isEqual
 */
export function enableMapSet(): void {
  immerEnableMapSet();
  // Only update the global equality check if it's still the default isEqual
  // to avoid overriding user-set custom equality checks
  if (getGlobalEqualityCheck() === isEqual) {
    setGlobalEqualityCheck(isEqualEs6);
  }
}

let patchesPluginEnabled = false;

export function ensurePatchesEnabled(): void {
  if (patchesPluginEnabled) return;
  immerEnablePatches();
  patchesPluginEnabled = true;
}
