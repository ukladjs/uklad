import isEqual from 'fast-deep-equal';

import type { EqualityCheckFn } from '../../types';

let defaultEqualityCheck: EqualityCheckFn = isEqual;

/** Return the framework fallback equality function for new and uncustomized runtimes. */
export function getDefaultEqualityCheck(): EqualityCheckFn {
  return defaultEqualityCheck;
}

/** Replace the framework fallback without overwriting runtime policy. */
export function replaceDefaultEqualityCheck(
  previous: EqualityCheckFn,
  next: EqualityCheckFn,
): void {
  if (defaultEqualityCheck === previous) defaultEqualityCheck = next;
}
