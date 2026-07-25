import isEqual from 'fast-deep-equal';

import type { EqualityCheckFn } from '../types';
import { type RuntimeCore } from '../runtime/core';

let defaultEqualityCheck: EqualityCheckFn = isEqual;

/**
 * Compare primitives by identity and arrays or objects one level deep.
 *
 * This is useful for derived collections whose unchanged members retain
 * identity through Immer structural sharing. Pass it to `regSub`, or install
 * it globally with `setGlobalEqualityCheck`.
 */
export const shallowEqual: EqualityCheckFn = (left: any, right: any): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      if (!Object.is(left[index], right[index])) return false;
    }
    return true;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
};

/** @internal Replace the default equality function for one runtime. */
export function setGlobalEqualityCheck(runtime: RuntimeCore, equalityCheck: EqualityCheckFn): void {
  runtime.subscriptions.equalityCheck = equalityCheck;
}

/** @internal Return the default equality function for one runtime. */
export function getGlobalEqualityCheck(runtime: RuntimeCore): EqualityCheckFn {
  return getRuntimeEqualityCheck(runtime);
}

/** @internal Replace the framework fallback without overwriting runtime policy. */
export function replaceDefaultEqualityCheck(
  previous: EqualityCheckFn,
  next: EqualityCheckFn,
): void {
  if (defaultEqualityCheck === previous) defaultEqualityCheck = next;
}

function getRuntimeEqualityCheck(runtime: RuntimeCore): EqualityCheckFn {
  return runtime.subscriptions.equalityCheck ?? defaultEqualityCheck;
}
