import { consoleLog } from '../core/logging';

import type {
  CoEffectHandler,
  EffectHandler,
  ErrorHandler,
  EventHandler,
  Id,
  Interceptor,
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

export interface RegistrationOwnership {
  /** True only while this token still owns the current registration. */
  readonly current: boolean;
  /** Validate destructive release before user cleanup runs. */
  assertReleasable?(): void;
  /** Remove this registration without touching a newer replacement. */
  release(): boolean;
}

export interface RuntimeEventDefinition {
  readonly handler: EventHandler<any, any>;
  readonly interceptors: readonly Interceptor[];
}

interface RegistrationKey {
  readonly kind: HandlerKind;
  readonly id: Id;
  readonly version: number;
}

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
  private readonly eventDefinitions = new Map<Id, RuntimeEventDefinition>();
  private globalInterceptors: Interceptor[] = [];
  private readonly globalInterceptorVersions = new Map<string, number>();

  get<K extends HandlerKind>(kind: K, id: Id): HandlerByKind[K] | undefined {
    return this.handlers[kind][id];
  }

  has(kind: HandlerKind, id: Id): boolean {
    return this.handlers[kind][id] !== undefined;
  }

  getEvent(id: Id): RuntimeEventDefinition | undefined {
    return this.eventDefinitions.get(id);
  }

  registerEvent(
    id: Id,
    handler: EventHandler<any, any>,
    interceptors: readonly Interceptor[],
  ): RegistrationOwnership {
    const definition = createEventDefinition(handler, interceptors);
    const handlerOwnership = this.register('event', id, definition.handler);
    this.eventDefinitions.set(id, definition);
    return Object.freeze({
      get current(): boolean {
        return handlerOwnership.current;
      },
      release: (): boolean => {
        if (!handlerOwnership.current) return false;
        return handlerOwnership.release();
      },
    });
  }

  getEventInterceptors(id: Id): readonly Interceptor[] {
    return this.eventDefinitions.get(id)?.interceptors ?? EMPTY_INTERCEPTORS;
  }

  setEventInterceptors(id: Id, interceptors: readonly Interceptor[]): void {
    const handler = this.handlers.event[id];
    if (handler !== undefined) {
      this.eventDefinitions.set(id, createEventDefinition(handler, interceptors));
    }
  }

  registerGlobalInterceptor(interceptor: Interceptor): RegistrationOwnership {
    const existingIndex = this.globalInterceptors.findIndex(({ id }) => id === interceptor.id);
    this.globalInterceptors =
      existingIndex === -1
        ? [...this.globalInterceptors, interceptor]
        : this.globalInterceptors.map((existing, index) =>
            index === existingIndex ? interceptor : existing,
          );
    const version = this.bumpVersion();
    this.globalInterceptorVersions.set(interceptor.id, version);
    const isCurrent = () => this.globalInterceptorVersions.get(interceptor.id) === version;
    const release = (): boolean => {
      if (!isCurrent()) return false;
      this.globalInterceptors = this.globalInterceptors.filter(
        (existing) => existing.id !== interceptor.id,
      );
      this.globalInterceptorVersions.set(interceptor.id, this.bumpVersion());
      return true;
    };
    return Object.freeze({
      get current(): boolean {
        return isCurrent();
      },
      release,
    });
  }

  getGlobalInterceptors(): Interceptor[] {
    return [...this.globalInterceptors];
  }

  clearGlobalInterceptors(id?: string): void {
    const removedIds =
      id === undefined ? this.globalInterceptors.map((interceptor) => interceptor.id) : [id];
    this.globalInterceptors =
      id === undefined
        ? []
        : this.globalInterceptors.filter((interceptor) => interceptor.id !== id);
    for (const removedId of removedIds) {
      this.globalInterceptorVersions.set(removedId, this.bumpVersion());
    }
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
    if (kind === 'event') {
      const eventHandler = handler as HandlerByKind['event'];
      const interceptors = this.eventDefinitions.get(id)?.interceptors ?? EMPTY_INTERCEPTORS;
      this.eventDefinitions.set(id, createEventDefinition(eventHandler, interceptors));
    }
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
    if (kind === 'event') {
      this.eventDefinitions.set(
        id,
        createEventDefinition(handler as HandlerByKind['event'], EMPTY_INTERCEPTORS),
      );
    }
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
    if (kind === 'event') this.restoreSystemEventDefinition(id, systemHandler);
    this.bumpHandlerVersion(kind, id);
  }

  release(key: RegistrationKey): boolean {
    if (this.versions[key.kind][key.id] !== key.version) return false;
    const systemHandler = this.systemHandlers[key.kind][key.id];
    if (systemHandler === undefined) delete this.handlers[key.kind][key.id];
    else writeHandler(this, key.kind, key.id, systemHandler);
    if (key.kind === 'event') this.restoreSystemEventDefinition(key.id, systemHandler);
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
    if (kind === 'event') {
      this.eventDefinitions.clear();
      for (const [eventId, handler] of Object.entries(next)) {
        if (handler !== undefined) {
          this.eventDefinitions.set(
            eventId,
            createEventDefinition(handler as HandlerByKind['event'], EMPTY_INTERCEPTORS),
          );
        }
      }
    }
    for (const id of new Set([...previousIds, ...Object.keys(next)])) {
      this.bumpHandlerVersion(kind, id);
    }
  }

  private restoreSystemEventDefinition(id: Id, systemHandler: RegistryHandler | undefined): void {
    if (systemHandler === undefined) {
      this.eventDefinitions.delete(id);
      return;
    }
    this.eventDefinitions.set(
      id,
      createEventDefinition(systemHandler as HandlerByKind['event'], EMPTY_INTERCEPTORS),
    );
  }
}

const EMPTY_INTERCEPTORS: readonly Interceptor[] = Object.freeze([]);

function createEventDefinition(
  handler: EventHandler<any, any>,
  interceptors: readonly Interceptor[],
): RuntimeEventDefinition {
  return Object.freeze({
    handler,
    interceptors: interceptors.length === 0 ? EMPTY_INTERCEPTORS : Object.freeze([...interceptors]),
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

function writeHandler(
  state: RuntimeRegistry,
  kind: HandlerKind,
  id: Id,
  handler: RegistryHandler,
): void {
  (state.handlers[kind] as Partial<Record<string, RegistryHandler>>)[id] = handler;
}

export function isHandlerKind(value: string): value is HandlerKind {
  return HANDLER_KINDS.includes(value as HandlerKind);
}

export function isSubscriptionHandlerKind(value: string): value is SubscriptionHandlerKind {
  return SUBSCRIPTION_HANDLER_KINDS.includes(value as SubscriptionHandlerKind);
}
