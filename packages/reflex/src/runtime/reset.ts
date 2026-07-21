import { consoleLog } from '../core/logging';
import { clearInterceptorsForRuntime } from './event-metadata';
import {
  clearHandlerEntriesForRuntime,
  hasHandlerForRuntime,
  isHandlerKind,
  isSubscriptionHandlerKind,
} from './handlers';
import type { RuntimeScope } from './scope';
import { clearSubscriptionDefinitionsForRuntime } from './subscriptions/cache';
import { assertSubscriptionsCanBeClearedForRuntime } from './subscriptions/engine';

import type { Id } from '../types';
import type { HandlerKind } from './handlers';

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
