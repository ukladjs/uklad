import { consoleLog } from '../core/logging';

import type { Id } from '../types';
import type { HandlerRegistry, RegistrationOwnership } from './handler-types';
import type {
  CoEffectHandler,
  EffectHandler,
  ErrorHandler,
  EventHandler,
  SubDepsHandler,
  SubHandler,
} from '../types';

export type { HandlerRegistry, RegistrationOwnership } from './handler-types';

/**
 * One typed handler namespace in a runtime registry.
 *
 * System handlers form the baseline restored by clear operations. Registration
 * versions make ownership tokens safe when a handler is replaced.
 */
export class HandlerRecord<T> {
  readonly handlers: Partial<Record<string, T>> = createRecord();
  private readonly systemHandlers: Partial<Record<string, T>> = createRecord();
  private readonly versions: Partial<Record<string, number>> = createRecord();
  private nextVersion = 0;

  get(id: Id): T | undefined {
    return this.handlers[id];
  }

  has(id: Id): boolean {
    return this.handlers[id] !== undefined;
  }

  register(id: Id, handler: T): RegistrationOwnership {
    if (this.has(id)) {
      consoleLog('warn', '[reflex] overwriting handler for:', id);
    }
    this.handlers[id] = handler;
    const version = this.bumpVersion(id);
    const isCurrent = () => this.versions[id] === version;
    return Object.freeze({
      get current(): boolean {
        return isCurrent();
      },
      release: () => this.release(id, version),
    });
  }

  registerSystem(id: Id, handler: T): void {
    this.systemHandlers[id] = handler;
    this.handlers[id] = handler;
    this.bumpVersion(id);
  }

  clear(id?: Id): void {
    if (id === undefined) {
      const affectedIds = new Set([
        ...Object.keys(this.handlers),
        ...Object.keys(this.systemHandlers),
      ]);
      for (const handlerId of Object.keys(this.handlers)) delete this.handlers[handlerId];
      Object.assign(this.handlers, this.systemHandlers);
      for (const handlerId of affectedIds) this.bumpVersion(handlerId);
      return;
    }

    const systemHandler = this.systemHandlers[id];
    if (systemHandler === undefined) delete this.handlers[id];
    else this.handlers[id] = systemHandler;
    this.bumpVersion(id);
  }

  private release(id: Id, version: number): boolean {
    if (this.versions[id] !== version) return false;
    this.clear(id);
    return true;
  }

  private bumpVersion(id: Id): number {
    const version = ++this.nextVersion;
    this.versions[id] = version;
    return version;
  }
}

/**
 * Cohesive handler registry owned eagerly by one runtime core.
 *
 * Handler namespaces are represented by typed records so internal callers
 * never dispatch registry operations through string arguments.
 */
export class RuntimeRegistry {
  readonly event: HandlerRecord<EventHandler<any, any>> = new HandlerRecord();
  readonly fx: HandlerRecord<EffectHandler> = new HandlerRecord();
  readonly cofx: HandlerRecord<CoEffectHandler<any>> = new HandlerRecord();
  readonly sub: HandlerRecord<SubHandler> = new HandlerRecord();
  readonly subDeps: HandlerRecord<SubDepsHandler> = new HandlerRecord();
  readonly error: HandlerRecord<ErrorHandler> = new HandlerRecord();

  readonly handlers: HandlerRegistry = {
    event: this.event.handlers,
    fx: this.fx.handlers,
    cofx: this.cofx.handlers,
    sub: this.sub.handlers,
    subDeps: this.subDeps.handlers,
    error: this.error.handlers,
  };

  clear(): void {
    this.event.clear();
    this.fx.clear();
    this.cofx.clear();
    this.sub.clear();
    this.subDeps.clear();
    this.error.clear();
  }
}

function createRecord<T>(): Partial<Record<string, T>> {
  return Object.create(null) as Partial<Record<string, T>>;
}
