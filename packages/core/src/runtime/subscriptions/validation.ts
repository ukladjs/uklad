import { consoleLog } from '../../core/logging';

import type { Id, SubConfig } from '../../types';

/** Normalize optional subscription policy at the public registration boundary. */
export function normalizeSubscriptionConfig(
  id: Id,
  config: SubConfig | undefined,
): SubConfig | undefined {
  if (config == null) return undefined;
  if (typeof config !== 'object') {
    consoleLog('warn', `[uklad] Subscription '${id}' config must be an object. Using defaults.`);
    return undefined;
  }
  if (config.equalityCheck === undefined || typeof config.equalityCheck === 'function') {
    return config;
  }
  consoleLog(
    'warn',
    `[uklad] Subscription '${id}' equalityCheck must be a function. Using the global equality check.`,
  );
  return undefined;
}
