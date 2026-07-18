import { consoleLog } from '../core/logging';
import { defaultRuntimeScope, type RuntimeScope } from './scope';

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

function createHandlerRecord<T>(): Partial<Record<string, T>> {
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

interface HandlerState {
  handlers: HandlerRegistry;
  systemHandlers: HandlerRegistry;
  versions: Record<HandlerKind, Partial<Record<string, number>>>;
  nextVersion: number;
}

const handlerStates = new WeakMap<RuntimeScope, HandlerState>();

function getHandlerState(runtime: RuntimeScope): HandlerState {
  let state = handlerStates.get(runtime);
  if (!state) {
    state = {
      handlers: createHandlerRegistry(),
      systemHandlers: createHandlerRegistry(),
      versions: createVersionRegistry(),
      nextVersion: 0,
    };
    handlerStates.set(runtime, state);
  }
  return state;
}

function createVersionRegistry(): Record<HandlerKind, Partial<Record<string, number>>> {
  return {
    event: createHandlerRecord<number>(),
    fx: createHandlerRecord<number>(),
    cofx: createHandlerRecord<number>(),
    sub: createHandlerRecord<number>(),
    subDeps: createHandlerRecord<number>(),
    error: createHandlerRecord<number>(),
  };
}

function bumpVersion(state: HandlerState, kind: HandlerKind, id: Id): number {
  const version = ++state.nextVersion;
  state.versions[kind][id] = version;
  return version;
}

function writeHandler(
  state: HandlerState,
  kind: HandlerKind,
  id: Id,
  handler: RegistryHandler,
): void {
  (state.handlers[kind] as Partial<Record<string, RegistryHandler>>)[id] = handler;
}

function resetHandlerRecord(state: HandlerState, kind: HandlerKind): void {
  const previousIds = Object.keys(state.handlers[kind]);
  const next = createHandlerRecord<RegistryHandler>();
  Object.assign(next, state.systemHandlers[kind]);
  (state.handlers as Record<HandlerKind, Partial<Record<string, RegistryHandler>>>)[kind] = next;
  for (const id of new Set([...previousIds, ...Object.keys(next)])) {
    bumpVersion(state, kind, id);
  }
}

export function isHandlerKind(value: string): value is HandlerKind {
  return HANDLER_KINDS.includes(value as HandlerKind);
}

export function isSubscriptionHandlerKind(value: string): value is SubscriptionHandlerKind {
  return SUBSCRIPTION_HANDLER_KINDS.includes(value as SubscriptionHandlerKind);
}

/** Return the handler registered for `kind` and `id`, if one exists. */
export function getHandler<K extends HandlerKind>(kind: K, id: Id): HandlerByKind[K] | undefined {
  return getHandlerForRuntime(defaultRuntimeScope, kind, id);
}

/** @internal Runtime-scoped handler lookup. */
export function getHandlerForRuntime<K extends HandlerKind>(
  runtime: RuntimeScope,
  kind: K,
  id: Id,
): HandlerByKind[K] | undefined {
  return getHandlerState(runtime).handlers[kind][id];
}

/**
 * Return the live handler registry used by diagnostics integrations.
 * Consumers must treat the returned records as read-only.
 */
export function getHandlers(): HandlerRegistry {
  return getHandlersForRuntime(defaultRuntimeScope);
}

/** @internal Runtime-scoped live registry for diagnostics. */
export function getHandlersForRuntime(runtime: RuntimeScope): HandlerRegistry {
  return getHandlerState(runtime).handlers;
}

export function registerHandler<
  K extends HandlerKind,
  T extends HandlerByKind[K] = HandlerByKind[K],
>(kind: K, id: Id, handler: T): T {
  return registerHandlerForRuntime(defaultRuntimeScope, kind, id, handler);
}

/** @internal Register a handler in one runtime. */
export function registerHandlerForRuntime<
  K extends HandlerKind,
  T extends HandlerByKind[K] = HandlerByKind[K],
>(runtime: RuntimeScope, kind: K, id: Id, handler: T): T {
  const state = getHandlerState(runtime);
  if (state.handlers[kind][id]) {
    consoleLog('warn', `[reflex] overwriting ${kind} handler for:`, id);
  }
  writeHandler(state, kind, id, handler);
  bumpVersion(state, kind, id);
  return handler;
}

/** Register a framework handler that public reset operations must restore. */
export function registerSystemHandler<
  K extends HandlerKind,
  T extends HandlerByKind[K] = HandlerByKind[K],
>(kind: K, id: Id, handler: T): T {
  return registerSystemHandlerForRuntime(defaultRuntimeScope, kind, id, handler);
}

/** @internal Register a framework-owned handler in one runtime. */
export function registerSystemHandlerForRuntime<
  K extends HandlerKind,
  T extends HandlerByKind[K] = HandlerByKind[K],
>(runtime: RuntimeScope, kind: K, id: Id, handler: T): T {
  const state = getHandlerState(runtime);
  (state.systemHandlers[kind] as Partial<Record<string, RegistryHandler>>)[id] = handler;
  writeHandler(state, kind, id, handler);
  bumpVersion(state, kind, id);
  return handler;
}

export function hasHandler(kind: HandlerKind, id: Id): boolean {
  return hasHandlerForRuntime(defaultRuntimeScope, kind, id);
}

/** @internal Runtime-scoped handler existence check. */
export function hasHandlerForRuntime(runtime: RuntimeScope, kind: HandlerKind, id: Id): boolean {
  return getHandlerState(runtime).handlers[kind][id] !== undefined;
}

/** @internal Reset stored handlers without clearing related feature metadata. */
export function clearHandlerEntries(kind?: HandlerKind, id?: Id): void {
  clearHandlerEntriesForRuntime(defaultRuntimeScope, kind, id);
}

/** @internal Reset stored handlers in one runtime without clearing feature metadata. */
export function clearHandlerEntriesForRuntime(
  runtime: RuntimeScope,
  kind?: HandlerKind,
  id?: Id,
): void {
  const state = getHandlerState(runtime);
  if (kind === undefined) {
    for (const handlerKind of HANDLER_KINDS) resetHandlerRecord(state, handlerKind);
    return;
  }
  if (id === undefined) {
    resetHandlerRecord(state, kind);
    return;
  }

  const systemHandler = state.systemHandlers[kind][id];
  if (systemHandler === undefined) {
    delete state.handlers[kind][id];
  } else {
    writeHandler(state, kind, id, systemHandler);
  }
  bumpVersion(state, kind, id);
}

/** @internal Remove a user handler only when it still matches an installation. */
export function clearHandlerIfMatchesForRuntime<K extends HandlerKind>(
  runtime: RuntimeScope,
  kind: K,
  id: Id,
  expected: HandlerByKind[K],
): boolean {
  const state = getHandlerState(runtime);
  if (state.handlers[kind][id] !== expected || state.systemHandlers[kind][id] === expected) {
    return false;
  }
  delete state.handlers[kind][id];
  bumpVersion(state, kind, id);
  return true;
}

/** @internal Return the opaque generation of a handler registration. */
export function getHandlerRegistrationVersionForRuntime(
  runtime: RuntimeScope,
  kind: HandlerKind,
  id: Id,
): number | undefined {
  return getHandlerState(runtime).versions[kind][id];
}

/**
 * @internal Remove one installation's handler without touching a newer
 * registration. Framework handlers are restored rather than deleted.
 */
export function clearHandlerRegistrationForRuntime(
  runtime: RuntimeScope,
  kind: HandlerKind,
  id: Id,
  version: number,
): boolean {
  const state = getHandlerState(runtime);
  if (state.versions[kind][id] !== version) return false;
  const systemHandler = state.systemHandlers[kind][id];
  if (systemHandler === undefined) delete state.handlers[kind][id];
  else writeHandler(state, kind, id, systemHandler);
  bumpVersion(state, kind, id);
  return true;
}
