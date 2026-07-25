import { consoleLog } from '../core/logging';

import type { Id } from '../types';
import type {
  HandlerByKind,
  HandlerKind,
  HandlerRegistry,
  RegistrationOwnership,
} from './handler-types';

export type {
  HandlerByKind,
  HandlerKind,
  HandlerRegistry,
  RegistrationOwnership,
  RegistryHandler,
} from './handler-types';

const HANDLER_KINDS: readonly HandlerKind[] = ['event', 'fx', 'cofx', 'sub', 'subDeps', 'error'];

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
  private readonly kind: HandlerKind;

  constructor(kind: HandlerKind) {
    this.kind = kind;
  }

  get(id: Id): T | undefined {
    return this.handlers[id];
  }

  has(id: Id): boolean {
    return this.handlers[id] !== undefined;
  }

  register(id: Id, handler: T): RegistrationOwnership {
    if (this.has(id)) {
      consoleLog('warn', `[reflex] overwriting ${this.kind} handler for:`, id);
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
 * Handler kinds are represented by typed records so internal callers do not
 * dispatch registry operations through string arguments.
 */
export class RuntimeRegistry {
  readonly event: HandlerRecord<HandlerByKind['event']> = new HandlerRecord('event');
  readonly fx: HandlerRecord<HandlerByKind['fx']> = new HandlerRecord('fx');
  readonly cofx: HandlerRecord<HandlerByKind['cofx']> = new HandlerRecord('cofx');
  readonly sub: HandlerRecord<HandlerByKind['sub']> = new HandlerRecord('sub');
  readonly subDeps: HandlerRecord<HandlerByKind['subDeps']> = new HandlerRecord('subDeps');
  readonly error: HandlerRecord<HandlerByKind['error']> = new HandlerRecord('error');

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

export function isHandlerKind(value: string): value is HandlerKind {
  return HANDLER_KINDS.includes(value as HandlerKind);
}

function createRecord<T>(): Partial<Record<string, T>> {
  return Object.create(null) as Partial<Record<string, T>>;
}
