import { consoleLog } from '../core/logging';

import type { Id } from '../types';
import type {
  HandlerByKind,
  HandlerKind,
  HandlerRegistry,
  RegistrationOwnership,
  RegistryHandler,
} from './handler-types';

export type {
  HandlerByKind,
  HandlerKind,
  HandlerRegistry,
  RegistrationOwnership,
  RegistryHandler,
} from './handler-types';

interface RegistrationKey {
  readonly kind: HandlerKind;
  readonly id: Id;
  readonly version: number;
}

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

/**
 * Cohesive handler registry owned eagerly by one runtime core.
 *
 * Version counters remain an implementation detail used by opaque ownership
 * tokens; callers never probe or compare them.
 */
export class RuntimeRegistry {
  readonly handlers: HandlerRegistry = createHandlerRegistry();
  private readonly systemHandlers: HandlerRegistry = createHandlerRegistry();
  private readonly versions: Record<HandlerKind, Partial<Record<string, number>>> =
    createVersionRegistry();
  private nextVersion = 0;

  get<K extends HandlerKind>(kind: K, id: Id): HandlerByKind[K] | undefined {
    return this.handlers[kind][id];
  }

  has(kind: HandlerKind, id: Id): boolean {
    return this.handlers[kind][id] !== undefined;
  }

  register<K extends HandlerKind, T extends HandlerByKind[K]>(
    kind: K,
    id: Id,
    handler: T,
  ): RegistrationOwnership {
    if (this.handlers[kind][id]) {
      consoleLog('warn', `[reflex] overwriting ${kind} handler for:`, id);
    }
    writeHandler(this, kind, id, handler);
    const version = this.bumpHandlerVersion(kind, id);
    return this.createOwnership({ kind, id, version });
  }

  registerSystem<K extends HandlerKind, T extends HandlerByKind[K]>(
    kind: K,
    id: Id,
    handler: T,
  ): void {
    (this.systemHandlers[kind] as Partial<Record<string, RegistryHandler>>)[id] = handler;
    writeHandler(this, kind, id, handler);
    this.bumpHandlerVersion(kind, id);
  }

  clear(kind?: HandlerKind, id?: Id): void {
    if (kind === undefined) {
      for (const handlerKind of HANDLER_KINDS) this.resetHandlerRecord(handlerKind);
      return;
    }
    if (id === undefined) {
      this.resetHandlerRecord(kind);
      return;
    }

    const systemHandler = this.systemHandlers[kind][id];
    if (systemHandler === undefined) delete this.handlers[kind][id];
    else writeHandler(this, kind, id, systemHandler);
    this.bumpHandlerVersion(kind, id);
  }

  release(key: RegistrationKey): boolean {
    if (this.versions[key.kind][key.id] !== key.version) return false;
    const systemHandler = this.systemHandlers[key.kind][key.id];
    if (systemHandler === undefined) delete this.handlers[key.kind][key.id];
    else writeHandler(this, key.kind, key.id, systemHandler);
    this.bumpHandlerVersion(key.kind, key.id);
    return true;
  }

  private createOwnership(key: RegistrationKey): RegistrationOwnership {
    const isCurrent = () => this.versions[key.kind][key.id] === key.version;
    const release = () => this.release(key);
    return Object.freeze({
      get current(): boolean {
        return isCurrent();
      },
      release,
    });
  }

  private bumpVersion(): number {
    return ++this.nextVersion;
  }

  private bumpHandlerVersion(kind: HandlerKind, id: Id): number {
    const version = this.bumpVersion();
    this.versions[kind][id] = version;
    return version;
  }

  private resetHandlerRecord(kind: HandlerKind): void {
    const previousIds = Object.keys(this.handlers[kind]);
    const next = createHandlerRecord<RegistryHandler>();
    Object.assign(next, this.systemHandlers[kind]);
    (this.handlers as Record<HandlerKind, Partial<Record<string, RegistryHandler>>>)[kind] = next;
    for (const id of new Set([...previousIds, ...Object.keys(next)])) {
      this.bumpHandlerVersion(kind, id);
    }
  }
}

export function isHandlerKind(value: string): value is HandlerKind {
  return HANDLER_KINDS.includes(value as HandlerKind);
}

export function isSubscriptionHandlerKind(value: string): value is SubscriptionHandlerKind {
  return SUBSCRIPTION_HANDLER_KINDS.includes(value as SubscriptionHandlerKind);
}

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

function writeHandler(
  state: RuntimeRegistry,
  kind: HandlerKind,
  id: Id,
  handler: RegistryHandler,
): void {
  (state.handlers[kind] as Partial<Record<string, RegistryHandler>>)[id] = handler;
}
