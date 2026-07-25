import { consoleLog } from '../core/logging';
import { isHandlerKind } from './registry';
import type { HandlerKind } from './handler-types';

import type { RuntimeCore } from './core';
import type { Id } from '../types';

/** @internal Cross-service reset coordination for one runtime core. */
export function clearHandlers(runtime: RuntimeCore, kind?: HandlerKind, id?: Id): void {
  if (kind === undefined || kind === 'sub' || kind === 'subDeps') {
    runtime.subscriptions.assertClearAllowed();
  }

  if (kind === undefined) {
    runtime.registry.clear();
    runtime.events.clearEventDefinitions();
    runtime.subscriptions.clearDefinitions();
    return;
  }

  if (!isHandlerKind(kind)) {
    consoleLog('error', `[reflex] unknown handler kind: ${String(kind)}`);
    return;
  }

  if (kind === 'sub' || kind === 'subDeps') {
    runtime.subscriptions.clearDefinitions(id);
    return;
  }

  const record = runtime.registry[kind];
  const handlerExisted = id === undefined || record.has(id);
  record.clear(id);
  if (kind === 'event') runtime.events.clearEventDefinitions(id);
  if (!handlerExisted) {
    consoleLog('warn', `[reflex] cannot clear ${kind} handler for ${id}: handler not found.`);
  }
}
