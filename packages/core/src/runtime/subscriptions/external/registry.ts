import { consoleLog } from '../../../core/logging';
import { RegistrationCollisionError } from '../../registrations';

import type { Id, SubVector } from '../../../types';
import type { ExternalSubscriptionDefinition, ExternalSubscriptionDriver } from './types';

/** Owns external definitions and validates one driver factory result per vector. */
export class ExternalSubscriptionRegistry {
  private readonly definitions = new Map<Id, ExternalSubscriptionDefinition>();

  register(
    id: Id,
    dependencies: (...params: any[]) => SubVector[],
    createDriver: (...params: any[]) => ExternalSubscriptionDriver<readonly unknown[], any>,
  ): ExternalSubscriptionDefinition | undefined {
    this.assertAvailable(id);
    if (typeof dependencies !== 'function' || typeof createDriver !== 'function') {
      consoleLog(
        'error',
        `[uklad] External subscription '${id}' must specify dependencies and createDriver.`,
      );
      return undefined;
    }

    const definition: ExternalSubscriptionDefinition = {
      id,
      dependencies,
      createDriver,
      token: Symbol(String(id)),
    };
    this.definitions.set(id, definition);
    return definition;
  }

  get(id: Id): ExternalSubscriptionDefinition | undefined {
    return this.definitions.get(id);
  }

  has(id: Id): boolean {
    return this.definitions.has(id);
  }

  isActive(definition: ExternalSubscriptionDefinition): boolean {
    return this.definitions.get(definition.id)?.token === definition.token;
  }

  createDriver(
    id: Id,
    params: readonly any[],
  ): ExternalSubscriptionDriver<readonly unknown[], any> {
    const definition = this.definitions.get(id);
    if (definition === undefined) {
      throw new Error(`[uklad] External subscription '${id}' is no longer registered.`);
    }
    const candidate = definition.createDriver(...params);
    if (!isExternalSubscriptionDriver(candidate)) {
      throw new Error(
        `[uklad] External subscription '${id}' createDriver must return an object with read(), activate(), sync(), and dispose().`,
      );
    }
    return candidate;
  }

  clear(id?: Id): void {
    if (id === undefined) this.definitions.clear();
    else this.definitions.delete(id);
  }

  assertAvailable(id: Id): void {
    if (this.definitions.has(id)) throw new RegistrationCollisionError(id);
  }
}

function isExternalSubscriptionDriver(
  value: unknown,
): value is ExternalSubscriptionDriver<readonly unknown[], any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ExternalSubscriptionDriver).read === 'function' &&
    typeof (value as ExternalSubscriptionDriver).activate === 'function' &&
    typeof (value as ExternalSubscriptionDriver).sync === 'function' &&
    typeof (value as ExternalSubscriptionDriver).dispose === 'function'
  );
}
