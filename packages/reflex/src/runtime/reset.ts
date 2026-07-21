import { consoleLog } from '../core/logging';
import { clearInterceptorsForKernel } from './event-metadata';
import {
  clearHandlerEntriesForKernel,
  hasHandlerForKernel,
  isHandlerKind,
  isSubscriptionHandlerKind,
} from './handlers';
import type { RuntimeKernel } from './kernel';
import { clearSubscriptionDefinitionsForKernel } from './subscriptions/cache';
import { assertSubscriptionsCanBeClearedForKernel } from './subscriptions/engine';

import type { Id } from '../types';
import type { HandlerKind } from './handlers';

/** @internal Clear registrations owned by one runtime. */
export function clearHandlersForKernel(runtime: RuntimeKernel, kind?: HandlerKind, id?: Id): void {
  if (kind === undefined || isSubscriptionHandlerKind(kind)) {
    assertSubscriptionsCanBeClearedForKernel(runtime);
  }

  if (kind === undefined) {
    clearHandlerEntriesForKernel(runtime);
    clearInterceptorsForKernel(runtime);
    clearSubscriptionDefinitionsForKernel(runtime);
    return;
  }

  if (!isHandlerKind(kind)) {
    consoleLog('error', `[reflex] unknown handler kind: ${String(kind)}`);
    return;
  }

  if (id === undefined) {
    if (isSubscriptionHandlerKind(kind)) clearSubscriptionDefinitionsForKernel(runtime);
    else {
      clearHandlerEntriesForKernel(runtime, kind);
      if (kind === 'event') clearInterceptorsForKernel(runtime);
    }
    return;
  }

  const handlerExisted = hasHandlerForKernel(runtime, kind, id);
  if (isSubscriptionHandlerKind(kind)) clearSubscriptionDefinitionsForKernel(runtime, id);
  else {
    clearHandlerEntriesForKernel(runtime, kind, id);
    if (kind === 'event') clearInterceptorsForKernel(runtime, id);
  }

  if (!handlerExisted) {
    consoleLog('warn', `[reflex] cannot clear ${kind} handler for ${id}: handler not found.`);
  }
}
