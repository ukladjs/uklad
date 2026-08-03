import type { Id } from '../types';

export const REGISTRATION_COLLISION_CODE = 'UKLAD_REGISTRATION_COLLISION';

/** Stable duplicate-registration error exposed to package integrations. */
export class RegistrationCollisionError extends Error {
  readonly code: typeof REGISTRATION_COLLISION_CODE = REGISTRATION_COLLISION_CODE;
  readonly registrationId: string;

  constructor(id: Id) {
    super(`[uklad] Registration '${String(id)}' is already registered.`);
    this.name = 'RegistrationCollisionError';
    this.registrationId = String(id);
  }
}

/** Recognize collision errors across duplicated package copies and realms. */
export function isRegistrationCollisionError(value: unknown): value is RegistrationCollisionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    value.code === REGISTRATION_COLLISION_CODE
  );
}

export interface RegistrationHandle {
  /** True only while this handle identifies the installed registration. */
  readonly active: boolean;
  /** Validate destructive release before user cleanup runs. */
  assertReleasable?(): void;
  /** Remove the registration identified by this handle. */
  release(): boolean;
}

interface RegistrationEntry<T> {
  readonly value: T;
  readonly token: symbol | undefined;
}

interface RegistrationHandleOptions {
  readonly isActive: () => boolean;
  readonly assertReleasable?: () => void;
  readonly release: () => boolean;
}

/** Create one immutable cleanup handle for a runtime registration. */
export function createRegistrationHandle(options: RegistrationHandleOptions): RegistrationHandle {
  const handle: RegistrationHandle = {
    get active(): boolean {
      return options.isActive();
    },
    release: options.release,
  };
  if (options.assertReleasable) handle.assertReleasable = options.assertReleasable;
  return Object.freeze(handle);
}

/**
 * One unique-ID registration namespace.
 *
 * This is the only place that tracks registration identity. Consumers own
 * domain metadata, while this store owns duplicate detection and safe release.
 */
export class RegistrationStore<T> {
  readonly values: Partial<Record<string, T>> = createRecord();
  private readonly entries = new Map<string, RegistrationEntry<T>>();
  private readonly systemValues = new Map<string, T>();

  /** Number of installed registrations, including system baselines. */
  get size(): number {
    return this.entries.size;
  }

  get(id: Id): T | undefined {
    return this.values[id];
  }

  has(id: Id): boolean {
    return this.values[id] !== undefined;
  }

  list(): T[] {
    return Array.from(this.entries.values(), ({ value }) => value);
  }

  register(id: Id, value: T): RegistrationHandle {
    this.assertAvailable(id);
    return this.install(id, value);
  }

  registerSystemOverride(id: Id, value: T): RegistrationHandle {
    if (this.entries.get(id)?.token !== undefined) this.throwDuplicate(id);
    if (!this.systemValues.has(id)) {
      throw new Error(`[uklad] Cannot override unknown system registration '${String(id)}'.`);
    }
    return this.install(id, value);
  }

  registerSystem(id: Id, value: T): void {
    this.assertAvailable(id);
    this.systemValues.set(id, value);
    this.setEntry(id, { value, token: undefined });
  }

  assertAvailable(id: Id): void {
    if (this.has(id)) this.throwDuplicate(id);
  }

  clear(id?: Id): void {
    if (id === undefined) {
      this.entries.clear();
      for (const valueId of Object.keys(this.values)) delete this.values[valueId];
      for (const [systemId, systemValue] of this.systemValues) {
        this.setEntry(systemId, { value: systemValue, token: undefined });
      }
      return;
    }

    if (!this.systemValues.has(id)) {
      this.entries.delete(id);
      delete this.values[id];
    } else {
      const systemValue = this.systemValues.get(id)!;
      this.setEntry(id, { value: systemValue, token: undefined });
    }
  }

  private install(id: Id, value: T): RegistrationHandle {
    const token = Symbol(String(id));
    this.setEntry(id, { value, token });
    const isActive = () => this.entries.get(id)?.token === token;
    return createRegistrationHandle({
      isActive,
      release: () => {
        if (!isActive()) return false;
        this.clear(id);
        return true;
      },
    });
  }

  private setEntry(id: Id, entry: RegistrationEntry<T>): void {
    this.entries.set(id, entry);
    this.values[id] = entry.value;
  }

  private throwDuplicate(id: Id): never {
    throw new RegistrationCollisionError(id);
  }
}

function createRecord<T>(): Partial<Record<string, T>> {
  return Object.create(null) as Partial<Record<string, T>>;
}
