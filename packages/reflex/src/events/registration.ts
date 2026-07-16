import { consoleLog } from '../core/logging';
import { setInterceptors } from '../runtime/event-metadata';
import { registerHandler } from '../runtime/handlers';
import { getInjectCofxInterceptor } from './coeffects';
import { isInterceptor } from './interceptors';

import type {
  DefaultAppDb,
  EventHandler,
  EventParams,
  EventRegistrationOptions,
  Id,
  Interceptor,
} from '../types';

const HANDLER_KIND = 'event';

interface UnknownEventRegistrationOptions {
  coeffects?: unknown;
  interceptors?: unknown;
}

interface NormalizedEventRegistration {
  coeffects: readonly unknown[];
  interceptors: readonly unknown[];
}

/** Register an event handler. */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(
  id: K,
  handler: EventHandler<T, EventParams<K>>,
): void;
/** Register an event handler with explicit coeffects and interceptors. */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(
  id: K,
  handler: EventHandler<T, EventParams<K>>,
  options: EventRegistrationOptions<T>,
): void;
/** Register an event handler with interceptors using the legacy positional form. */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(
  id: K,
  handler: EventHandler<T, EventParams<K>>,
  interceptors: Interceptor<T>[],
): void;
/** Register an event handler with coeffects using the legacy positional form. */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(
  id: K,
  handler: EventHandler<T, EventParams<K>>,
  coeffects: [Id, ...any[]][],
): void;
/** Register an event handler with coeffects and interceptors using the legacy positional form. */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(
  id: K,
  handler: EventHandler<T, EventParams<K>>,
  coeffects: [Id, ...any[]][],
  interceptors: Interceptor<T>[],
): void;
export function regEvent<T = Record<string, any>>(
  id: Id,
  handler: EventHandler<T>,
  registration?: unknown,
  legacyInterceptors?: Interceptor<T>[],
): void {
  registerHandler(HANDLER_KIND, id, handler);
  registerEventInterceptors(id, registration, legacyInterceptors);
}

function isCoeffectSpecificationArray(value: readonly unknown[]): boolean {
  return value.length > 0 && Array.isArray(value[0]);
}

function isEventRegistrationOptions(value: unknown): value is UnknownEventRegistrationOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEventRegistration(
  registration: unknown,
  legacyInterceptors?: readonly unknown[],
): NormalizedEventRegistration {
  if (isEventRegistrationOptions(registration)) {
    return {
      coeffects: Array.isArray(registration.coeffects) ? registration.coeffects : [],
      interceptors: Array.isArray(registration.interceptors) ? registration.interceptors : [],
    };
  }

  // A fourth argument disambiguates an empty third argument as coeffects.
  if (legacyInterceptors !== undefined) {
    return {
      coeffects: Array.isArray(registration) ? registration : [],
      interceptors: legacyInterceptors,
    };
  }

  if (!Array.isArray(registration)) {
    return { coeffects: [], interceptors: [] };
  }

  return isCoeffectSpecificationArray(registration)
    ? { coeffects: registration, interceptors: [] }
    : { coeffects: [], interceptors: registration };
}

function registerEventInterceptors<T = Record<string, any>>(
  id: Id,
  registration: unknown,
  legacyInterceptors?: readonly Interceptor<T>[],
): void {
  const normalized = normalizeEventRegistration(registration, legacyInterceptors);
  const coeffectInterceptors: Interceptor[] = [];

  for (const specification of normalized.coeffects) {
    if (!Array.isArray(specification) || typeof specification[0] !== 'string') {
      consoleLog('warn', '[reflex] invalid cofx specification:', specification);
      continue;
    }

    if (specification.length === 1) {
      coeffectInterceptors.push(getInjectCofxInterceptor(specification[0]));
    } else if (specification.length === 2) {
      coeffectInterceptors.push(getInjectCofxInterceptor(specification[0], specification[1]));
    } else {
      consoleLog('warn', '[reflex] invalid cofx specification:', specification);
    }
  }

  const eventInterceptors: Interceptor[] = [];
  for (const candidate of normalized.interceptors) {
    if (isInterceptor(candidate)) {
      eventInterceptors.push(candidate);
    } else {
      consoleLog(
        'error',
        '[reflex] invalid interceptor provided for event:',
        id,
        'interceptor:',
        candidate,
      );
    }
  }

  // Registration replaces metadata; an empty list must clear prior metadata.
  setInterceptors(id, [...coeffectInterceptors, ...eventInterceptors]);
}
