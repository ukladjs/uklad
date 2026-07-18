import { consoleLog } from '../core/logging';
import { clearInterceptorsForRuntime } from './event-metadata';
import {
  clearHandlerEntriesForRuntime,
  hasHandlerForRuntime,
  isHandlerKind,
  isSubscriptionHandlerKind,
} from './handlers';
import { defaultRuntimeScope, type RuntimeScope } from './scope';
import { clearSubscriptionDefinitionsForRuntime } from './subscriptions/cache';
import { assertSubscriptionsCanBeClearedForRuntime } from './subscriptions/engine';

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
  clearHandlersForRuntime(defaultRuntimeScope, kind, id);
}

/** @internal Clear registrations owned by one runtime. */
export function clearHandlersForRuntime(runtime: RuntimeScope, kind?: HandlerKind, id?: Id): void {
  if (kind === undefined || isSubscriptionHandlerKind(kind)) {
    assertSubscriptionsCanBeClearedForRuntime(runtime);
  }

  if (kind === undefined) {
    clearHandlerEntriesForRuntime(runtime);
    clearInterceptorsForRuntime(runtime);
    clearSubscriptionDefinitionsForRuntime(runtime);
    return;
  }

  if (!isHandlerKind(kind)) {
    consoleLog('error', `[reflex] unknown handler kind: ${String(kind)}`);
    return;
  }

  if (id === undefined) {
    if (isSubscriptionHandlerKind(kind)) clearSubscriptionDefinitionsForRuntime(runtime);
    else {
      clearHandlerEntriesForRuntime(runtime, kind);
      if (kind === 'event') clearInterceptorsForRuntime(runtime);
    }
    return;
  }

  const handlerExisted = hasHandlerForRuntime(runtime, kind, id);
  if (isSubscriptionHandlerKind(kind)) clearSubscriptionDefinitionsForRuntime(runtime, id);
  else {
    clearHandlerEntriesForRuntime(runtime, kind, id);
    if (kind === 'event') clearInterceptorsForRuntime(runtime, id);
  }

  if (!handlerExisted) {
    consoleLog('warn', `[reflex] cannot clear ${kind} handler for ${id}: handler not found.`);
  }
}
