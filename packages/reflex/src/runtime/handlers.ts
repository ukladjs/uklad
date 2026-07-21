import { consoleLog } from '../core/logging';
import { type RuntimeKernel } from './kernel';

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

export interface HandlerState {
  handlers: HandlerRegistry;
  systemHandlers: HandlerRegistry;
  versions: Record<HandlerKind, Partial<Record<string, number>>>;
  nextVersion: number;
}

function getHandlerState(runtime: RuntimeKernel): HandlerState {
  return (runtime.handlers ??= {
    handlers: createHandlerRegistry(),
    systemHandlers: createHandlerRegistry(),
    versions: createVersionRegistry(),
    nextVersion: 0,
  });
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

/** @internal Runtime-scoped handler lookup. */
export function getHandlerForKernel<K extends HandlerKind>(
  runtime: RuntimeKernel,
  kind: K,
  id: Id,
): HandlerByKind[K] | undefined {
  return getHandlerState(runtime).handlers[kind][id];
}

/** @internal Runtime-scoped live registry for diagnostics. */
export function getHandlersForKernel(runtime: RuntimeKernel): HandlerRegistry {
  return getHandlerState(runtime).handlers;
}

/** @internal Register a handler in one runtime. */
export function registerHandlerForKernel<
  K extends HandlerKind,
  T extends HandlerByKind[K] = HandlerByKind[K],
>(runtime: RuntimeKernel, kind: K, id: Id, handler: T): T {
  const state = getHandlerState(runtime);
  if (state.handlers[kind][id]) {
    consoleLog('warn', `[reflex] overwriting ${kind} handler for:`, id);
  }
  writeHandler(state, kind, id, handler);
  bumpVersion(state, kind, id);
  return handler;
}

/** @internal Register a framework-owned handler in one runtime. */
export function registerSystemHandlerForKernel<
  K extends HandlerKind,
  T extends HandlerByKind[K] = HandlerByKind[K],
>(runtime: RuntimeKernel, kind: K, id: Id, handler: T): T {
  const state = getHandlerState(runtime);
  (state.systemHandlers[kind] as Partial<Record<string, RegistryHandler>>)[id] = handler;
  writeHandler(state, kind, id, handler);
  bumpVersion(state, kind, id);
  return handler;
}

/** @internal Runtime-scoped handler existence check. */
export function hasHandlerForKernel(runtime: RuntimeKernel, kind: HandlerKind, id: Id): boolean {
  return getHandlerState(runtime).handlers[kind][id] !== undefined;
}

/** @internal Reset stored handlers in one runtime without clearing feature metadata. */
export function clearHandlerEntriesForKernel(
  runtime: RuntimeKernel,
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
export function clearHandlerIfMatchesForKernel<K extends HandlerKind>(
  runtime: RuntimeKernel,
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
export function getHandlerRegistrationVersionForKernel(
  runtime: RuntimeKernel,
  kind: HandlerKind,
  id: Id,
): number | undefined {
  return getHandlerState(runtime).versions[kind][id];
}

/**
 * @internal Remove one installation's handler without touching a newer
 * registration. Framework handlers are restored rather than deleted.
 */
export function clearHandlerRegistrationForKernel(
  runtime: RuntimeKernel,
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
