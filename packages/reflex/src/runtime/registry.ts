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
 * System handlers form the baseline restored by clear operations. Ordinary
 * registrations are unique: callers must release an existing registration
 * before registering the same id again.
 */
export class HandlerRecord<T> {
  readonly handlers: Partial<Record<string, T>> = createRecord();
  private readonly systemHandlers: Partial<Record<string, T>> = createRecord();
  private readonly owners: Partial<Record<string, symbol>> = createRecord();
  private readonly kind: string;

  constructor(kind: string) {
    this.kind = kind;
  }

  get(id: Id): T | undefined {
    return this.handlers[id];
  }

  has(id: Id): boolean {
    return this.handlers[id] !== undefined;
  }

  register(id: Id, handler: T): RegistrationOwnership {
    this.assertAvailable(id);
    return this.install(id, handler);
  }

  registerSystemOverride(id: Id, handler: T): RegistrationOwnership {
    if (this.owners[id] !== undefined) this.throwDuplicate(id);
    if (this.systemHandlers[id] === undefined) {
      throw new Error(
        `[reflex] Cannot override unknown system ${this.kind} handler '${String(id)}'.`,
      );
    }
    return this.install(id, handler);
  }

  assertAvailable(id: Id): void {
    if (this.has(id)) this.throwDuplicate(id);
  }

  private install(id: Id, handler: T): RegistrationOwnership {
    const owner = Symbol(String(id));
    this.handlers[id] = handler;
    this.owners[id] = owner;
    const isCurrent = () => this.owners[id] === owner;
    return Object.freeze({
      get current(): boolean {
        return isCurrent();
      },
      release: () => this.release(id, owner),
    });
  }

  registerSystem(id: Id, handler: T): void {
    this.assertAvailable(id);
    this.systemHandlers[id] = handler;
    this.handlers[id] = handler;
  }

  clear(id?: Id): void {
    if (id === undefined) {
      for (const handlerId of Object.keys(this.handlers)) delete this.handlers[handlerId];
      for (const handlerId of Object.keys(this.owners)) delete this.owners[handlerId];
      Object.assign(this.handlers, this.systemHandlers);
      return;
    }

    delete this.owners[id];
    const systemHandler = this.systemHandlers[id];
    if (systemHandler === undefined) delete this.handlers[id];
    else this.handlers[id] = systemHandler;
  }

  private release(id: Id, owner: symbol): boolean {
    if (this.owners[id] !== owner) return false;
    this.clear(id);
    return true;
  }

  private throwDuplicate(id: Id): never {
    throw new Error(`[reflex] ${this.kind} handler '${String(id)}' is already registered.`);
  }
}

/**
 * Cohesive handler registry owned eagerly by one runtime core.
 *
 * Handler namespaces are represented by typed records so internal callers
 * never dispatch registry operations through string arguments.
 */
export class RuntimeRegistry {
  readonly event: HandlerRecord<EventHandler<any, any>> = new HandlerRecord('Event');
  readonly fx: HandlerRecord<EffectHandler> = new HandlerRecord('Effect');
  readonly cofx: HandlerRecord<CoEffectHandler<any>> = new HandlerRecord('Coeffect');
  readonly sub: HandlerRecord<SubHandler> = new HandlerRecord('Subscription');
  readonly subDeps: HandlerRecord<SubDepsHandler> = new HandlerRecord('Subscription dependency');
  readonly error: HandlerRecord<ErrorHandler> = new HandlerRecord('Error');

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
