import { consoleLog } from '../core/logging';

import type {
  CoEffectHandler,
  EffectHandler,
  ErrorHandler,
  EventHandler,
  Id,
  SubDepsHandler,
  SubHandler,
} from '../types';

export type HandlerByKind = {
  event: EventHandler<any, any>;
  fx: EffectHandler;
  cofx: CoEffectHandler<any>;
  sub: SubHandler;
  subDeps: SubDepsHandler;
  error: ErrorHandler;
};

export type HandlerKind = keyof HandlerByKind;
export type RegistryHandler = HandlerByKind[HandlerKind];
export type HandlerRegistry = {
  [K in HandlerKind]: Partial<Record<string, HandlerByKind[K]>>;
};

export const SUB_HANDLER_KIND = 'sub' as const;
export const SUB_DEPS_HANDLER_KIND = 'subDeps' as const;
export const SUBSCRIPTION_HANDLER_KINDS: readonly [
  typeof SUB_HANDLER_KIND,
  typeof SUB_DEPS_HANDLER_KIND,
] = Object.freeze([SUB_HANDLER_KIND, SUB_DEPS_HANDLER_KIND] as const);
export type SubscriptionHandlerKind = (typeof SUBSCRIPTION_HANDLER_KINDS)[number];

const HANDLER_KINDS: readonly HandlerKind[] = [
  'event',
  'fx',
  'cofx',
  ...SUBSCRIPTION_HANDLER_KINDS,
  'error',
];

function createHandlerRecord<T extends RegistryHandler>(): Partial<Record<string, T>> {
  return Object.create(null) as Partial<Record<string, T>>;
}

function createHandlerRegistry(): HandlerRegistry {
  return {
    event: createHandlerRecord(),
    fx: createHandlerRecord(),
    cofx: createHandlerRecord(),
    sub: createHandlerRecord(),
    subDeps: createHandlerRecord(),
    error: createHandlerRecord(),
  };
}

function writeHandler(kind: HandlerKind, id: Id, handler: RegistryHandler): void {
  (handlers[kind] as Partial<Record<string, RegistryHandler>>)[id] = handler;
}

function resetHandlerRecord(kind: HandlerKind): void {
  const next = createHandlerRecord<RegistryHandler>();
  Object.assign(next, systemHandlers[kind]);
  (handlers as Record<HandlerKind, Partial<Record<string, RegistryHandler>>>)[kind] = next;
}

const handlers = createHandlerRegistry();
const systemHandlers = createHandlerRegistry();

export function isHandlerKind(value: string): value is HandlerKind {
  return HANDLER_KINDS.includes(value as HandlerKind);
}

export function isSubscriptionHandlerKind(value: string): value is SubscriptionHandlerKind {
  return SUBSCRIPTION_HANDLER_KINDS.includes(value as SubscriptionHandlerKind);
}

/** Return the handler registered for `kind` and `id`, if one exists. */
export function getHandler<K extends HandlerKind>(kind: K, id: Id): HandlerByKind[K] | undefined {
  return handlers[kind][id];
}

/**
 * Return the live handler registry used by diagnostics integrations.
 * Consumers must treat the returned records as read-only.
 */
export function getHandlers(): HandlerRegistry {
  return handlers;
}

export function registerHandler<
  K extends HandlerKind,
  T extends HandlerByKind[K] = HandlerByKind[K],
>(kind: K, id: Id, handler: T): T {
  if (handlers[kind][id]) {
    consoleLog('warn', `[reflex] overwriting ${kind} handler for:`, id);
  }
  writeHandler(kind, id, handler);
  return handler;
}

/** Register a framework handler that public reset operations must restore. */
export function registerSystemHandler<
  K extends HandlerKind,
  T extends HandlerByKind[K] = HandlerByKind[K],
>(kind: K, id: Id, handler: T): T {
  (systemHandlers[kind] as Partial<Record<string, RegistryHandler>>)[id] = handler;
  writeHandler(kind, id, handler);
  return handler;
}

export function hasHandler(kind: HandlerKind, id: Id): boolean {
  return handlers[kind][id] !== undefined;
}

/** @internal Reset stored handlers without clearing related feature metadata. */
export function clearHandlerEntries(kind?: HandlerKind, id?: Id): void {
  if (kind === undefined) {
    for (const handlerKind of HANDLER_KINDS) resetHandlerRecord(handlerKind);
    return;
  }
  if (id === undefined) {
    resetHandlerRecord(kind);
    return;
  }

  const systemHandler = systemHandlers[kind][id];
  if (systemHandler === undefined) {
    delete handlers[kind][id];
  } else {
    writeHandler(kind, id, systemHandler);
  }
}
