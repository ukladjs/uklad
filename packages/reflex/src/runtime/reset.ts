import { consoleLog } from '../core/logging';
import { clearInterceptors } from './event-metadata';
import {
  clearHandlerEntries,
  hasHandler,
  isHandlerKind,
  isSubscriptionHandlerKind,
} from './handlers';
import { clearSubscriptionDefinitions } from './subscriptions/cache';
import { assertSubscriptionsCanBeCleared } from './subscriptions/engine';

import type { Id } from '../types';
import type { HandlerKind } from './handlers';

/**
 * Clear handler registrations and their associated event/subscription metadata.
 * Framework-owned system handlers are restored rather than removed.
 */
export function clearHandlers(): void;
export function clearHandlers(kind: HandlerKind): void;
export function clearHandlers(kind: HandlerKind, id: Id): void;
export function clearHandlers(kind?: HandlerKind, id?: Id): void {
  if (kind === undefined || isSubscriptionHandlerKind(kind)) {
    assertSubscriptionsCanBeCleared();
  }

  if (kind === undefined) {
    clearHandlerEntries();
    clearInterceptors();
    clearSubscriptionDefinitions();
    return;
  }

  if (!isHandlerKind(kind)) {
    consoleLog('error', `[reflex] unknown handler kind: ${String(kind)}`);
    return;
  }

  if (id === undefined) {
    if (isSubscriptionHandlerKind(kind)) clearSubscriptionDefinitions();
    else {
      clearHandlerEntries(kind);
      if (kind === 'event') clearInterceptors();
    }
    return;
  }

  const handlerExisted = hasHandler(kind, id);
  if (isSubscriptionHandlerKind(kind)) clearSubscriptionDefinitions(id);
  else {
    clearHandlerEntries(kind, id);
    if (kind === 'event') clearInterceptors(id);
  }

  if (!handlerExisted) {
    consoleLog('warn', `[reflex] cannot clear ${kind} handler for ${id}: handler not found.`);
  }
}
